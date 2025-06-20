import fs from "fs";

if (typeof WebSocket === "undefined") {
  global.WebSocket = (await import("ws")).default;
}

import RelayClient from "../../index.js";
import Stream from "../../ws.js";

const PORT = process.argv[2] || 8094;
const DATA_LIMIT = parseInt(process.argv[3]) || 1000; // bytes

console.log("Integration test: Data limits per connection");
console.log(`Testing ${DATA_LIMIT} byte per-connection limit...`);

async function testDataLimits() {
  // Read peer keys that were set up by the shell script
  let peerKeys;
  try {
    const peerKeysHex = JSON.parse(
      fs.readFileSync("/tmp/dht-peers.json", "utf8")
    );
    peerKeys = peerKeysHex.map((hex) => Buffer.from(hex, "hex"));
  } catch (err) {
    throw new Error(
      "Could not load peer keys - make sure DHT peers are running"
    );
  }

  const socket = new WebSocket(`ws://localhost:${PORT}`);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
    setTimeout(() => reject(new Error("WebSocket timeout")), 3000);
  });

  const relayClient = new RelayClient(new Stream(true, socket));
  await relayClient.ready();

  // Connect to first peer
  const connection = relayClient.connect(peerKeys[0]);
  
  // Wait for connection to be established
  await new Promise((resolve, reject) => {
    connection.on("connect", resolve);
    connection.on("error", reject);
    setTimeout(() => reject(new Error("Connection timeout")), 3000);
  });

  console.log(`Sending data until limit hit...`);
  
  let totalSent = 0;
  let limitHit = false;
  const chunkSize = 500; // Send 500 bytes at a time (larger chunks for quicker test)
  const chunk = Buffer.alloc(chunkSize, 'X');

  // Set up error handler for data limit
  const limitPromise = new Promise((resolve) => {
    connection.on("error", (err) => {
      if (err.message.includes("data limit exceeded")) {
        limitHit = true;
        resolve();
      } else {
        resolve();
      }
    });
    
    connection.on("close", resolve);
  });

  // Send data until limit is hit
  const sendData = async () => {
    while (!limitHit && totalSent < DATA_LIMIT + chunkSize) {
      try {
        connection.write(chunk);
        totalSent += chunkSize;
        
        // Small delay to avoid overwhelming
        await new Promise(resolve => setTimeout(resolve, 10));
      } catch (err) {
        break;
      }
    }
  };

  // Race between sending data and hitting limit
  await Promise.race([sendData(), limitPromise]);

  console.log(`Sent ${totalSent} bytes, limit hit: ${limitHit}`);

  // Test passes if we hit the data limit
  if (limitHit) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

testDataLimits().catch((err) => {
  console.error("Integration test ERROR:", err.message);
  process.exit(1);
}); 