/**
 * Default resource limits for DHT Relay - Signaling Only
 *
 * These settings are optimized for WebRTC signaling through DHT.
 * Peers use the relay only for DHT announcements/lookups, then establish
 * direct WebRTC connections for actual data transfer.
 */
module.exports = {
  // Connection limits - for signaling, each peer typically needs only 1 connection
  maxConnections: 1,

  // Data limits (signaling messages are small)
  maxDataPerConnection: 10 * 1024, // 10KB per connection (generous for DHT messages)
  maxTotalDataPerClient: null, // Auto-calculated: maxConnections * maxDataPerConnection

  // Rate limiting (prevent spam)
  maxDataRatePerSecond: 5 * 1024, // 5KB/s (adequate for occasional DHT updates)

  // Message type restrictions
  allowedMessageTypes: [
    'lookup', // Find peers in DHT
    'announce', // Announce presence in DHT
    'connect' // Establish connections (for WebRTC signaling)
  ]
}
