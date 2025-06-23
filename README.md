# Hyperswarm Relay

> :test_tube: This project is still experimental. **Do not use it in production**.

Relaying the Hyperswarm DHT over framed streams to bring decentralized networking to everyone.

## Installation

```sh
npm install @hyperswarm/dht-relay
```

## Usage

On the relaying side:

```js
import DHT from 'hyperdht'
import { relay } from '@hyperswarm/dht-relay'

relay(new DHT(), stream)
```

On the relayed side:

```js
import DHT from '@hyperswarm/dht-relay'

const dht = new DHT(stream)
```

From here, the API matches that of the Hyperswarm DHT: <https://github.com/holepunchto/hyperdht#api>

### Resource Protection

The relay supports configurable resource protection to prevent abuse and ensure fair usage:

```js
import DHT from 'hyperdht'
import { relay } from '@hyperswarm/dht-relay'

const resourceManagerOptions = {
  maxConnections: 5,               // Max connections per client identifier
  maxDataPerConnection: 25 * 1024, // Max outgoing data per connection (25KB)
  maxTotalDataPerClient: null,     // Auto-calculated: maxConnections * maxDataPerConnection
  maxDataRatePerSecond: 5 * 1024,  // Max outgoing data rate per second (5KB/s)
  allowedMessageTypes: ['lookup', 'announce'] // Allowed message types
}

relay(new DHT(), stream, { resourceManagerOptions })
```

**Available limits:**
- `maxConnections` - Maximum number of simultaneous connections per client identifier (default: no limit)
- `maxDataPerConnection` - Maximum outgoing data transfer per individual connection in bytes (default: no limit)
- `maxTotalDataPerClient` - Maximum total outgoing data across all connections per client identifier (default: no limit)
- `maxDataRatePerSecond` - Maximum outgoing data transfer rate per second in bytes (default: no limit)
- `allowedMessageTypes` - Array of allowed message types (default: no limit)

**Note:** The resource manager has no built-in defaults - all limits are unlimited unless explicitly configured. The CLI provides a set of default limits when using `--default-limits` (see CLI section below). Client identification can be configured via the `--identifier-strategy` option (default: by public key).

### Transports

As a convenience, we provide stream wrappers for common transport protocols. These may or may not be appropriate for your particular use case and so your mileage may vary.

<details>
<summary>TCP</summary>

The TCP wrapper is a re-export of <https://github.com/holepunchto/hyperswarm-secret-stream> which adds both framing and encryption.

On the relaying side:

```js
import net from 'net'

import DHT from 'hyperdht'
import { relay } from '@hyperswarm/dht-relay'
import Stream from '@hyperswarm/dht-relay/tcp'

const dht = new DHT()
const server = net.createServer().listen(8080)

server.on('connection', (socket) => {
  relay(dht, new Stream(false, socket))
})
```

On the relayed side:

```js
import net from 'net'

import DHT from '@hyperswarm/dht-relay'
import Stream from '@hyperswarm/dht-relay/tcp'

const socket = net.connect(8080)
const dht = new DHT(new Stream(true, socket))
```
</details>

<details>
<summary>WebSocket</summary>

The WebSocket wrapper is a simple `Duplex` stream that only adapts the interface of the WebSocket as the WebSocket API already provides its own framing and encryption.

On the relaying side:

```js
import { WebSocketServer } from 'ws'

import DHT from 'hyperdht'
import { relay } from '@hyperswarm/dht-relay'
import Stream from '@hyperswarm/dht-relay/ws'

const dht = new DHT()
const server = new WebSocketServer({ port: 8080 })

server.on('connection', (socket) => {
  relay(dht, new Stream(false, socket))
})
```

On the relayed side:

```js
import DHT from '@hyperswarm/dht-relay'
import Stream from '@hyperswarm/dht-relay/ws'

const socket = new WebSocket('ws://localhost:8080')
const dht = new DHT(new Stream(true, socket))
```
</details>

### CLI

You can start a DHT relay in the command line:

```sh
npm install -g @hyperswarm/dht-relay
```

