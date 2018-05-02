var xtend = require('xtend')
var discoverySwarm = require('discovery-swarm')
var defaults = require('dat-swarm-defaults')

module.exports = swarm

function swarm (archiver, opts) {
  var port = (opts && opts.port) || 3282
  var swarmOpts = xtend({
    hash: false,
    stream: function (opts) {
      return archiver.replicate(opts)
    }
  }, opts)

  var sw = discoverySwarm(defaults(swarmOpts))

  archiver.on('changes', function (feed) {
    sw.join(feed.discoveryKey)
  })

  archiver.on('add', function (feed) {
    sw.join(feed.discoveryKey)
  })

  archiver.on('remove', function (feed) {
    sw.leave(feed.discoveryKey)
  })

  sw.listen(port)
  sw.once('error', function () {
    sw.listen()
  })

  return sw
}
