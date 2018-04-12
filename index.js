var hypercore = require('hypercore')
var protocol = require('hypercore-protocol')
var path = require('path')
var raf = require('random-access-file')
var thunky = require('thunky')
var toBuffer = require('to-buffer')
var util = require('util')
var events = require('events')
var datcat = require('datcat')
var pump = require('pump')
var through = require('through2')
var debug = require('debug')('hypercore-archiver')

module.exports = Archiver

function Archiver (storage, key, opts) {
  if (!(this instanceof Archiver)) return new Archiver(storage, key, opts)
  events.EventEmitter.call(this)

  if (key && typeof key !== 'string' && !Buffer.isBuffer(key)) {
    opts = key
    key = null
  }
  if (!opts) opts = {}

  var self = this

  this.storage = defaultStorage(storage)
  this.changes = hypercore(this.storage.changes, key, {valueEncoding: 'json'})
  this.sparse = !!opts.sparse
  this.feeds = {}
  this.archives = {}
  this._ondownload = ondownload
  this._onupload = onupload
  this.ready = thunky(open)
  this.ready()

  function ondownload (index, data, peer) {
    self.emit('download', this, index, data, peer)
  }

  function onupload (index, data, peer) {
    self.emit('upload', this, index, data, peer)
  }

  function open (cb) {
    self._open(cb)
  }
}

util.inherits(Archiver, events.EventEmitter)

Archiver.prototype._open = function (cb) {
  var self = this
  var latest = {}
  var i = 0

  this.changes.createReadStream()
    .on('data', ondata)
    .on('error', cb)
    .on('end', onend)

  function ondata (data) {
    i++
    if (data.type === 'add') latest[data.key] = true
    else delete latest[data.key]
  }

  function onend () {
    self.emit('changes', self.changes)
    if (!self.changes.writable) self._tail(i)

    var keys = Object.keys(latest)
    loop(null)

    function loop (err) {
      if (err) return cb(err)
      var next = keys.length ? toBuffer(keys.shift(), 'hex') : null
      debug('open changes key', next && next.toString('hex'))
      if (next) return self._add(next, loop)
      self.emit('ready')
      cb(null)
    }
  }
}

Archiver.prototype._tail = function (i) {
  var self = this

  self.changes.createReadStream({live: true, start: i})
    .on('data', function (data) {
      if (data.type === 'add') self._add(toBuffer(data.key, 'hex'))
      else self._remove(toBuffer(data.key, 'hex'))
    })
    .on('error', function (err) {
      self.emit('error', err)
    })
}

Archiver.prototype.list = function (cb) {
  var self = this

  this.ready(function (err) {
    if (err) return cb(err)

    var keys = []
    var a = Object.keys(self.feeds)
    var b = Object.keys(self.archives)
    var i = 0

    debug('list, feeds length', a.length)
    debug('list, archive length', b.length)

    for (i = 0; i < a.length; i++) keys.push(self.feeds[a[i]].key)
    for (i = 0; i < b.length; i++) keys.push(self.archives[b[i]].metadata.key)

    cb(null, keys)
  })
}

Archiver.prototype.get = function (key, cb) {
  var self = this
  key = toBuffer(key, 'hex')
  this.ready(function (err) {
    if (err) return cb(err)

    var dk = hypercore.discoveryKey(key).toString('hex')
    var archive = self.archives[dk]
    if (archive) return cb(null, archive.metadata, archive.content)

    var feed = self.feeds[dk]
    if (feed) return cb(null, feed)

    cb(new Error('Could not find feed'))
  })
}

Archiver.prototype.add = function (key, cb) {
  if (!cb) cb = noop
  var self = this

  key = toBuffer(key, 'hex')
  this.ready(function (err) {
    if (err) return cb(err)
    if (!self._add(key)) return cb(null)
    self.changes.append({type: 'add', key: key.toString('hex')}, cb)
  })
}

