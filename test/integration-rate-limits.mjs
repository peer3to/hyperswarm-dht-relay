import fs from "fs";

if (typeof WebSocket === "undefined") {
  global.WebSocket = (await import("ws")).default;
}

import RelayClient from "../index.js";
import Stream from "../ws.js";

const PORT = process.argv[2] || 8094;
const RATE_LIMIT = parseInt(process.argv[3]) || 200; // bytes/sec

console.log("Integration test: Rate limits");
console.log(`Server: localhost:${PORT}`);
console.log(`Rate limit: ${RATE_LIMIT} bytes/sec`);

async function testRateLimits() {
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

  console.log(`\nStep 3: Testing rate limits...`);
  console.log(`Sending data quickly to trigger ${RATE_LIMIT} bytes/sec limit`);

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

  let totalSent = 0;
  let rateLimitHit = false;
  const startTime = Date.now();

  // Set up error handler for rate limit
  const limitPromise = new Promise((resolve) => {
    connection.on("error", (err) => {
      if (err.message.includes("rate limit exceeded")) {
        const elapsed = Date.now() - startTime;
        console.log(`Rate limit hit after ${elapsed}ms: ${err.message}`);
        rateLimitHit = true;
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

  // Send data quickly to trigger rate limit
  const sendData = async () => {
    try {
      // Send data faster than the rate limit
      // With 200 bytes/sec limit, sending 250 bytes quickly should trigger it
      const chunk = Buffer.alloc(100, 'Z');
      
      console.log("Sending data quickly...");
      
      // Send 100 bytes 3 times quickly (300 bytes total > 200 bytes/sec)
      for (let i = 0; i < 3; i++) {
        connection.write(chunk);
        totalSent += 100;
        console.log(`Sent ${totalSent} bytes total`);
        
        // Small delay but still faster than rate limit allows
        await new Promise(resolve => setTimeout(resolve, 50)); // 50ms between sends
      }
      
      // Wait a bit for the rate limit check to kick in
      await new Promise(resolve => setTimeout(resolve, 200));
      
    } catch (err) {
      console.log(`Write error: ${err.message}`);
    }
  };

  // Race between sending data and hitting rate limit
  await Promise.race([sendData(), limitPromise]);

  const elapsed = Date.now() - startTime;
  
  console.log(`\nResults:`);
  console.log(`Total data sent: ${totalSent} bytes`);
  console.log(`Time elapsed: ${elapsed}ms`);
  console.log(`Rate limit: ${RATE_LIMIT} bytes/sec`);
  console.log(`Rate limit exceeded: ${rateLimitHit}`);

  // Test passes if we hit the rate limit
  if (rateLimitHit) {
    console.log("✓ Rate limit test PASSED");
    console.log("Integration test PASSED");
    process.exit(0);
  } else {
    console.log("✗ Rate limit test FAILED");
    console.log("Expected to hit rate limit but didn't");
    console.log("Integration test FAILED");
    process.exit(1);
  }
}

testRateLimits().catch((err) => {
  console.error("Integration test ERROR:", err.message);
  process.exit(1);
}); 