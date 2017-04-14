var hypercore = require('hypercore')
var protocol = require('hypercore-protocol')
var level = require('level')
var path = require('path')
var raf = require('random-access-file')
var encoding = require('hyperdrive/lib/messages')
var subleveldown = require('subleveldown')
var collect = require('stream-collector')
var eos = require('end-of-stream')
var events = require('events')
var datKeyAs = require('dat-key-as')
var thunky = require('thunky')

module.exports = create

function create (opts) {
  opts = opts || {}
  if (typeof opts === 'string') opts = { dir: opts }

  var dir = opts.dir || '.'
  var db = opts.db || level(path.join(dir, 'db'))
  var storage = opts.storage || raf

  var misc = subleveldown(db, 'misc', {valueEncoding: 'binary'})
  var keys = subleveldown(db, 'added-keys', {valueEncoding: 'binary'})
  var noContent = subleveldown(db, 'no-content', {valueEncoding: 'binary'})
  var opened = {}
  var that = new events.EventEmitter()

  that.db = db
  that.discoveryKey = hypercore.discoveryKey
  that.list = list
  that.add = add
  that.remove = remove
  that.get = get
  that.replicate = replicate

  that.changes = thunky(function (cb) {
    misc.get('changes', function (_, key) {
      var feed = hypercore(storage, key)

      feed.on('ready', function (err) {
        if (err) return cb(err)
        if (key) return cb(null, feed)

        // force flush so we know the owner key is persisted
        feed.flush(function (err) {
          if (err) return cb(err)
          misc.put('changes', feed.key, function (err) {
            if (err) return cb(err)
            cb(null, feed)
          })
        })
      })
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
      opened[hex] = null
      feed.close()
    }
  }

  function replicate (opts) {
    if (!opts) opts = {}

    var stream = protocol(opts)

    stream.setTimeout(5000, stream.destroy)
    stream.setMaxListeners(0)
    stream.on('feed', onopen)

    if (!opts.passive) {
      // non-passive mode, request all keys we currently have
      that.list().on('data', function (key) {
        open(key, true, stream)
      })

      // TODO listen for newly-added feeds and request them too?
    }

    // handler for requests from the other end
    function onopen (disc) {
      // get the changes feed
      that.changes(function (_, feed) {
        // was the changes feed requested?
        if (feed && feed.discoveryKey.toString('hex') === disc.toString('hex')) {
          // replicate that
          feed.replicate({stream: stream})
          return
        }

        // is it a feed we possess?
        keys.get(disc.toString('hex'), function (err, key) {
          if (err) {
            return
          }
          // replicate that
          open(key, true, stream)
        })
      })
    }

    return stream
  }

  function add (key, opts, cb) {
    if (typeof opts === 'function') return add(key, null, opts)
    if (!opts) opts = {}

    key = datKeyAs.buf(key)

    var hex = hypercore.discoveryKey(key).toString('hex')
    keys.get(hex, function (err) {
      if (!err) return cb()

      if (opts.content === false) noContent.put(hex, key, done)
      else noContent.del(hex, key, done)
    })

    function done (err) {
      if (err) return cb(err)
      keys.put(hex, key, function (err) {
        if (!err) that.emit('add', key)
        cb(err)
      })
      append({type: 'add', key: key.toString('hex')})
    }
  }

  function remove (key, cb) {
    key = datKeyAs.buf(key)
    var hex = hypercore.discoveryKey(key).toString('hex')
    keys.get(hex, function (err) {
      if (err) return cb()
      keys.del(hex, function (err) {
        if (!err) that.emit('remove', key)
        cb(err)
      })
      append({type: 'remove', key: key.toString('hex')})
    })
  }

  function get (key, cb) {
    key = datKeyAs.buf(key)
    var discKey = hypercore.discoveryKey(key).toString('hex')
    keys.get(discKey, function (err, key) {
      if (err) return cb(err) // no key found

      key = datKeyAs.str(key)
      var feed = hypercore(path.join(dir, 'data', key.slice(0, 2), key.slice(2) + '.data'), key)

      noContent.get(discKey, function (err) {
        if (!err) return done(null)
        feed.get(0, {wait: false}, function (err, data) {
          if (err) {
            if (err.notFound) return done(null)
            return cb(err)
          }
          var content = hyperdriveFeedKey(data)
          if (content || !feed.length) return done(content)
          feed.get(feed.length - 1, {wait: false}, function (err, data) {
            if (err) {
              if (err.notFound) return done(null)
              return cb(err)
            }
            done(hyperdriveFeedKey(data))
          })
        })
      })

      function done (contentKey) {
        if (!opened[discKey]) opened[discKey] = {feed: feed, cnt: 0}
        opened[discKey].cnt++

        if (!contentKey) return cb(null, feed)

        contentKey = datKeyAs.str(contentKey)
        var contentFeed = hypercore(
          path.join(dir, 'data', contentKey.slice(0, 2), contentKey.slice(2) + '.data'),
          contentKey,
          {sparse: opts.sparse}
        )
        var contentDiscKey = hypercore.discoveryKey(contentKey).toString('hex')

        if (!opened[contentDiscKey]) opened[contentDiscKey] = {feed: contentFeed, cnt: 0}
        opened[contentDiscKey].cnt++
        cb(null, feed, contentFeed)
      }
    })
  }

  function open (key, maybeContent, stream, isContent) {
    if (stream.destroyed) return
    key = datKeyAs.str(key)

    var hex = that.discoveryKey(new Buffer(key, 'hex')).toString('hex')
    var old = opened[hex] || {feed: null, cnt: 0}
    var feed = old.feed

    opened[hex] = old

    if (!feed) {
      old.feed = feed = hypercore(
        path.join(dir, 'data', key.slice(0, 2), key.slice(2) + '.data'),
        key,
        {sparse: opts.sparse && isContent}
      )
    }

    old.cnt++
    feed.replicate({stream: stream})

    if (!feed.firstDownload) {
      var downloaded = false

      feed.firstDownload = true
      feed.once('download', function () {
        downloaded = true
      })
      feed.on('sync', function () {
        if (downloaded) that.emit('archived', feed.key, feed)
      })
    }

    cleanup(feed, stream)

    if (!maybeContent) return feed

    noContent.get(feed.discoveryKey.toString('hex'), function (err) {
      if (!err) return
      feed.get(0, function (err, data) {
        if (!decodeContent(err, data) && feed.length) {
          feed.get(feed.length - 1, decodeContent)
        }
      })
    })

    return feed

    function decodeContent (err, data) {
      if (err) return false
      var content = hyperdriveFeedKey(data)
      if (!content) return false
      open(content, false, stream, true)
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