Archiver.prototype.remove = function (key, cb) {
  if (!cb) cb = noop
  var self = this

  key = toBuffer(key, 'hex')
  this.ready(function (err) {
    if (err) return cb(err)
    if (self._remove(key, cb)) {
      self.changes.append({type: 'remove', key: key.toString('hex')})
    }
  })
}

Archiver.prototype.status = function (key, cb) {
  if (!cb) cb = noop
  var self = this

  self.ready(function (err) {
    if (err) return cb(err)
    self.get(key, function (err, feed, content) {
      if (err) return cb(err)
      if (content && content.length === 0 && feed.length > 1) {
        return content.update(function () {
          self.status(key, cb)
        })
      }
      if (!content) content = {length: 0}
      var need = feed.length + content.length
      var have = need - blocksRemain(feed) - blocksRemain(content)
      return cb(null, { key: key, need: need, have: have })
    })

    function blocksRemain (feed) {
      if (!feed.length) return 0
      var remaining = 0
      for (var i = 0; i < feed.length; i++) {
        if (!feed.has(i)) remaining++
      }
      return remaining
    }
  })
}

Archiver.prototype.import = function (key, cb) {
  if (!cb) cb = noop
  var self = this

  this.ready(function (err) {
    if (err) return cb(err)
    var keys = {}
    var feeds = datcat(key)
    var collect = function (item, enc, next) {
      try { item = JSON.parse(item) } catch (e) { return next(e) }
      if (!item.type && !item.key) return next(new Error('feed does not contain importable keys'))
      if (item.type && item.type === 'hyperdrive') return next(new Error('feed is a hyperdrive, not importable'))
      if (item.type === 'add') keys[item.key] = true
      if (item.type === 'remove') delete keys[item.key]
      next()
    }
    pump(feeds, through.obj(collect), function (err) {
      if (err) return cb(err)
      var list = Object.keys(keys)
      if (list.length === 0) return cb(new Error('got zero feeds'))
      function next () {
        var item = list.shift()
        if (!item) return cb()
        self.add(item, function (err) {
          if (err) return cb(err)
          next()
        })
      }
      next()
    })
  })
}

Archiver.prototype.replicate = function (opts) {
  if (!opts) opts = {}

  if (opts.discoveryKey) opts.discoveryKey = toBuffer(opts.discoveryKey, 'hex')
  if (opts.key) opts.discoveryKey = hypercore.discoveryKey(toBuffer(opts.key, 'hex'))

  var stream = protocol({live: true, id: this.changes.id, encrypt: opts.encrypt})
  var self = this

  stream.on('feed', add)
  if (opts.channel || opts.discoveryKey) add(opts.channel || opts.discoveryKey)

  function add (dk) {
    self.ready(function (err) {
      if (err) return stream.destroy(err)
      if (stream.destroyed) return

      var hex = dk.toString('hex')
      var changesHex = self.changes.discoveryKey.toString('hex')

      var archive = self.archives[hex]
      if (archive) return onarchive()

      var feed = changesHex === hex ? self.changes : self.feeds[hex]
      if (feed) return onfeed()

      function onarchive () {
        archive.metadata.replicate({
          stream: stream,
          live: true
        })
        archive.content.replicate({
          stream: stream,
          live: true
        })
      }

      function onfeed () {
        if (stream.destroyed) return

        stream.on('close', onclose)
        stream.on('end', onclose)

        feed.on('_archive', onarchive)
        feed.replicate({
          stream: stream,
          live: true
        })

        function onclose () {
          feed.removeListener('_archive', onarchive)
        }

        function onarchive () {
          if (stream.destroyed) return

          var content = self.archives[hex].content
          content.replicate({
            stream: stream,
            live: true
          })
        }
      }
    })
  }

  return stream
}

