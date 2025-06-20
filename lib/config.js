const { argv } = require('./utils')

/**
 * Load resource limits - merge defaults with CLI args
 */
function loadLimitsConfig() {
  // Load default limits
  const defaults = require('../config/defaults.js')
  
  // Override with CLI args
  const limits = {
    maxConnections: argv('max-connections', Number) || defaults.maxConnections,
    maxDataPerConnection: argv('max-data-per-connection', Number) || defaults.maxDataPerConnection,
    maxTotalDataPerClient: argv('max-total-data-per-client', Number) || defaults.maxTotalDataPerClient,
    maxDataRatePerSecond: argv('max-data-rate-per-second', Number) || defaults.maxDataRatePerSecond,
    allowedMessageTypes: defaults.allowedMessageTypes // Not configurable via CLI
  }
  
  // Auto-calculate maxTotalDataPerClient if not set
  if (limits.maxTotalDataPerClient === null) {
    limits.maxTotalDataPerClient = limits.maxConnections * limits.maxDataPerConnection
  }
  
  return limits
}

module.exports = {
  loadLimitsConfig
} 