var hypercore = require('hypercore')
var level = require('level')
var path = require('path')
var storage = require('random-access-file')
var encoding = require('hyperdrive-encoding')
var subleveldown = require('subleveldown')
var collect = require('stream-collector')
var eos = require('end-of-stream')
var events = require('events')
var datKeyAs = require('dat-key-as')

module.exports = create

function create (dir) {
  if (!dir) dir = '.'

  var db = level(path.join(dir, 'db'))
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

  return that

  function list (cb) {
    return collect(keys.createValueStream(), cb)
  }

  function cleanup (feed, stream) {
    var hex = feed.discoveryKey.toString('hex')
    opened[hex] = (opened[hex] || 0) + 1

    if (stream.destroyed) return close()
    eos(stream, close)

    function close () {
      if (--opened[hex]) return
      feed.close()
    }
  }

  function replicate () {
    var stream = core.replicate()

    stream.setMaxListeners(0)
    stream.on('open', function (disc) {
      keys.get(disc.toString('hex'), function (err, key) {
        if (err) return // ignore errors
        open(key, true, stream)
      })
    })

    return stream
  }

  function add (key, cb) {
    key = datKeyAs.buf(key)
    that.emit('add', key)
    keys.put(hypercore.discoveryKey(key).toString('hex'), key, cb)
  }

  function remove (key, cb) {
    key = datKeyAs.buf(key)
    that.emit('remove', key)
    keys.del(hypercore.discoveryKey(key).toString('hex'), cb)
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

    var feed = core.createFeed(key, {
      storage: storage(path.join(dir, 'data', key.slice(0, 2), key.slice(2) + '.data'))
    })

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
