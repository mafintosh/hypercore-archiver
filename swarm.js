var discoverySwarm = require('discovery-swarm')
var defaults = require('datland-swarm-defaults')

module.exports = swarm

function swarm (archiver) {
  var sw = discoverySwarm(defaults({
    port: 3282,
    hash: false,
    stream: function (opts) {
      return archiver.replicate(opts)
    }
  }))

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
