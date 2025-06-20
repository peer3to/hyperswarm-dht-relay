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
const MAX_CONNECTIONS = parseInt(process.argv[3]) || 2

console.log('Integration test: Number of connections limit')
console.log(`Testing ${MAX_CONNECTIONS} max connections...`)

async function testConnectionLimits () {
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

  console.log(`Attempting ${peerKeys.length} connections (expect ${MAX_CONNECTIONS} to succeed)...`)

  let successful = 0
  let resourceLimitDenied = 0

  for (let i = 0; i < peerKeys.length; i++) {
    const peerKey = peerKeys[i]

    try {
      const connection = relayClient.connect(peerKey)

      await new Promise((resolve) => {
        let resolved = false

        const finish = (outcome) => {
          if (resolved) return
          resolved = true
          clearTimeout(timeoutId)
          resolve(outcome)
        }

        connection.on('connect', () => {
          successful++
          finish()
        })

        connection.on('error', (err) => {
          if (err.message.includes('limit exceeded')) {
            resourceLimitDenied++
            finish()
          } else {
            finish()
          }
        })

        const timeoutId = setTimeout(() => {
          finish()
        }, 2000)
      })
    } catch (err) {
      // Connection setup error
    }
  }

  const expectedDenials = peerKeys.length - MAX_CONNECTIONS
  console.log(`${successful} successful, ${resourceLimitDenied} denied (expected ${expectedDenials})`)

  if (resourceLimitDenied === expectedDenials) {
    process.exit(0)
  } else {
    process.exit(1)
  }
}

testConnectionLimits().catch((err) => {
  console.error('Integration test ERROR:', err.message)
  process.exit(1)
})
