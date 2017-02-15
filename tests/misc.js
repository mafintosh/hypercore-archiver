var test = require('tape')
var ram = require('random-access-memory')
var hypercore = require('hypercore')
var memdb = require('memdb')
var archiver = require('..')

var archives
var feed

test('prep', function (t) {
  archives = archiver({ db: memdb(), storage: ram })
  var core = hypercore(memdb())
  feed = core.createFeed()
  t.end()
})

test('add key as string', function (t) {
  archives.add(feed.key.toString('hex'), function (err) {
    t.ifError(err, 'okay adding string key')
    t.end()
  })
})

test('remove key as string', function (t) {
  archives.remove(feed.key.toString('hex'), function (err) {
    t.ifError(err, 'okay removing string key')
    archives.list(function (err, data) {
      t.ifError(err, 'archives list error')
      t.ok(data.length === 0, 'no key in list')
      t.end()
    })
  })
})
