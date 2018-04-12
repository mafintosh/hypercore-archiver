# hypercore-archiver

Easily archive multiple [hypercores](https://github.com/mafintosh/hypercore) or [hyperdrives](https://github.com/mafintosh/hyperdrive)

## Usage

``` js
var archiver = require('hypercore-archiver')
var hypercore = require('hypercore')

var ar = archiver('./my-archiver') // also supports passing in a storage provider
var feed = hypercore('./my-feed')

feed.on('ready', function () {
  ar.add(feed.key, function (err) {
    console.log('will now archive the feed')
  })
})

ar.on('sync', function (feed) {
  console.log('feed is synced', feed.key)
})

// setup replication
var stream = ar.replicate()
stream.pipe(feed.replicate({live: true})).pipe(stream)

feed.append(['hello', 'world'])
```

## API

#### `var ar = archiver(storage, [key], [options])`

Create a new archvier. `storage` can be a file system path or a storage provider like [random-access-memory](https://github.com/mafintosh/random-access-memory).

If this archiver is a clone of another archiver pass the changes feed key as the 2nd argument.

Options include

``` js
{
  sparse: false // set to true to only archive blocks you request
}
```

##### Sparse File Storage

The sparse option uses sparse file mode, only available on some file systems. It will appear as a full size file but only take up the space actually used on disk.

* Use `ls -alsh` to view the actual size (first column)
* sparse file mode (APFS) is not available on Mac OSX.

#### `ar.add(key, [callback])`

Add a new hypercore or hyperdrive key to be archived.

#### `ar.remove(key, [callback])`

Remove a key.

#### `ar.list(callback)`

List all hypercores and hyperdrives being archived.

#### `ar.import(archiverKey, callback)`

Add all hypercores archived in another hypercore-archiver instance

#### `ar.get(key, callback)`

Retrieve the feed being archived. If the key points to a hyperdrive the callback is called with `(err, metadataFeed, contentFeed)`

#### `ar.changes`

A changes feed containing the archiver state. Pass the changes feed key to another hypercore archiver to replicate the archiver and all feeds

#### `var stream = ar.replicate([options])`

Create a replication stream. Per defaults the archiver will replicate any feed the remote asks for.
To have the archiver ask to replicate one pass in `{key: feedKey}` as an option.


#### `ar.on('add', feed)`

Emitted when a feed is being added

#### `ar.on('add-archive', metadataFeed, contentFeed)`

Emitted if a feed is identified as a [Hyperdrive](https://github.com/mafintosh/hyperdrive) archive

#### `ar.on('remove', feed)`

Emitted when a feed is being removed

#### `ar.on('sync', feed)`

Emitted when a feed has been fully synced

#### `ar.on('download', feed, index, data, peer)`

Emitted when the archiver downloads a block of data

#### `ar.on('upload', feed, index, data, peer)`

Emitted when the archiver uploads a block of data

#### `ar.on('ready')`

Emitted when all internal state has been loaded (the changes feed will be set). You do not have to wait for this event before calling any async function.

## Network Swarm

The archiver comes with a network swarm as well. This will make the archiver replicate over the internet and local network.
To use it do:

``` js
var swarm = require('hypercore-archiver/swarm')
swarm(archiver)
```

The swarm listens on port 3282, both tcp and udp. If you require a different port, pass in the port as an option

```js
var swarm = require('hypercore-archiver/swarm')
swarm(archiver, {port: 60234})
```

## License

MIT
