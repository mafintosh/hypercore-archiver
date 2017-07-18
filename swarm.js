var xtend = require('xtend')
var discoverySwarm = require('discovery-swarm')
var defaults = require('datland-swarm-defaults')

module.exports = swarm

function swarm (archiver, opts) {
  var swarmOpts = xtend({
    port: 3282,
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

  return sw
}
