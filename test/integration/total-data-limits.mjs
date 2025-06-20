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
const TOTAL_DATA_LIMIT = parseInt(process.argv[3]) || 2000 // bytes

console.log('Integration test: Total data limits per public key')
console.log(`Testing ${TOTAL_DATA_LIMIT} byte total client limit...`)

async function testTotalDataLimits () {
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

  const connections = []
  let totalSent = 0
  let limitHit = false

  // Connect to first 2 peers (or however many we have)
  const numConnections = Math.min(2, peerKeys.length)

  for (let i = 0; i < numConnections; i++) {
    const peerKey = peerKeys[i]
    const connection = relayClient.connect(peerKey)
    connections.push(connection)

    // Wait for connection to be established
    await new Promise((resolve, reject) => {
      connection.on('connect', resolve)
      connection.on('error', reject)
      setTimeout(() => reject(new Error(`Connection ${i + 1} timeout`)), 3000)
    })
  }

  console.log(`Sending data to hit ${TOTAL_DATA_LIMIT} byte total limit...`)

  // Set up error handlers for total data limit
  const limitPromise = new Promise((resolve) => {
    connections.forEach((connection, index) => {
      connection.on('error', (err) => {
        if (err.message.includes('data limit exceeded')) {
          limitHit = true
          resolve()
        }
      })

      connection.on('close', resolve)
    })
  })

  // Send data strategically to hit total limit
  const sendData = async () => {
    try {
      // Send 900 bytes on connection 1 (under the 1000 per-connection limit)
      const chunk900 = Buffer.alloc(900, 'Y')
      connections[0].write(chunk900)
      totalSent += 900

      await new Promise(resolve => setTimeout(resolve, 20))

      // Send 900 bytes on connection 2 (under the 1000 per-connection limit)
      connections[1].write(chunk900)
      totalSent += 900

      await new Promise(resolve => setTimeout(resolve, 20))

      // Send 100 bytes on connection 1 to exceed total limit (1900 > 1800)
      // But connection 1 will only have 1000 bytes total (under per-connection limit)
      const chunk100 = Buffer.alloc(100, 'Y')
      connections[0].write(chunk100)
      totalSent += 100

      // Wait a bit for the error handler to fire
      await new Promise(resolve => setTimeout(resolve, 100))
    } catch (err) {
      // Ignore write errors
    }
  }

  // Race between sending data and hitting limit
  await Promise.race([sendData(), limitPromise])

  console.log(`Sent ${totalSent} bytes across ${numConnections} connections, limit hit: ${limitHit}`)

  // Test passes if we hit the total data limit
  if (limitHit) {
    process.exit(0)
  } else {
    process.exit(1)
  }
}

testTotalDataLimits().catch((err) => {
  console.error('Integration test ERROR:', err.message)
  process.exit(1)
})
