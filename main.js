var https = require("https");
var http = require("http");
var express = require("express");
var bodyParser = require("body-parser");
var databox = require("node-databox");

const DATABOX_ARBITER_ENDPOINT = process.env.DATABOX_ARBITER_ENDPOINT || 'tcp://127.0.0.1:4444';
const DATABOX_ZMQ_ENDPOINT = process.env.DATABOX_ZMQ_ENDPOINT || "tcp://127.0.0.1:5555";
const DATABOX_TESTING = !(process.env.DATABOX_VERSION);
const PORT = process.env.port || '8080';

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
			});
			eventEmitter.on('error', (err) => {
				console.log("[Actuation error]", err);
			});
		}
	});
});

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
    res.render('index', {});
});

/*
app.post('/ui/setConfig', (req, res) => {

    const config = req.body.config;

    return new Promise((resolve, reject) => {
        store.KV.Write(helloWorldConfig.DataSourceID, "config", { key: helloWorldConfig.DataSourceID, value: config }).then(() => {
            console.log("successfully written!", config);
            resolve();
        }).catch((err) => {
            console.log("failed to write", err);
            reject(err);
        });
    }).then(() => {
        res.send({ success: true });
    });
});
*/
app.get("/status", function (req, res) {
    res.send("active");
});

//when testing, we run as http, (to prevent the need for self-signed certs etc);
if (DATABOX_TESTING) {
    console.log("[Creating TEST http server]", PORT);
    http.createServer(app).listen(PORT);
} else {
    console.log("[Creating https server]", PORT);
    const credentials = databox.GetHttpsCredentials();
    https.createServer(credentials, app).listen(PORT);
}
