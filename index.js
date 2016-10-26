var hypercore = require('hypercore')
var level = require('level')
var path = require('path')
var storage = require('random-access-file')
var encoding = require('hyperdrive-encoding')
var subleveldown = require('subleveldown')
var collect = require('stream-collector')
var eos = require('end-of-stream')
var events = require('events')

module.exports = create

function create (dir) {
  if (!dir) dir = '.'

  var db = level(path.join(dir, 'db'))
  var keys = subleveldown(db, 'added-keys', {valueEncoding: 'binary'})
  var core = hypercore(db)
  var opened = {}
  var that = new events.EventEmitter()

  that.discoveryKey = hypercore.discoveryKey
  that.core = core
  that.list = list
  that.add = add
  that.remove = remove
  that.replicate = replicate

  return that

  function list (cb) {
    return collect(keys.createValueStream(), cb)
  }

  function replicate () {
    var stream = core.replicate()

    stream.setMaxListeners(0)
    stream.on('open', function (disc) {
      var hex = disc.toString('hex')
      keys.get(hex, function (err, key) {
        if (err) return // ignore errors
        var feed = open(key, true, stream)
        var cnt = opened[hex] = (opened[hex] || 0) + 1

        if (cnt === 1) {
          var downloaded = false

          feed.once('download', function () {
            downloaded = true
          })
          feed.once('download-finished', function () {
            if (downloaded) that.emit('archived', feed.key)
          })
        }

        eos(stream, function () {
          if (--opened[hex]) return
          feed.close()
        })
      })
    })

    return stream
  }

  function add (key, cb) {
    if (typeof key === 'string') key = new Buffer(key, 'hex')
    that.emit('add', key)
    keys.put(hypercore.discoveryKey(key).toString('hex'), key, cb)
  }

  function remove (key, cb) {
    if (typeof key === 'string') key = new Buffer(key, 'hex')
    that.emit('remove', key)
    keys.del(hypercore.discoveryKey(key).toString('hex'), cb)
  }

  function open (key, maybeContent, stream) {
    if (Buffer.isBuffer(key)) key = key.toString('hex')

    var feed = core.createFeed(key, {
      storage: storage(path.join(dir, 'data', key.slice(0, 2), key.slice(2) + '.data'))
    })

    feed.replicate({stream: stream})

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
