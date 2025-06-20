import fs from "fs";

if (typeof WebSocket === "undefined") {
  global.WebSocket = (await import("ws")).default;
}

import RelayClient from "../index.js";
import Stream from "../ws.js";

const PORT = process.argv[2] || 8094;
const RATE_LIMIT = parseInt(process.argv[3]) || 200; // bytes/sec

console.log(`Testing ${RATE_LIMIT} bytes/sec rate limit...`);

async function testRateLimits() {
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

  let totalSent = 0;
  let rateLimitHit = false;
  const startTime = Date.now();

  console.log(`Sending data to trigger rate limit...`);

  // Set up error handler for rate limit
  const limitPromise = new Promise((resolve) => {
    connection.on("error", (err) => {
      if (err.message.includes("rate limit exceeded")) {
        rateLimitHit = true;
        resolve();
      } else {
        resolve();
      }
    });
    
    connection.on("close", resolve);
  });

  // Send data quickly to trigger rate limit
  const sendData = async () => {
    try {
      // Send data faster than the rate limit
      // With 200 bytes/sec limit, sending 250 bytes quickly should trigger it
      const chunk = Buffer.alloc(100, 'Z');
      
      // Send 100 bytes 3 times quickly (300 bytes total > 200 bytes/sec)
      for (let i = 0; i < 3; i++) {
        connection.write(chunk);
        totalSent += 100;
        
        // Small delay but still faster than rate limit allows
        await new Promise(resolve => setTimeout(resolve, 50)); // 50ms between sends
      }
      
      // Wait a bit for the rate limit check to kick in
      await new Promise(resolve => setTimeout(resolve, 200));
      
    } catch (err) {
      // Ignore write errors
    }
  };

  // Race between sending data and hitting rate limit
  await Promise.race([sendData(), limitPromise]);

  const elapsed = Date.now() - startTime;
  
  console.log(`Sent ${totalSent} bytes in ${elapsed}ms, rate limit hit: ${rateLimitHit}`);

  // Test passes if we hit the rate limit
  if (rateLimitHit) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

testRateLimits().catch((err) => {
  console.error("Integration test ERROR:", err.message);
  process.exit(1);
}); 