Archiver.prototype._remove = function (key, cb) {
  var dk = hypercore.discoveryKey(key).toString('hex')

  var feed = this.feeds[dk]

  if (feed) {
    delete this.feeds[dk]
    this.emit('remove', feed)
    feed.removeListener('download', this._ondownload)
    feed.removeListener('upload', this._onupload)
    feed.close(cb)
    return true
  }

  var archive = this.archives[dk]
  if (!archive) {
    cb()
    return false
  }

  delete this.archives[dk]
  this.emit('remove', archive.metadata, archive.content)
  archive.metadata.removeListener('download', this._ondownload)
  archive.metadata.removeListener('upload', this._onupload)
  archive.content.removeListener('download', this._ondownload)
  archive.content.removeListener('upload', this._onupload)
  archive.metadata.close(function () {
    archive.content.close(cb)
  })

  return true
}

Archiver.prototype._add = function (key, cb) {
  var dk = hypercore.discoveryKey(key).toString('hex')
  var self = this
  var emitted = false
  var content = null
  var archive = null

  debug('_add, exists:', this.feeds[dk] || this.archives[dk])
  if (this.feeds[dk] || this.archives[dk]) return false

  var feed = this.feeds[dk] = hypercore(storage(key), key, {sparse: this.sparse})
  var downloaded = false

  feed.on('download', ondownload)
  feed.on('download', this._ondownload)
  feed.on('upload', this._onupload)

  feed.ready(function (err) {
    if (err) return
    if (!feed.has(0)) emit()

    feed.get(0, function (_, data) {
      var contentKey = parseContentKey(data)

      if (!contentKey) {
        feed.on('sync', onsync)
        emit()
        if (isSynced(feed) && downloaded) onsync()
        return
      }

      debug('_add, was removed', self.feeds[dk] !== feed)
      if (self.feeds[dk] !== feed) return // was removed

      content = hypercore(storage(contentKey), contentKey, {sparse: self.sparse})
      content.on('download', ondownload)
      content.on('download', self._ondownload)
      content.on('upload', self._onupload)
      content.on('sync', onsync)
      feed.on('sync', onsync)

      delete self.feeds[dk]
      archive = self.archives[dk] = {
        metadataSynced: isSynced(feed),
        metadata: feed,
        contentSynced: isSynced(content),
        content: content
      }

      feed.emit('_archive')
      self.emit('add-archive', feed, content)
      emit()
      if (archive.metadataSynced && archive.contentSynced && downloaded) onsync()
    })
  })

  return true

  function emit () {
    if (emitted) return
    emitted = true
    self.emit('add', feed, content)
    if (cb) cb()
  }

  function ondownload () {
    downloaded = true
    if (!archive) return
    if (this === feed) archive.metadataSynced = false
    else archive.contentSynced = false
  }

  function onsync () {
    if (archive) {
      if (self.archives[dk] !== archive) return
      if (this === content) archive.contentSynced = true
      else archive.metadataSynced = true
      if (archive.metadataSynced && archive.contentSynced) self.emit('sync', feed, content)
    } else {
      if (self.feeds[dk] !== feed) return
      self.emit('sync', feed, null)
    }
  }

  function storage (key) {
    var dk = hypercore.discoveryKey(key).toString('hex')
    var prefix = dk.slice(0, 2) + '/' + dk.slice(2, 4) + '/' + dk.slice(4) + '/'

    return function (name) {
      return self.storage.feeds(prefix + name)
    }
  }
}

function noop () {}

function isSynced (feed) {
  if (!feed.length) return false
  for (var i = 0; i < feed.length; i++) {
    if (!feed.has(i)) return false
  }
  return true
}

function defaultStorage (st) {
  if (typeof st === 'string') {
    return {
      changes: function (name) {
        return raf(path.join(st, 'changes', name))
      },
      feeds: function (name) {
        return raf(path.join(st, 'feeds', name))
      }
    }
  }

  if (typeof st === 'function') {
    return {
      changes: function (name) {
        return st('changes/' + name)
      },
      feeds: function (name) {
        return st('feeds/' + name)
      }
    }
  }

  return st
}

function parseContentKey (data) {
  var hex = data && data.toString('hex')
  if (!hex || hex.indexOf(toBuffer('hyperdrive').toString('hex')) === -1 || hex.length < 64) return
  return toBuffer(hex.slice(-64), 'hex')
}
