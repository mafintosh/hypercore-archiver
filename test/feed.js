var tape = require('tape')
var ram = require('random-access-memory')
var hypercore = require('hypercore')
var archiver = require('../')

tape('add feed', function (t) {
  var feed = hypercore(ram)
  var a = archiver(ram)

  feed.append(['hello', 'world'], function () {
    a.once('sync', function () {
      t.pass('should sync')
      a.once('sync', function () {
        t.pass('should sync again')
        t.end()
      })
      feed.append(['a', 'b', 'c'])
    })

    a.add(feed.key, function () {
      var stream = feed.replicate({live: true})
      stream.pipe(a.replicate()).pipe(stream)
    })
  })
})

tape('add feed and replicate to other', function (t) {
  var feed = hypercore(ram)
  var a = archiver(ram)

  feed.append(['hello', 'world', 'a', 'b', 'c'], function () {
    a.add(feed.key, function () {
      var stream = feed.replicate({live: true})
      stream.pipe(a.replicate()).pipe(stream)
    })
  })

  a.on('add', function () {
    var clone = hypercore(ram, feed.key)

    var stream = clone.replicate({live: true})
    stream.pipe(a.replicate()).pipe(stream)

    clone.on('sync', function () {
      t.pass('clone synced')
      t.end()
    })
  })
})

tape('changes replicate', function (t) {
  var a = archiver(ram)

  a.ready(function () {
    var b = archiver(ram, a.changes.key)

    var stream = a.replicate()
    stream.pipe(b.replicate({key: a.changes.key})).pipe(stream)

    var feed = hypercore(ram)

    feed.on('ready', function () {
      a.add(feed.key)
      b.on('add', function () {
        t.pass('added feed')
        t.end()
      })
    })
  })
})

tape('list feeds', function (t) {
  var feed = hypercore(ram)

  feed.append('a', function () {
    var a = archiver(ram)

    a.add(feed.key, function () {
      a.list(function (err, list) {
        t.error(err, 'no error')
        t.same(list, [feed.key])
        t.end()
      })
    })
  })
})
