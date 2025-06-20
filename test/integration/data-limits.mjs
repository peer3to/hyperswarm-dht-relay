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
const DATA_LIMIT = parseInt(process.argv[3]) || 1000 // bytes

console.log('Integration test: Data limits per connection')
console.log(`Testing ${DATA_LIMIT} byte per-connection limit...`)

async function testDataLimits () {
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

  const connection = relayClient.connect(peerKeys[0])

  await new Promise((resolve, reject) => {
    connection.on('connect', resolve)
    connection.on('error', reject)
    setTimeout(() => reject(new Error('Connection timeout')), 3000)
  })

  console.log('Sending data until limit hit...')

  let totalSent = 0
  let limitHit = false
  const chunkSize = 500
  const chunk = Buffer.alloc(chunkSize, 'X')

  const limitPromise = new Promise((resolve) => {
    connection.on('error', (err) => {
      if (err.message.includes('data limit exceeded')) {
        limitHit = true
        resolve()
      } else {
        resolve()
      }
    })

    connection.on('close', resolve)
  })

  const sendData = async () => {
    const maxToSend = DATA_LIMIT + chunkSize
    while (totalSent < maxToSend) {
      if (limitHit) break

      try {
        connection.write(chunk)
        totalSent += chunkSize

        await new Promise(resolve => setTimeout(resolve, 10))
      } catch (err) {
        break
      }
    }
  }

  await Promise.race([sendData(), limitPromise])

  console.log(`Sent ${totalSent} bytes, limit hit: ${limitHit}`)

  if (limitHit) {
    process.exit(0)
  } else {
    process.exit(1)
  }
}

testDataLimits().catch((err) => {
  console.error('Integration test ERROR:', err.message)
  process.exit(1)
})
