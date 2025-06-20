#!/bin/bash

# Integration test: Tests DHT relay resource limits with real peers
#
# Architecture:
#   1. Start DHT RELAY SERVER (bin.js) in background with resource limits
#   2. Start DHT PEERS in background as connection targets
#   3. Start TEST CLIENT (integration.mjs) that connects to the server  
#   4. Client tests connection limits against the pre-existing peers
#   5. Clean up all processes

PORT=8094
MAX_CONNECTIONS=2
RELAY_PID=""
PEER_PIDS=""

cleanup() {
    echo "Stopping all processes..."
    if [ ! -z "$RELAY_PID" ]; then
        kill $RELAY_PID 2>/dev/null || true
        wait $RELAY_PID 2>/dev/null || true
    fi
    if [ ! -z "$PEER_PIDS" ]; then
        for pid in $PEER_PIDS; do
            kill $pid 2>/dev/null || true
        done
    fi
    # Clean up temp file
    rm -f /tmp/dht-peers.json
}

trap cleanup EXIT

echo "Testing DHT relay resource limits"
echo "================================="

# Clean up any previous test files
rm -f /tmp/dht-peers.json

# Step 1: Start DHT RELAY SERVER with resource limits
echo "Starting DHT relay server on port $PORT with max $MAX_CONNECTIONS connections..."
node bin.js --port $PORT --max-connections $MAX_CONNECTIONS --max-data-per-connection 1000 --max-data-rate-per-second 500 &
RELAY_PID=$!

# Wait for server to be ready
sleep 2

# Step 2: Start DHT PEERS as connection targets
echo "Starting DHT peers as connection targets..."
node test/setup-peers.mjs &
PEER_SETUP_PID=$!
PEER_PIDS="$PEER_SETUP_PID"

# Wait for peers to be ready - check for the file
echo "Waiting for DHT peers to be ready..."
for i in {1..15}; do
  if [ -f "/tmp/dht-peers.json" ]; then
    echo "DHT peers ready!"
    break
  fi
  if [ $i -eq 15 ]; then
    echo "ERROR: DHT peers did not start in time"
    exit 1
  fi
  sleep 1
done

# Check if server and peers started successfully
if ! kill -0 $RELAY_PID 2>/dev/null; then
    echo "ERROR: DHT relay server failed to start"
    exit 1
fi

if ! kill -0 $PEER_SETUP_PID 2>/dev/null; then
    echo "ERROR: DHT peers failed to start"
    exit 1
fi

echo "DHT relay server running (PID: $RELAY_PID)"
echo "DHT peers running"

# Step 3: Run TEST CLIENT that will connect to the server and test limits
echo "Running integration test client..."
if node test/integration.mjs $PORT $MAX_CONNECTIONS; then
    echo "Integration tests PASSED"
else
    echo "Integration tests FAILED"
    exit 1
fi 