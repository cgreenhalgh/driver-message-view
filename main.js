var https = require("https");
var http = require("http");
var express = require("express");
var bodyParser = require("body-parser");
var databox = require("node-databox");
var WebSocket = require("ws");

const DATABOX_ARBITER_ENDPOINT = process.env.DATABOX_ARBITER_ENDPOINT || 'tcp://127.0.0.1:4444';
const DATABOX_ZMQ_ENDPOINT = process.env.DATABOX_ZMQ_ENDPOINT || "tcp://127.0.0.1:5555";
const DATABOX_TESTING = !(process.env.DATABOX_VERSION);
const PORT = process.env.port || '8080';

//server and websocket connection;
let ws, server = null;
//cached ui state
// array of messages (w. metadata, and pref id)
let uimessages = [];

function updateui(msg) {
	let done = false;
	if (msg.id) {
		for (let i=0; i<uimessages.length; i++) {
			let m = uimessages[i];
			if (m.id == msg.id) {
				uimessages.splice(i, 1, msg);
				done = true;
				break;
			}
		}
	}
	if (!done)
		uimessages.push(msg);
	if (ws) {
		let json = JSON.stringify(msg)
		try {
			ws.send(json);
		} catch (err) {
			console.log(`error sending ws message`, err)
			try { ws.close(); } catch (err) {}
			ws = null;
		}
	}
}

const store = databox.NewStoreClient(DATABOX_ZMQ_ENDPOINT, DATABOX_ARBITER_ENDPOINT);

//create store schema for saving key/value config data
const messageMetadata = {
	...databox.NewDataSourceMetadata(),
	Description: 'Message view metadata',
	ContentType: 'application/json',
	Vendor: 'Databox Inc.',
	DataSourceType: 'message-view-config:1',
	DataSourceID: 'message-view-metadata',
	StoreType: 'kv',
}

//create store schema for a message actuator (i.e a store that can be written to by an app)
const messageActuator = {
	...databox.NewDataSourceMetadata(),
	Description: 'Messages to view',
	ContentType: 'application/json',
	Vendor: 'Databox Inc.',
	DataSourceType: 'message-view:1',
	DataSourceID: 'Messages',
	StoreType: 'ts/blob',
	IsActuator: true,
}

//old messages
const LAST_N = 50

///now create our stores using our clients.
store.RegisterDatasource(messageMetadata).then(() => {
	console.log("registered message metadata");
	//now register the actuator
	return store.RegisterDatasource(messageActuator)
}).catch((err) => { console.log("error registering datasources", err) }).then(() => {
	console.log("registered messageActuator, observing", messageActuator.DataSourceID);
	store.TSBlob.Observe(messageActuator.DataSourceID, 0)
	.catch((err) => {
		console.log("[Actuation observing error]", err);
	})
	.then((eventEmitter) => {
		if (eventEmitter) {
			eventEmitter.on('data', (data) => {
				console.log("[Actuation] data received ", data);
				addMessage(data);
			});
			eventEmitter.on('error', (err) => {
				console.log("[Actuation error]", err);
			});
		}
		// previous messages
		store.TSBlob.LastN( messageActuator.DataSourceID, LAST_N )
		.then((messages) => {
			console.log(`[LastN] found ${messages.length} messages`)
			for (let mi=messages.length-1; mi>=0; mi--) {
				let m = messages[mi]
				addMessage(m);
			}
		})
	});
});

function addMessage(data) {
	console.log(`addMessage`, data);
	// workaround bug
	let msg = data.data;
	if (msg.data)
		msg = msg.data;
	msg.id = `${data.timestamp}-${encodeURIComponent(msg.topic)}-${encodeURIComponent(msg.title)}`
	msg.html = `<div class="title">${msg.title}</div><div class="time">${new Date(data.timestamp)}</div><div class="content">${msg.content}</div>`;
	updateui(msg);
	store.KV.Read(messageMetadata.DataSourceID, msg.id)
	.then((metadata) => {
		console.log(`read metadata for ${msg.id}`, metadata)
		if (metadata) {
			msg.archived = metadata.archived
			updateui(msg)
		}
	})
	.catch((err) => console.log(`error reading metadata for ${msg.id}`, err))
}

//set up webserver to serve driver endpoints
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.set('views', './views');
app.set('view engine', 'ejs');

app.get("/", function (req, res) {
    res.redirect("/ui");
});

app.get("/ui", function (req, res) {
	res.render('index', { testing: DATABOX_TESTING });
});

app.post('/ui/dismiss/:id', (req, res) => {
	const id = req.params.id;
	console.log(`dismiss message ${id}`)
	let msg = uimessages.find((m) => m.id == id)
	if (!msg) {
		res.send({success:false})
	}
	msg.archived = true;
	store.KV.Write(messageMetadata.DataSourceID, id, { archived: true })
	.then(() => console.log(`persisted metadata for ${id}`))
	.catch((err) => console.log(`error persisting metadata for ${id}`, err))
	// TODO
	res.send({success:true})
});
app.get("/status", function (req, res) {
    res.send("active");
});

//when testing, we run as http, (to prevent the need for self-signed certs etc);
if (DATABOX_TESTING) {
    console.log("[Creating TEST http server]", PORT);
    server = http.createServer(app).listen(PORT);
} else {
    console.log("[Creating https server]", PORT);
    const credentials = databox.GetHttpsCredentials();
    server = https.createServer(credentials, app).listen(PORT);
}

//finally, set up websockets
const wss = new WebSocket.Server({ server, path: "/ui/ws" });

wss.on("connection", (_ws) => {
	if (ws) {
		try { ws.close(); } catch (err) {}
		ws = null;
	}
	ws = _ws;
	_ws.on('error', (err) => {
		console.log(`ws error: ${err}`);
		if (ws === _ws) {
			try { _ws.close(); } catch (err) {}
			ws = null;
		}
	});
	console.log("new ws connection -sending state");
	// send cached state
	for (var msg of uimessages) {
		try {
			ws.send(JSON.stringify(msg))
		} catch (err) {
			console.log(`error sending cached ws message`, err);
		}
	}
});

wss.on("error", (err) => {
	console.log("websocket error", err);
	if (ws) {
		ws = null;
	}
})
