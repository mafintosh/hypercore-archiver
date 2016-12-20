var hypercore = require('hypercore')
var level = require('level')
var path = require('path')
var raf = require('random-access-file')
var encoding = require('hyperdrive-encoding')
var subleveldown = require('subleveldown')
var collect = require('stream-collector')
var eos = require('end-of-stream')
var events = require('events')
var datKeyAs = require('dat-key-as')
var thunky = require('thunky')

module.exports = create

function create (dbOrDr, storageOpt) {
  if (!dbOrDr) dbOrDr = '.'

  var storage = storageOpt || raf
  var db = typeof dbOrDr === 'string' ? level(path.join(dbOrDr, 'db')) : dbOrDr
  var misc = subleveldown(db, 'misc', {valueEncoding: 'binary'})
  var keys = subleveldown(db, 'added-keys', {valueEncoding: 'binary'})
  var core = hypercore(db)
  var opened = {}
  var that = new events.EventEmitter()

  that.db = db
  that.discoveryKey = hypercore.discoveryKey
  that.core = core
  that.list = list
  that.add = add
  that.remove = remove
  that.get = get
  that.replicate = replicate

  that.changes = thunky(function (cb) {
    misc.get('changes', function (_, key) {
      var feed = core.createFeed(key)

      if (key) return open()
      misc.put('changes', feed.key, open)

      function open (err) {
        if (err) return cb(err)
        feed.open(function (err) {
          if (err) return cb(err)
          cb(null, feed)
        })
      }
    })
  })

  return that

  function list (cb) {
    return collect(keys.createValueStream(), cb)
  }

  function append (change) {
    that.changes(function (_, feed) {
      if (feed && feed.secretKey) feed.append(JSON.stringify(change) + '\n')
    })
  }

  function cleanup (feed, stream) {
    var hex = feed.discoveryKey.toString('hex')
    var old = opened[hex]

    if (stream.destroyed) return close()
    eos(stream, close)

    function close () {
      if (--old.cnt) return
      old.feed = null
      feed.close()
    }
  }

  function replicate (opts) {
    if (!opts) opts = {}

    var stream = core.replicate()

    stream.setTimeout(5000, stream.destroy)
    stream.setMaxListeners(0)
    stream.on('open', onopen)

    if (!opts.passive) {
      that.list().on('data', function (key) {
        open(key, true, stream)
      })
    }

    function onopen (disc) {
      that.changes(function (_, feed) {
        if (feed && feed.discoveryKey.toString('hex') === disc.toString('hex')) {
          feed.replicate({stream: stream})
          return
        }

        keys.get(disc.toString('hex'), function (err, key) {
          if (err) return // ignore errors
          open(key, true, stream)
        })
      })
    }

    return stream
  }

  function add (key, cb) {
    key = datKeyAs.buf(key)
    that.emit('add', key)

    var hex = hypercore.discoveryKey(key).toString('hex')
    keys.get(hex, function (err) {
      if (!err) return cb()
      keys.put(hex, key, cb)
      append({type: 'add', key: key.toString('hex')})
    })
  }

  function remove (key, cb) {
    key = datKeyAs.buf(key)
    that.emit('remove', key)
    var hex = hypercore.discoveryKey(key).toString('hex')
    keys.get(hex, function (err) {
      if (err) return cb()
      keys.del(hex, cb)
      append({type: 'remove', key: key.toString('hex')})
    })
  }

  function get (key, cb) {
    key = datKeyAs.buf(key)
    var discKey = hypercore.discoveryKey(key).toString('hex')
    keys.get(discKey, function (err, key) {
      if (err) return cb(err) // no key found

      key = datKeyAs.str(key)
      var feed = core.createFeed(key, {
        storage: storage(path.join(dir, 'data', key.slice(0, 2), key.slice(2) + '.data'))
      })
      feed.get(0, function (err, data) {
        if (err) return cb(err)
        var content = hyperdriveFeedKey(data)
        if (content || !feed.blocks) return done(content)
        feed.get(feed.blocks - 1, function (err, data) {
          if (err) return cb(err)
          done(hyperdriveFeedKey(data))
        })
      })

      function done (contentKey) {
        opened[discKey] = (opened[discKey] || 0) + 1
        if (!contentKey) return cb(null, feed)

        contentKey = datKeyAs.str(contentKey)
        var contentFeed = core.createFeed(contentKey, {
          storage: storage(path.join(dir, 'data', contentKey.slice(0, 2), contentKey.slice(2) + '.data'))
        })
        var contentDiscKey = hypercore.discoveryKey(contentKey).toString('hex')
        opened[contentDiscKey] = (opened[contentDiscKey] || 0) + 1

        cb(null, feed, contentFeed)
      }
    })
  }

  function open (key, maybeContent, stream) {
    key = datKeyAs.str(key)

    var hex = that.discoveryKey(new Buffer(key, 'hex')).toString('hex')
    var old = opened[hex] || {feed: null, cnt: 0}
    var feed = old.feed

    opened[hex] = old

    if (!feed) {
      old.feed = feed = core.createFeed(key, {
        storage: storage(path.join(dir, 'data', key.slice(0, 2), key.slice(2) + '.data'))
      })
    }

    old.cnt++
    feed.replicate({stream: stream})

    if (!feed.firstDownload) {
      var downloaded = false

      feed.firstDownload = true
      feed.once('download', function () {
        downloaded = true
      })
      feed.once('download-finished', function () {
        if (downloaded) that.emit('archived', feed.key, feed)
      })
    }

    cleanup(feed, stream)

    if (!maybeContent) return feed

    feed.get(0, function (err, data) {
      if (!decodeContent(err, data) && feed.blocks) feed.get(feed.blocks - 1, decodeContent)
    })

    return feed

    function decodeContent (err, data) {
      if (err) return false
      var content = hyperdriveFeedKey(data)
      if (!content) return false
      open(content, false, stream)
      return true
    }
  }
}

function hyperdriveFeedKey (data) {
  try {
    var index = encoding.decode(data)
    if (index.type !== 'index') return null
    if (!index.content || index.content.length !== 32) return null
    return index.content
  } catch (err) {
    return null
  }
}
