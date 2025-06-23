const { Protocol } = require('./lib/protocol')
const { Node } = require('./lib/node')
const { NodeProxy } = require('./lib/node-proxy')

module.exports = Node

module.exports.relay = function relay (dht, stream, sharedResourceManager, options = {}) {
  const { resourceManagerOptions = {} } = options
  const protocol = new Protocol(stream)

  return new Promise((resolve) => {
    const onHandshake = (message) => {
      const node = new NodeProxy(dht, protocol, {
        publicKey: message.publicKey,
        secretKey: message.secretKey
      }, sharedResourceManager, resourceManagerOptions)

      resolve(node)
    }

    protocol
      .once('handshake', onHandshake)
      .heartbeat()
  })
}
