import crypto from 'crypto'
import fs from 'fs'
import RelayClient from '../../index.js'
import Stream from '../../ws.js'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let WebSocket
if (typeof globalThis.WebSocket === 'undefined') {
  WebSocket = (await import('ws')).default
} else {
  WebSocket = globalThis.WebSocket
}

const PORT = process.argv[2] || 8094

console.log('Integration test: Identifier strategy bypass attempts')
console.log(
  'Testing address-based limiting (different public keys should not bypass)...'
)

async function newSocket (port) {
  const socket = new WebSocket(`ws://localhost:${port}`)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
    setTimeout(() => reject(new Error('WebSocket timeout')), 3000)
  })
  return socket
}

async function testIdentifierStrategy () {
  // Load real peer from setup
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

  const targetPeer = peerKeys[0] // Use first real peer

  // Connection 1: Use up the connection slot
  const client1 = new RelayClient(new Stream(true, await newSocket(PORT)), {
    keyPair: {
      publicKey: crypto.randomBytes(32),
      secretKey: crypto.randomBytes(64)
    }
  })
  await client1.ready()

  client1.connect(targetPeer)
  await sleep(100)

  // Connection 2: Try to bypass with different public key from same IP
  const client2 = new RelayClient(new Stream(true, await newSocket(PORT)), {
    keyPair: {
      publicKey: crypto.randomBytes(32),
      secretKey: crypto.randomBytes(64)
    }
  })
  await client2.ready()

  const connection2 = client2.connect(targetPeer)
  let bypassBlocked = false

  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 2000)

    connection2.on('error', (err) => {
      if (
        err.message.includes('Connection denied') ||
        err.message.includes('limit exceeded')
      ) {
        bypassBlocked = true
      }
      clearTimeout(timeout)
      resolve()
    })
  })

  console.log(`Bypass attempt blocked: ${bypassBlocked}`)

  if (bypassBlocked) {
    process.exit(0)
  } else {
    process.exit(1)
  }
}

testIdentifierStrategy().catch((err) => {
  console.error('Integration test ERROR:', err.message)
  process.exit(1)
})
