import fs from "fs";

if (typeof WebSocket === "undefined") {
  global.WebSocket = (await import("ws")).default;
}

import RelayClient from "../index.js";
import Stream from "../ws.js";

const PORT = process.argv[2] || 8094;
const MAX_CONNECTIONS = parseInt(process.argv[3]) || 2;

console.log("Integration test: Connection limits with real DHT peers");
console.log(`Testing ${MAX_CONNECTIONS} max connections...`);

async function testConnectionLimits() {
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

  console.log(`\nStep 3: Testing connection limits...`);
  console.log(`Attempting ${peerKeys.length} connections (expect ${MAX_CONNECTIONS} to succeed)...`);

  let successful = 0;
  let resourceLimitDenied = 0;
  let otherErrors = 0;

  for (let i = 0; i < peerKeys.length; i++) {
    const peerKey = peerKeys[i];
    const peerNum = i + 1;

    try {
      const connection = relayClient.connect(peerKey);

      await new Promise((resolve) => {
        let resolved = false;
        
        const finish = (outcome) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeoutId);
          resolve(outcome);
        };

        connection.on("connect", () => {
          successful++;
          finish();
        });
        
        connection.on("error", (err) => {
          if (err.message.includes("limit exceeded")) {
            resourceLimitDenied++;
            finish();
          } else {
            otherErrors++;
            finish();
          }
        });
        
        const timeoutId = setTimeout(() => {
          otherErrors++;
          finish();
        }, 2000);
      });
    } catch (err) {
      otherErrors++;
    }
  }

  console.log(`\nResults:`);
  console.log(`Successful: ${successful}`);
  console.log(`Resource limit denied: ${resourceLimitDenied}`);
  console.log(`Other errors/timeouts: ${otherErrors}`);
  console.log(
    `Expected resource limit denials: ${peerKeys.length - MAX_CONNECTIONS}`
  );

  const expectedDenials = peerKeys.length - MAX_CONNECTIONS;
  console.log(`✓ ${successful} successful, ${resourceLimitDenied} denied (expected ${expectedDenials})`);
  
  // Test passes if we get the expected number of resource limit denials
  if (resourceLimitDenied == expectedDenials) {
    console.log("✓ Connection limit test PASSED");
    process.exit(0);
  } else {
    console.log("✗ Connection limit test FAILED");
    process.exit(1);
  }
}

testConnectionLimits().catch((err) => {
  console.error("Integration test ERROR:", err.message);
  process.exit(1);
});
