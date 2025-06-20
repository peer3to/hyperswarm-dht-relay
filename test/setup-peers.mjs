#!/usr/bin/env node

import DHT from 'hyperdht'
import fs from 'fs'

const NUM_PEERS = 3

// Suppress connection reset errors during cleanup - infrastructure should be resilient
process.on('uncaughtException', (err) => {
  if (err.code === 'ECONNRESET' || err.message.includes('connection reset')) {
    // Infrastructure is OK with surprise connection termination
    return
  }
  console.error('Unexpected error:', err)
  process.exit(1)
})

console.log(`Setting up ${NUM_PEERS} DHT peers...`)

async function setupPeers() {
  try {
    const dht = new DHT()
    await dht.ready()
    console.log('DHT ready')
    
    const peers = []
    
    for (let i = 1; i <= NUM_PEERS; i++) {
      console.log(`Creating peer ${i}...`)
      const keyPair = DHT.keyPair()
      const server = dht.createServer()
      
      server.on('connection', (conn) => {
        console.log(`Peer ${i} got connection`)
      })
      
      // Add timeout to server.listen()
      await Promise.race([
        server.listen(keyPair),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Peer ${i} listen timeout`)), 5000)
        )
      ])
      
      peers.push(keyPair.publicKey.toString('hex'))
      console.log(`Peer ${i} listening (${peers.length}/${NUM_PEERS})`)
    }
    
    console.log(`All ${NUM_PEERS} peers created, writing to file...`)
    
    // Write peer keys to file for test to read
    fs.writeFileSync('/tmp/dht-peers.json', JSON.stringify(peers))
    console.log(`SUCCESS: DHT peers ready - ${peers.length} keys written to file`)
    
    // Keep process alive
    setInterval(() => {}, 1000)
    
  } catch (err) {
    console.error('Peer setup error:', err.message)
    console.error(err.stack)
    process.exit(1)
  }
}

setupPeers() 