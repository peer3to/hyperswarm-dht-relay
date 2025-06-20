import fs from "fs";

if (typeof WebSocket === "undefined") {
  global.WebSocket = (await import("ws")).default;
}

import RelayClient from "../index.js";
import Stream from "../ws.js";

const PORT = process.argv[2] || 8094;
const DATA_LIMIT = parseInt(process.argv[3]) || 1000; // bytes

console.log("Integration test: Data limits per connection");
console.log(`Server: localhost:${PORT}`);
console.log(`Data limit per connection: ${DATA_LIMIT} bytes`);

async function testDataLimits() {
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

  console.log(`\nStep 3: Testing data limit per connection...`);
  console.log(`Connecting to first peer and sending data until limit hit`);

  // Connect to first peer
  const peerKey = peerKeys[0];
  console.log("Establishing connection...");
  
  const connection = relayClient.connect(peerKey);
  
  // Wait for connection to be established
  await new Promise((resolve, reject) => {
    connection.on("connect", () => {
      console.log("Connection established");
      resolve();
    });
    connection.on("error", reject);
    setTimeout(() => reject(new Error("Connection timeout")), 3000);
  });

  console.log(`Sending data in chunks until ${DATA_LIMIT} byte limit is exceeded...`);
  
  let totalSent = 0;
  let limitHit = false;
  const chunkSize = 500; // Send 500 bytes at a time (larger chunks for quicker test)
  const chunk = Buffer.alloc(chunkSize, 'X');

  // Set up error handler for data limit
  const limitPromise = new Promise((resolve) => {
    connection.on("error", (err) => {
      if (err.message.includes("data limit exceeded")) {
        console.log(`Data limit hit: ${err.message}`);
        limitHit = true;
        resolve();
      } else {
        console.log(`Unexpected error: ${err.message}`);
        resolve();
      }
    });
    
    connection.on("close", () => {
      console.log("Connection closed");
      resolve();
    });
  });

  // Send data until limit is hit
  const sendData = async () => {
    while (!limitHit && totalSent < DATA_LIMIT + chunkSize) {
      try {
        connection.write(chunk);
        totalSent += chunkSize;
        console.log(`Sent ${totalSent} bytes...`);
        
        // Small delay to avoid overwhelming
        await new Promise(resolve => setTimeout(resolve, 10));
      } catch (err) {
        console.log(`Write error: ${err.message}`);
        break;
      }
    }
  };

  // Race between sending data and hitting limit
  await Promise.race([sendData(), limitPromise]);

  console.log(`\nResults:`);
  console.log(`Total data sent: ${totalSent} bytes`);
  console.log(`Data limit: ${DATA_LIMIT} bytes`);
  console.log(`Limit exceeded: ${limitHit}`);

  // Test passes if we hit the data limit
  if (limitHit) {
    console.log("✓ Data limit test PASSED");
    console.log("Integration test PASSED");
    process.exit(0);
  } else {
    console.log("✗ Data limit test FAILED");
    console.log("Expected to hit data limit but didn't");
    console.log("Integration test FAILED");
    process.exit(1);
  }
}

testDataLimits().catch((err) => {
  console.error("Integration test ERROR:", err.message);
  process.exit(1);
}); 