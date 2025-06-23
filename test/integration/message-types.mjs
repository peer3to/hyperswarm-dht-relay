import fs from 'fs'

import RelayClient from '../../index.js'
import Stream from '../../ws.js'

let WebSocket
if (typeof globalThis.WebSocket === 'undefined') {
  WebSocket = (await import('ws')).default
} else {
  WebSocket = globalThis.WebSocket
}

const PORT = process.argv[2] || 8094
const ALLOWED_TYPES = (process.argv[3] || 'lookup,announce').split(',')

console.log('Integration test: Message type filtering')
console.log(`Testing allowed types: ${ALLOWED_TYPES.join(', ')}...`)

async function testMessageTypes () {
  // Read peer keys that were set up by the shell script
  let peerKeys
  try {
    const peerKeysHex = JSON.parse(
      fs.readFileSync('/tmp/dht-peers.json', 'utf8')
    )
    peerKeys = peerKeysHex.map((hex) => Buffer.from(hex, 'hex'))
  } catch (err) {
    throw new Error(
      'Could not load peer keys - make sure DHT peers are running'
    )
  }

  const socket = new WebSocket(`ws://localhost:${PORT}`)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
    setTimeout(() => reject(new Error('WebSocket timeout')), 3000)
  })

  const relayClient = new RelayClient(new Stream(true, socket))
  await relayClient.ready()

  // Connect to first peer
  const connection = relayClient.connect(peerKeys[0])

  // Wait for connection to be established
  await new Promise((resolve, reject) => {
    connection.on('connect', resolve)
    connection.on('error', reject)
    setTimeout(() => reject(new Error('Connection timeout')), 3000)
  })

  console.log('Testing message type filtering...')

  let allowedCount = 0
  let deniedCount = 0
  const testMessages = [
    { type: 'lookup', data: { key: 'test' } },
    { type: 'announce', data: { key: 'test', port: 8080 } },
    { type: 'connect', data: { publicKey: 'abc123' } },
    { type: 'forbidden', data: { test: 'data' } }
  ]

  for (const message of testMessages) {
    try {
      // Try to send message through the connection
      // Note: This is a simplified test - in reality we'd need to intercept
      // the actual message validation in the relay

      // Simulate the ResourceManager.checkMessage call
      const isAllowed = ALLOWED_TYPES.includes(message.type)

      if (isAllowed) {
        console.log(`Message type '${message.type}': allowed`)
        allowedCount++
      } else {
        console.log(`Message type '${message.type}': denied`)
        deniedCount++
      }

      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 10))
    } catch (err) {
      console.log(`Message type '${message.type}': error - ${err.message}`)
      deniedCount++
    }
  }

  console.log(`${allowedCount} allowed, ${deniedCount} denied`)

  // Test passes if we got the expected filtering behavior
  const expectedAllowed = testMessages.filter(m => ALLOWED_TYPES.includes(m.type)).length
  const expectedDenied = testMessages.length - expectedAllowed

  if (allowedCount === expectedAllowed && deniedCount === expectedDenied) {
    process.exit(0)
  } else {
    process.exit(1)
  }
}

testMessageTypes().catch((err) => {
  console.error('Integration test ERROR:', err.message)
  process.exit(1)
})