Run a DHT relay server:
```sh
dht-relay [options]
```

**Available options:**
- `--port` - Port to listen on (default: 49443)
- `--host` - Host to bind to (default: 0.0.0.0)
- `--cert` - Path to SSL certificate file (for HTTPS/WSS)
- `--key` - Path to SSL private key file (for HTTPS/WSS)
- `--behind-proxy` - Set if running behind a proxy like NGINX (fixes logging)
- `--identifier-strategy` - Client identification strategy: `publicKey` (default), `ip`, or `address`

**Resource limit options:**
- `--default-limits` - Apply default resource limits (see below)
- `--max-connections` - Maximum connections per client identifier
- `--max-data-per-connection` - Maximum outgoing data per connection in bytes
- `--max-total-data-per-client` - Maximum total outgoing data per client identifier
- `--max-data-rate-per-second` - Maximum outgoing data rate per second in bytes
- `--allowed-message-types` - Comma-separated list of allowed message types

**Default limits (applied with `--default-limits`):**
- `maxConnections: 10` - Allow up to 10 connections per client identifier
- `maxDataPerConnection: 50KB` - 50KB data limit per connection
- `maxDataRatePerSecond: 10KB/s` - 10KB/s rate limit
- `allowedMessageTypes: ['lookup', 'announce', 'connect']` - Only allow DHT signaling messages

**Client identification strategies:**
- `publicKey` (default) - Identify clients by their public key (e.g., "a1b2c3...")
- `ip` - Identify clients by their IP address and port (e.g., "192.168.1.100:54321")
- `address` - Identify clients by on chain address

**Examples:**

Basic server with no limits:
```sh
dht-relay --port 8080
```

Server with default signaling limits:
```sh  
dht-relay --port 8080 --default-limits
```

Server identifying clients by IP address instead of public key:
```sh
dht-relay --port 8080 --identifier-strategy ip --max-connections 5
```

Server with custom limits:
```sh
dht-relay --port 8080 \
  --max-connections 5 \
  --max-data-per-connection 25600 \
  --max-data-rate-per-second 5120 \
  --allowed-message-types lookup,announce
```

If running behind a proxy like NGINX then add `--behind-proxy` so logging info is correct.

## Testing

Run the test suite:

```sh
npm test                    # Unit tests
npm run test:integration    # Integration tests for resource protection
npm run test:all           # All tests
```

The integration tests validate resource limits, rate limiting, and message type filtering.

## Protocol

A reference implementation of the relay protocol can be found in the [`lib/protocol.js`](lib/protocol.js) module. The protocol is versioned and built on top of <https://github.com/mafintosh/protomux>.

### Messages

