var path = require('path')
var fs = require('fs')
var test = require('tape')
var hyperdrive = require('hyperdrive')
var ram = require('random-access-memory')
var memdb = require('memdb')
var messages = require('hyperdrive/lib/messages')
var rimraf = require('rimraf')
var archiver = require('..')
var tmp = path.join(__dirname, 'tmp')

var archives
var archive

test('prep', function (t) {
  rimraf(tmp, function () {
    archives = archiver({ db: memdb(), dir: tmp })
    t.end()
  })
})

test('add new feed key', function (t) {
  t.plan(19)

  archive = hyperdrive(ram)

  archive.on('ready', function () {
    var stream = fs.createReadStream(path.join(__dirname, 'archive.js')).pipe(archive.createWriteStream('archive.js'))

    stream.on('end', function () {
      archives.changes(function (err, changeFeed) {
        t.ifError(err, 'changes error')

        changeFeed.get(0, function (err, data) {
          t.ifError(err, 'changes feed get error')
          t.same(changeFeed.length, 1, 'one block in change feed')
          data = JSON.parse(data)
          t.same(data.key, archive.key.toString('hex'), 'changes key okay')
          t.same(data.type, 'add', 'changes type add')
        })
      })

      archives.on('add', function (key) {
        t.same(key, archive.key, 'add event key okay')
      })

      archives.once('archived', function (key, archiveMeta) {
        // metadata feed
        t.ok(key.equals(archive.key), 'archived metadata key okay')

        archiveMeta.get(1, {valueEncoding: messages.Index}, function (err, entry) {
          // block #1 is first entry
          t.ifError(err, 'archiveMeta get error')
          t.same(entry.type, '/archive.js', 'feed has archive.js entry')
        })

        archives.get(archive.key, function (err, meta, content) {
          t.ifError(err, 'get error')
          t.ok(meta, 'has meta')
          t.ok(content, 'has content')
        })
      })

      archives.add(archive.key, function (err) {
        t.ifError(err, 'add error')

        archive.stat('archive.js', function (err, stat) {
          t.ifError(err, 'no err')

          archive.readFile('archive.js', function (err, file) {
            t.ifError(err, 'no err')
            t.equals(file.length, stat.size, 'size is same')
          })
        })

        archives.list(function (err, data) {
          t.ifError(err, 'list error')
          t.same(data.length, 1, 'archives.list has one key')
          t.same(data[0], archive.key, 'archive.list has correct key')
        })
      })

      replicate(archives, archive)
    })
  })
})

test('add duplicate archive key', function (t) {
  t.plan(6)

  archives.add(archive.key, function (err) {
    t.ifError(err, 'add error')

    archives.list(function (err, data) {
      t.ifError(err, 'list error')
      t.same(data.length, 1, 'archives.list has one key')
      t.same(data[0], archive.key, 'archive.list has correct key')
    })

    archives.changes(function (err, changeFeed) {
      t.ifError(err, 'changes error')
      t.same(changeFeed.length, 1, 'one block still in changeFeed')
    })
  })
})

test('remove existing key', function (t) {
  t.plan(8)

  archives.remove(archive.key, function (err) {
    t.ifError(err, 'remove error')

    archives.changes(function (err, changeFeed) {
      t.ifError(err, 'changes error')

      changeFeed.get(1, function (err, data) {
        t.ifError(err, 'change feed get block err')
        t.same(changeFeed.length, 2, 'two blocks in changeFeed')
        data = JSON.parse(data)
        t.same(data.type, 'remove', 'change type is removed')
        t.same(data.key, archive.key.toString('hex'), 'change has correct key')
      })
    })

    archives.list(function (err, data) {
      t.ifError(err, 'list error')
      t.same(data.length, 0, 'archives.list does not have any keys')
    })
  })
})

test('cleanup', function (t) {
  rimraf(tmp, function () {
    t.end()
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
