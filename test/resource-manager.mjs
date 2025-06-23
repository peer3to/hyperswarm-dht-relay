import test from 'brittle'
import crypto from 'crypto'

import { ResourceManager } from '../lib/resource-manager.js'

test('ResourceManager - default limits', (t) => {
  const options = {
    maxConnections: 10,
    maxDataPerConnection: 1024 * 1024, // 1MB
    maxTotalDataPerClient: 10 * 1024 * 1024, // 10MB
    maxDataRatePerSecond: 100 * 1024, // 100KB/s
    allowedMessageTypes: ['connect', 'data', 'lookup']
  }

  const rm = new ResourceManager(options)

  t.is(rm.limits.maxConnections, 10, 'max connections set correctly')
  t.is(rm.limits.maxDataPerConnection, 1024 * 1024, 'max data per connection set correctly')
  t.is(rm.limits.maxTotalDataPerClient, 10 * 1024 * 1024, 'max total data per client set correctly')
  t.is(rm.limits.maxDataRatePerSecond, 100 * 1024, 'max data rate set correctly')
  t.alike(rm.limits.allowedMessageTypes, ['connect', 'data', 'lookup'], 'allowed message types set correctly')
})

test('ResourceManager - number of connections limits', (t) => {
  const rm = new ResourceManager({
    maxConnections: 2,
    maxDataPerConnection: 1000,
    maxTotalDataPerClient: 2000,
    maxDataRatePerSecond: 500,
    allowedMessageTypes: ['connect']
  })

  const publicKey = crypto.randomBytes(32)

  // First connection should be allowed
  let result = rm.checkConnection(publicKey)
  t.ok(result.allowed, 'first connection allowed')

  rm.recordConnection(publicKey, 'conn1')

  // Second connection should be allowed
  result = rm.checkConnection(publicKey)
  t.ok(result.allowed, 'second connection allowed')

  rm.recordConnection(publicKey, 'conn2')

  // Third connection should be denied
  result = rm.checkConnection(publicKey)
  t.not(result.allowed, 'third connection denied')
  t.ok(result.reason.includes('Connection limit exceeded'), 'correct denial reason')

  // After disconnecting one, new connection should be allowed
  rm.recordDisconnection(publicKey, 'conn1')
  result = rm.checkConnection(publicKey)
  t.ok(result.allowed, 'connection allowed after disconnection')
})

test('ResourceManager - per-connection data limits', (t) => {
  const rm = new ResourceManager({
    maxConnections: 5,
    maxDataPerConnection: 1000, // 1KB limit
    maxTotalDataPerClient: 5000,
    maxDataRatePerSecond: 2000,
    allowedMessageTypes: ['connect']
  })

  const publicKey = crypto.randomBytes(32)
  rm.recordConnection(publicKey, 'conn1')

  // Transfer within limit should be allowed
  let result = rm.checkDataTransfer('conn1', 500)
  t.ok(result.allowed, 'data transfer within limit allowed')

  rm.recordDataTransfer('conn1', 0, 500) // 500 bytes outgoing

  // Another 400 bytes should be allowed (total: 900 < 1000)
  result = rm.checkDataTransfer('conn1', 400)
  t.ok(result.allowed, 'additional data transfer within limit allowed')

  rm.recordDataTransfer('conn1', 0, 400)

  // Another 200 bytes should be denied (total: 1100 > 1000)
  result = rm.checkDataTransfer('conn1', 200)
  t.not(result.allowed, 'data transfer exceeding limit denied')
  t.ok(result.reason.includes('Per-connection data limit exceeded'), 'correct denial reason')
})

test('ResourceManager - total client data limits', (t) => {
  const rm = new ResourceManager({
    maxConnections: 5,
    maxDataPerConnection: 1000,
    maxTotalDataPerClient: 1500, // 1.5KB total limit
    maxDataRatePerSecond: 3000,
    allowedMessageTypes: ['connect']
  })

  const publicKey = crypto.randomBytes(32)
  rm.recordConnection(publicKey, 'conn1')
  rm.recordConnection(publicKey, 'conn2')

  // Use 800 bytes on conn1
  rm.recordDataTransfer('conn1', 0, 800)

  // Try to use 800 bytes on conn2 (total would be 1600 > 1500)
  let result = rm.checkDataTransfer('conn2', 800)
  t.not(result.allowed, 'data transfer exceeding total client limit denied')
  t.ok(result.reason.includes('Total client data limit exceeded'), 'correct denial reason')

  // 600 bytes should be allowed (total: 1400 < 1500)
  result = rm.checkDataTransfer('conn2', 600)
  t.ok(result.allowed, 'data transfer within total limit allowed')
})

test('ResourceManager - rate limits', (t) => {
  const rm = new ResourceManager({
    maxConnections: 5,
    maxDataPerConnection: 5000,
    maxTotalDataPerClient: 10000,
    maxDataRatePerSecond: 1000, // 1KB/s rate limit
    allowedMessageTypes: ['connect']
  })

  const publicKey = crypto.randomBytes(32)
  rm.recordConnection(publicKey, 'conn1')

  // First 600 bytes should be allowed
  let result = rm.checkDataTransfer('conn1', 600)
  t.ok(result.allowed, 'first data transfer within rate limit allowed')

  rm.recordDataTransfer('conn1', 0, 600)

  // Another 500 bytes immediately should be denied (total rate: 1100 > 1000)
  result = rm.checkDataTransfer('conn1', 500)
  t.not(result.allowed, 'data transfer exceeding rate limit denied')
  t.ok(result.reason.includes('Data rate limit exceeded'), 'correct denial reason')

  // Another 300 bytes should be allowed (total rate: 900 < 1000)
  result = rm.checkDataTransfer('conn1', 300)
  t.ok(result.allowed, 'data transfer within rate limit allowed')
})

