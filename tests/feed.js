var test = require('tape')
var hypercore = require('hypercore')
var ram = require('random-access-memory')
var memdb = require('memdb')
var archiver = require('..')

var archives
var feed

test('prep', function (t) {
  archives = archiver({ db: memdb(), storage: ram })
  t.end()
})

test('add new feed key', function (t) {
  t.plan(13)

  feed = hypercore(ram)

  feed.append(['hello', 'world'], function () {
    archives.changes(function (err, changeFeed) {
      t.ifError(err, 'changes error')

      changeFeed.get(0, function (err, data) {
        t.ifError(err, 'changes feed get error')
        t.same(changeFeed.length, 1, 'one block in change feed')
        data = JSON.parse(data)
        t.same(data.key, feed.key.toString('hex'), 'changes key okay')
        t.same(data.type, 'add', 'changes type add')
      })
    })

    archives.on('add', function (key) {
      t.same(key, feed.key, 'add event key okay')
    })

    archives.once('archived', function (key, archivedFeed) {
      console.log('archived called', key)
      t.same(key, feed.key, 'archived event key okay')

      archivedFeed.get(0, function (err, data) {
        t.ifError(err, 'feed get error')
        t.same(data.toString(), 'hello', 'feed block: 0 is correct')
      })
    })

    archives.add(feed.key, function (err) {
      t.ifError(err, 'add error')

      archives.list(function (err, data) {
        t.ifError(err, 'list error')
        t.same(data.length, 1, 'archives.list has one key')
        t.same(data[0], feed.key, 'archive.list has correct key')
      })
    })

    replicate(archives, feed)
  })
})

test('add duplicate feed key', function (t) {
  t.plan(6)

  archives.add(feed.key, function (err) {
    t.ifError(err, 'add error')

    archives.list(function (err, data) {
      t.ifError(err, 'list error')
      t.same(data.length, 1, 'archives.list has one key')
      t.same(data[0], feed.key, 'archive.list has correct key')
    })

    archives.changes(function (err, changeFeed) {
      t.ifError(err, 'changes error')
      t.same(changeFeed.length, 1, 'one block still in changeFeed')
    })
  })
})

test('replicate to hypercore from archiver', function (t) {
  t.plan(4)

  var clone = hypercore(ram)

  clone.get(0, function (err, data) {
    t.ifError(err, 'clone get error')
    t.same(data.toString(), 'hello', 'clone receives feed data')
  })

  clone.get(1, function (err, data) {
    t.ifError(err, 'clone get error')
    t.same(data.toString(), 'world', 'clone receives feed data')
  })

  replicate(clone, archives)
})

test('remove existing key', function (t) {
  t.plan(10)

  archives.on('remove', function (key) {
    t.pass('remove event')
    t.same(key, feed.key, 'remove event with right key')
  })

  archives.remove(feed.key, function (err) {
    t.ifError(err, 'remove error')

    archives.changes(function (err, changeFeed) {
      t.ifError(err, 'changes error')

      changeFeed.get(1, function (err, data) {
        t.ifError(err, 'change feed get block err')
        t.same(changeFeed.length, 2, 'two blocks in changeFeed')
        data = JSON.parse(data)
        t.same(data.type, 'remove', 'change type is removed')
        t.same(data.key, feed.key.toString('hex'), 'change has correct key')
      })
    })

    archives.list(function (err, data) {
      t.ifError(err, 'list error')
      t.same(data.length, 0, 'archives.list does not have any keys')
    })
  })
})

function replicate (dest, source) {
  var stream1 = dest.replicate()
  var stream2 = source.replicate()
  stream1.pipe(stream2).pipe(stream1)
  return {
    stream1: stream1,
    stream2: stream2
  }
}
