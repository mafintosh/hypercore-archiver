# hypercore-archiver

A hypercore peer that will backup multiple hypercores/hyperdrives efficiently to disk.

```
npm install hypercore-archiver
```

## Usage

First create a hypercore/hyperdrive somewhere

``` js
var hypercore = require('hypercore')
var memdb = require('memdb')

// create a hypercore feed
var feed = hypercore(memdb()).createFeed()

// append some data
feed.append(['hello', 'world'])

console.log('add this key to the archiver:', feed.key.toString('hex'))
```

Setup the archiver

``` js
var net = require('net')
var pump = require('pump')
var archiver = require('hypercore-archiver')
var ar = archiver('./some-folder')

// add a hypercore/hyperdrive key whose content you want to archive
ar.add(keyPrintedAbove)

// serve the archiver over some stream
var server = net.createServer(function (socket) {
  pump(socket, ar.replicate(), socket)
})

server.listen(10000)
```

Have the client connect to the archiver

``` js
var socket = net.connect(10000)
pump(socket, feed.replicate(), socket)
```

## API

#### `var ar = archiver(folder|db)`

Create a new archiver. Can pass folder or db, where folder is the path to where data will be stored, or db is a level-up compatible instance (eg memdb).

#### `ar.changes(callback)`

Get a hypercore feed with all the changes of the archiver. The format of the messages are JSON and look like this

``` js
{
  type: 'add' | 'remove',
  key: 'key-added-or-removed-in-hex'
}
```

#### `ar.add(key, [callback])`

Add a hypercore/hyperdrive key to backup

#### `ar.remove(key, [callback])`

Remove a key from the backup

#### `ar.get(key, callback)`

Get the feed(s) for a given key. Callback will return `(err, feed)`. If the key is an archive, the callback returns `callback(err, metadataFeed, contentFeed)` which can be used in hyperdrive to create an archive.

#### `var stream = ar.list([callback])`

List all keys currently being backed up

#### `var stream = ar.replicate()`

Create a replication stream. You need to pipe this to another hypercore replication stream somewhere.
If the other peer wants to replicate a key we are backing up it'll be served to them.

## License

MIT
