var tape = require('tape')
var ram = require('random-access-memory')
var hyperdrive = require('hyperdrive')
var tmp = require('temporary-directory')
var archiver = require('../')

tape('add archive', function (t) {
  var archive = hyperdrive(ram)

  archive.writeFile('/hello.txt', 'world', function () {
    var a = archiver(ram)

    a.add(archive.key, function () {
      var stream = archive.replicate()
      stream.pipe(a.replicate()).pipe(stream)
    })

    a.on('sync', function () {
      t.pass('synced')
      a.get(archive.key, function (_, metadata, content) {
        t.pass('has metadata', !!metadata)
        t.pass('has content', !!content)
        t.end()
      })
    })
  })
})

tape('list archives', function (t) {
  var archive = hyperdrive(ram)

  archive.writeFile('/hello.txt', 'world', function () {
    var a = archiver(ram)

    a.add(archive.key, function () {
      a.list(function (err, list) {
        t.error(err, 'no error')
        t.same(list, [archive.key])
        t.end()
      })
    })
  })
})

tape('list archives on disk', function (t) {
  var archive = hyperdrive(ram)

  tmp(function (_, dir, cleanup) {
    archive.writeFile('/hello.txt', 'world', function () {
      var a = archiver(dir)

      a.add(archive.key, function () {
        a.list(function (err, list) {
          t.error(err, 'no error')
          t.same(list, [archive.key])

          var a2 = archiver(dir)
          a2.list(function (err, list) {
            t.error(err, 'no error')
            t.same(list, [archive.key])
            cleanup(function () {
              t.end()
            })
          })
        })
      })
    })
  })
})
