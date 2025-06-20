/**
 * Default resource limits for DHT Relay - Signaling Only
 *
 * These settings are optimized for WebRTC signaling through DHT.
 * Peers use the relay only for DHT announcements/lookups, then establish
 * direct WebRTC connections for actual data transfer.
 */
module.exports = {
  // Connection limits
  maxConnections: 10,

  // Data limits (signaling messages are small)
  maxDataPerConnection: 50 * 1024, // 50KB per connection
  maxTotalDataPerClient: null, // Auto-calculated: maxConnections * maxDataPerConnection

  // Rate limiting (prevent spam)
  maxDataRatePerSecond: 10 * 1024, // 10KB/s

  // Message type restrictions
  allowedMessageTypes: [
    "lookup", // Find peers in DHT
    "announce", // Announce presence in DHT
    "connect", // Establish connections
  ],
};
