import { ResourceManager } from '../../lib/resource-manager.js'

export function testResourceManager () {
  return new ResourceManager({
    maxConnections: 100,
    maxDataPerConnection: 10 * 1024 * 1024, // 10MB
    maxTotalDataPerClient: 50 * 1024 * 1024, // 50MB
    maxDataRatePerSecond: 1024 * 1024, // 1MB/s
    allowedMessageTypes: ['connect', 'data', 'lookup', 'announce', 'unannounce', 'listen', 'destroy', 'end', 'close']
  })
}