test('ResourceManager - rate limit time window', async (t) => {
  const rm = new ResourceManager({
    maxConnections: 5,
    maxDataPerConnection: 5000,
    maxTotalDataPerClient: 10000,
    maxDataRatePerSecond: 500, // 500 bytes/s
    allowedMessageTypes: ['connect']
  })

  const publicKey = crypto.randomBytes(32)
  rm.recordConnection(publicKey, 'conn1')

  // Use full rate limit
  rm.recordDataTransfer('conn1', 0, 500)

  // Should be denied immediately
  let result = rm.checkDataTransfer('conn1', 100)
  t.not(result.allowed, 'transfer denied when rate limit reached')

  // Wait for rate limit window to reset (1100ms to be safe)
  await new Promise(resolve => setTimeout(resolve, 1100))

  // Should be allowed after time window
  result = rm.checkDataTransfer('conn1', 400)
  t.ok(result.allowed, 'transfer allowed after rate limit window reset')
})

test('ResourceManager - message type filtering', (t) => {
  const rm = new ResourceManager({
    maxConnections: 5,
    maxDataPerConnection: 1000,
    maxTotalDataPerClient: 5000,
    maxDataRatePerSecond: 1000,
    allowedMessageTypes: ['connect', 'lookup'] // Only allow specific types
  })

  const publicKey = crypto.randomBytes(32)

  // Allowed message types
  let result = rm.checkMessage(publicKey, 'connect')
  t.ok(result.allowed, 'allowed message type accepted')

  result = rm.checkMessage(publicKey, 'lookup')
  t.ok(result.allowed, 'allowed message type accepted')

  // Denied message type
  result = rm.checkMessage(publicKey, 'announce')
  t.not(result.allowed, 'disallowed message type denied')
  t.ok(result.reason.includes("Message type 'announce' not allowed"), 'correct denial reason')
})

test('ResourceManager - usage tracking and cleanup', (t) => {
  const rm = new ResourceManager({
    maxConnections: 5,
    maxDataPerConnection: 1000,
    maxTotalDataPerClient: 5000,
    maxDataRatePerSecond: 1000,
    allowedMessageTypes: ['connect']
  })

  const publicKey = crypto.randomBytes(32)

  // Initially no usage
  let usage = rm.getUsage(publicKey)
  t.is(usage.connections, 0, 'initial connections count is 0')
  t.is(usage.totalDataUsage, 0, 'initial data usage is 0')

  // Add connections and data
  rm.recordConnection(publicKey, 'conn1')
  rm.recordConnection(publicKey, 'conn2')
  rm.recordDataTransfer('conn1', 0, 500)
  rm.recordDataTransfer('conn2', 100, 300) // 100 incoming, 300 outgoing

  usage = rm.getUsage(publicKey)
  t.is(usage.connections, 2, 'connections count updated')
  t.is(usage.totalDataUsage, 900, 'total data usage updated (500 + 100 + 300)')
  t.is(usage.activeConnections.size, 2, 'active connections tracked')

  // Test connection data retrieval
  let connData = rm.getConnectionData('conn1')
  t.is(connData.bytesOut, 500, 'connection outgoing bytes tracked')
  t.is(connData.totalBytes, 500, 'connection total bytes calculated')

  connData = rm.getConnectionData('conn2')
  t.is(connData.bytesIn, 100, 'connection incoming bytes tracked')
  t.is(connData.bytesOut, 300, 'connection outgoing bytes tracked')
  t.is(connData.totalBytes, 400, 'connection total bytes calculated')

  // Test disconnection cleanup
  rm.recordDisconnection(publicKey, 'conn1')
  usage = rm.getUsage(publicKey)
  t.is(usage.connections, 1, 'connection count decremented')
  t.is(usage.activeConnections.size, 1, 'active connections updated')
  t.is(rm.getConnectionData('conn1'), undefined, 'connection data cleaned up')
})

test('ResourceManager - canSendData and recordDataSent helpers', (t) => {
  const rm = new ResourceManager({
    maxConnections: 5,
    maxDataPerConnection: 1000,
    maxTotalDataPerClient: 2000,
    maxDataRatePerSecond: 500,
    allowedMessageTypes: ['connect']
  })

  const publicKey = crypto.randomBytes(32)
  rm.recordConnection(publicKey, 'conn1')

  // Test with different data chunk types
  const dataChunks = [
    Buffer.from('hello'), // 5 bytes
    'world', // 5 bytes
    Buffer.from('test') // 4 bytes
  ]
  // Total: 14 bytes

  // Should be allowed
  let result = rm.canSendData('conn1', dataChunks)
  t.ok(result.allowed, 'canSendData allows valid transfer')

  // Record the data
  const success = rm.recordDataSent('conn1', dataChunks)
  t.ok(success, 'recordDataSent succeeds')

  // Check that data was recorded
  const connData = rm.getConnectionData('conn1')
  t.is(connData.bytesOut, 14, 'outgoing bytes recorded correctly')
  t.is(connData.totalBytes, 14, 'total bytes calculated correctly')

  // Test with nonexistent connection
  result = rm.canSendData('nonexistent', dataChunks)
  t.not(result.allowed, 'canSendData denies nonexistent connection')
  t.ok(result.reason.includes('Connection not found'), 'correct error for nonexistent connection')
})
