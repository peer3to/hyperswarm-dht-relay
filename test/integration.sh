#!/bin/bash

# Integration test: Tests DHT relay resource limits with real peers
#
# Architecture:
#   1. Start DHT RELAY SERVER (bin.js) in background with resource limits
#   2. Start DHT PEERS in background as connection targets
#   3. Run MULTIPLE TEST CLIENTS that test different limits
#   4. Clean up all processes

PORT=8094
MAX_CONNECTIONS=2
DATA_LIMIT=1000
TOTAL_DATA_LIMIT=1800
RELAY_PID=""
PEER_PIDS=""

# Track test results
declare -a test_results
declare -a test_names

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
echo "Starting DHT relay server on port $PORT with resource limits..."
echo "  - Max connections: $MAX_CONNECTIONS"
echo "  - Max data per connection: ${DATA_LIMIT} bytes"
echo "  - Max total data per client: ${TOTAL_DATA_LIMIT} bytes"
node bin.js --port $PORT --max-connections $MAX_CONNECTIONS --max-data-per-connection $DATA_LIMIT --max-total-data-per-client $TOTAL_DATA_LIMIT &
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
echo ""

# Step 3: Run ALL TEST CLIENTS against the same infrastructure
echo "Running integration tests..."
echo "============================="

# Test A: Connection limits
echo "Test A: Connection limits"
echo "-------------------------"
if node test/integration-connection-limits.mjs $PORT $MAX_CONNECTIONS; then
    test_results+=("PASSED")
    test_names+=("Connection limits")
else
    test_results+=("FAILED")
    test_names+=("Connection limits")
fi

echo ""

# Test B: Data per connection limits  
echo "Test B: Data per connection limits"
echo "----------------------------------"
if node test/integration-data-limits.mjs $PORT $DATA_LIMIT; then
    test_results+=("PASSED")
    test_names+=("Data per connection limits")
else
    test_results+=("FAILED")
    test_names+=("Data per connection limits")
fi

echo ""

# Test C: Total data limits per public key
echo "Test C: Total data limits per public key"
echo "----------------------------------------"
if node test/integration-total-data-limits.mjs $PORT $TOTAL_DATA_LIMIT; then
    test_results+=("PASSED")
    test_names+=("Total data limits per public key")
else
    test_results+=("FAILED")
    test_names+=("Total data limits per public key")
fi

echo ""

# Test D: Rate limits (requires separate server configuration)
echo "Test D: Rate limits"
echo "-------------------"
echo "Restarting server with rate limiting enabled..."

# Kill current server
if [ ! -z "$RELAY_PID" ]; then
    kill $RELAY_PID 2>/dev/null || true
    wait $RELAY_PID 2>/dev/null || true
fi

# Start new server with rate limiting
RATE_LIMIT=200  # 200 bytes/sec
echo "Starting server with ${RATE_LIMIT} bytes/sec rate limit..."
node bin.js --port $PORT --max-data-rate-per-second $RATE_LIMIT &
RELAY_PID=$!

# Wait for server to be ready
sleep 2

# Check if server started successfully
if ! kill -0 $RELAY_PID 2>/dev/null; then
    echo "ERROR: Rate-limited relay server failed to start"
    exit 1
fi

# Run rate limit test
if node test/integration-rate-limits.mjs $PORT $RATE_LIMIT; then
    test_results+=("PASSED")
    test_names+=("Rate limits")
else
    test_results+=("FAILED")
    test_names+=("Rate limits")
fi

echo ""

# Print test results summary
echo "========================================="
echo "Integration Test Results Summary"
echo "========================================="
failed_count=0
for i in "${!test_results[@]}"; do
    status="${test_results[$i]}"
    name="${test_names[$i]}"
    if [ "$status" = "PASSED" ]; then
        echo "✓ $name: PASSED"
    else
        echo "✗ $name: FAILED"
        ((failed_count++))
    fi
done

echo ""
if [ $failed_count -eq 0 ]; then
    echo "All integration tests PASSED! 🎉"
    exit 0
else
    echo "$failed_count test(s) FAILED"
    exit 1
fi 