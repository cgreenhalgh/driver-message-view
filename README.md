# Databox Driver Message View

A driver to display messages to the user. Initially mostly
for testing. But the functionality could be useful as a core
databox function (currently missing).

Status: just starting - imported from quickstart

Todo: 
- change names
- implement :-)

Chris Greenhalgh, The University of Nottinhgam, 2019.

## Data source

The datasource type is "message-view:1".
The store type is ts/blob.
The data type is a JSON object with fields:
- `title` (string) message title
- `topic` (string) optional message topic (used to thread messages)
- `content` (string) message content, html
- `priority` (number) priority used to sort messages, default 0

e.g.
```
{
  "data": {
    "title":"An example message",
    "topic":"Testing",
    "content":"<p>Hello! great news...</p>",
    "priority":1
  },
  "timestamp": 123456789
}
```

Time is taken from TS time.

## Design notes

client-side message state:
- read
- archived

group messages by topic.

future version might have additional requirements for archiving messages.

prompt at top with unread/new messages.

