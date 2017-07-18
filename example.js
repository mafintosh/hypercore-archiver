var archiver = require('hypercore-archiver')
var hypercore = require('hypercore')

var ar = archiver('./my-archiver') // also supports passing in a storage provider
var feed = hypercore('./my-feed')

feed.on('ready', function () {
  ar.add(feed.key, function () {
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