All types are specified as their corresponding [compact-encoding](https://github.com/compact-encoding) codec.

#### `handshake` (`0`)

1.  `uint8` Flags
    - `custodial`: `1`
2.  `fixed(32)` The public key of the peer
3.  (if `custodial` is set) `fixed(64)` The secret key

#### `ping` (`1`)

_Empty_

#### `pong` (`2`)

_Empty_

#### `connect` (`3`)

1.  `uint8` Flags
    - `custodial`: `1`
2.  `uint32` The alias of the stream
3.  `fixed(32)` The public key of the peer
4.  (if `custodial` is set) `fixed(64)` The secret key
5.  `fixed(32)` The public key of the remote peer

#### `connection` (`4`)

1.  `uint8` Flags
    - `custodial`: `1`
2.  `uint32` The alias of the stream
3.  `uint32` The alias of the server
4.  `fixed(32)` The public key of the remote peer
5.  (if `custodial` is set) `fixed(64)` The Noise handshake hash
6.  (if `custodial` is not set) `uint32` The ID of the Noise handshake session

#### `connected` (`5`)

1.  `uint32` The alias of the stream
2.  `uint32` The remote alias of the stream

#### `incoming` (`6`)

1.  `uint32` The ID of the request
2.  `uint32` The alias of the server
3.  `fixed(32)` The public key of the remote peer
4.  `buffer` The Noise handshake payload

#### `deny` (`7`)

1.  `uint32` The ID of the request

#### `accept` (`8`)

1.  `uint32` The ID of the request

#### `destroy` (`9`)

1.  `uint8` Flags
    - `paired`: `1`
    - `error`: `2`
2.  (if `paired` is set) `uint32` The alias of the stream
2.  (if `paired` is not set) `uint32` The remote alias of the stream
3.  (if `error` is set) `string` The reason the stream was destroyed

#### `listen` (`10`)

1.  `uint8` Flags
    - `custodial`: `1`
2.  `uint32` The alias of the server
3.  `fixed(32)` The public key of the server
4.  (if `custodial` is set) `fixed(64)` The secret key

#### `listening` (`11`)

1.  `uint32` The alias of the server
2.  `uint32` The remote alias of the server
3.  [`ipv4Address`][ipv4address] The address of the server

#### `close` (`12`)

1.  `uint32` The alias of the server

#### `closed` (`13`)

1.  `uint32` The alias of the server

#### `open` (`14`)

1.  `uint8` Flags
    - `custodial`: `1`
2.  `uint32` The alias of the stream
3.  `uint32` The alias of the server
4.  (if `custodial` is set) `fixed(64)` The Noise handshake hash
5.  (if `custodial` is not set) `uint32` The ID of the Noise handshake session

#### `end` (`15`)

1.  `uint32` The alias of the stream

#### `data` (`16`)

1.  `uint32` The alias of the stream
2.  `array(buffer)` The data sent

#### `result` (`17`)

1.  `uint32` The query ID
2.  `buffer` The query specific data

#### `finished` (`18`)

1.  `uint32` The query ID

#### `lookup` (`19`)

1.  `uint32` The query ID
2.  `fixed(32)` The topic to look up

#### `announce` (`20`)

1.  `uint8` Flags
    - `custodial`: `1`
2.  `uint32` The query ID
3.  `fixed(32)` The topic to announce
4.  `fixed(32)` The public key to announce on
5.  (if `custodial` is set) `fixed(64)` The secret key

#### `unannounce` (`21`)

1.  `uint8` Flags
    - `custodial`: `1`
2.  `uint32` The query ID
3.  `fixed(32)` The topic to unannounce
4.  `fixed(32)` The public key that was announced on
5.  (if `custodial` is set) `fixed(64)` The secret key

#### `signAnnounce` (`22`)

1.  `uint32` The ID of the request
2.  `uint32` The alias of the signee
3.  `fixed(32)` The roundtrip token of the peer
4.  `buffer` The ID of the peer
5.  `array(`[`ipv4Address`][ipv4address]`)` The addresses that may relay messages

#### `signUnannounce` (`23`)

1.  `uint32` The ID of the request
2.  `uint32` The alias of the signee
3.  `fixed(32)` The roundtrip token of the peer
4.  `buffer` The ID of the peer
5.  `array(`[`ipv4Address`][ipv4address]`)` The addresses that may relay messages

#### `signature` (`24`)

1.  `uint32` The ID of the request
2.  `buffer` The signature

#### `noiseSend` (`25`)

1.  `uint8` Flags
    - `isInitiator`: `1`
2.  `uint32` The ID of the handshake session
3.  (if `isInitiator` is set) The alias of the remote stream
4.  `buffer` The Noise handshake payload

#### `noiseReceive` (`26`)

1.  `uint8` Flags
    - `isInitiator`: `1`
2.  `uint32` The ID of the handshake session
3.  (if `isInitiator` is not set) The alias of the server
4.  `buffer` The Noise handshake payload

#### `noiseReply` (`27`)

1.  `uint8` Flags
    - `isInitiator`: `1`
    - `complete`: `2`
2.  `uint32` The ID of the handshake session
3.  `buffer` The Noise handshake payload
4.  (if `isInitiator` and `complete` are not set) `fixed(32)` The public key of the remote peer
5.  (if `complete` is set) `fixed(32)` The ID of the remote stream
6.  (if `complete` is set) `fixed(32)` The holepunch secret

## License

ISC

[ipv4address]: https://github.com/compact-encoding/compact-encoding-net#ipv4address
