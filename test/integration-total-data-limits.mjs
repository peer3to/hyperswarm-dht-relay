import fs from "fs";

if (typeof WebSocket === "undefined") {
  global.WebSocket = (await import("ws")).default;
}

import RelayClient from "../index.js";
import Stream from "../ws.js";

const PORT = process.argv[2] || 8094;
const TOTAL_DATA_LIMIT = parseInt(process.argv[3]) || 2000; // bytes

console.log("Integration test: Total data limits per public key");
console.log(`Server: localhost:${PORT}`);
console.log(`Total data limit per client: ${TOTAL_DATA_LIMIT} bytes`);

async function testTotalDataLimits() {
  // Read peer keys that were set up by the shell script
  console.log("\nStep 1: Loading pre-existing DHT peers...");
  let peerKeys;
  try {
    const peerKeysHex = JSON.parse(
      fs.readFileSync("/tmp/dht-peers.json", "utf8")
    );
    peerKeys = peerKeysHex.map((hex) => Buffer.from(hex, "hex"));
    console.log(`Loaded ${peerKeys.length} peer public keys`);
  } catch (err) {
    throw new Error(
      "Could not load peer keys - make sure DHT peers are running"
    );
  }

  console.log("\nStep 2: Creating relay client...");
  const socket = new WebSocket(`ws://localhost:${PORT}`);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
    setTimeout(() => reject(new Error("WebSocket timeout")), 3000);
  });

  const relayClient = new RelayClient(new Stream(true, socket));
  await relayClient.ready();
  console.log("Relay client ready");

  console.log(`\nStep 3: Testing total data limit across multiple connections...`);
  console.log(`Will connect to multiple peers and send data until total limit hit`);

  const connections = [];
  let totalSent = 0;
  let limitHit = false;

  // Connect to first 2 peers (or however many we have)
  const numConnections = Math.min(2, peerKeys.length);
  console.log(`\nEstablishing ${numConnections} connections...`);
  
  for (let i = 0; i < numConnections; i++) {
    const peerKey = peerKeys[i];
    console.log(`Connecting to peer ${i + 1}...`);
    
    const connection = relayClient.connect(peerKey);
    connections.push(connection);
    
    // Wait for connection to be established
    await new Promise((resolve, reject) => {
      connection.on("connect", () => {
        console.log(`Connection ${i + 1} established`);
        resolve();
      });
      connection.on("error", reject);
      setTimeout(() => reject(new Error(`Connection ${i + 1} timeout`)), 3000);
    });
  }

  console.log(`All ${numConnections} connections established`);
  console.log(`Sending data strategically to hit ${TOTAL_DATA_LIMIT} byte total limit...`);

  // Set up error handlers for total data limit
  const limitPromise = new Promise((resolve) => {
    connections.forEach((connection, index) => {
      connection.on("error", (err) => {
        if (err.message.includes("data limit exceeded")) {
          console.log(`Total data limit hit on connection ${index + 1}: ${err.message}`);
          limitHit = true;
          resolve();
        } else {
          console.log(`Unexpected error on connection ${index + 1}: ${err.message}`);
        }
      });
      
      connection.on("close", () => {
        console.log(`Connection ${index + 1} closed`);
      });
    });
  });

  // Send data strategically to hit total limit
  const sendData = async () => {
    try {
      // Send 900 bytes on connection 1 (under the 1000 per-connection limit)
      const chunk900 = Buffer.alloc(900, 'Y');
      connections[0].write(chunk900);
      totalSent += 900;
      console.log(`Sent 900 bytes on connection 1 (total: ${totalSent} bytes)`);
      
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // Send 900 bytes on connection 2 (under the 1000 per-connection limit)
      connections[1].write(chunk900);
      totalSent += 900;
      console.log(`Sent 900 bytes on connection 2 (total: ${totalSent} bytes)`);
      
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // Send 100 bytes on connection 1 to exceed total limit (1900 > 1800)
      // But connection 1 will only have 1000 bytes total (under per-connection limit)
      const chunk100 = Buffer.alloc(100, 'Y');
      connections[0].write(chunk100);
      totalSent += 100;
      console.log(`Sent 100 bytes on connection 1 (total: ${totalSent} bytes) - should hit total limit`);
      
      // Wait a bit for the error handler to fire
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (err) {
      console.log(`Write error: ${err.message}`);
    }
  };

  // Race between sending data and hitting limit
  await Promise.race([sendData(), limitPromise]);

  console.log(`\nResults:`);
  console.log(`Total data sent: ${totalSent} bytes`);
  console.log(`Total data limit: ${TOTAL_DATA_LIMIT} bytes`);
  console.log(`Connections used: ${numConnections}`);
  console.log(`Limit exceeded: ${limitHit}`);

  // Test passes if we hit the total data limit
  if (limitHit) {
    console.log("✓ Total data limit test PASSED");
    console.log("Integration test PASSED");
    process.exit(0);
  } else {
    console.log("✗ Total data limit test FAILED");
    console.log("Expected to hit total data limit but didn't");
    console.log("Integration test FAILED");
    process.exit(1);
  }
}

testTotalDataLimits().catch((err) => {
  console.error("Integration test ERROR:", err.message);
  process.exit(1);
}); 