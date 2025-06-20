const { argv } = require('./utils')

/**
 * Load resource limits - only apply limits that are explicitly set
 */
function loadLimitsConfig() {
  const useDefaults = argv('default-limits', Boolean)
  const limits = {}
  
  if (useDefaults) {
    // Load all default limits
    const defaults = require('../config/defaults.js')
    Object.assign(limits, defaults)
  }
  
  // Override with any explicitly set CLI args (these take precedence)
  const cliMaxConnections = argv('max-connections', Number)
  const cliMaxDataPerConnection = argv('max-data-per-connection', Number)
  const cliMaxTotalDataPerClient = argv('max-total-data-per-client', Number)
  const cliMaxDataRatePerSecond = argv('max-data-rate-per-second', Number)
  
  if (cliMaxConnections !== null) limits.maxConnections = cliMaxConnections
  if (cliMaxDataPerConnection !== null) limits.maxDataPerConnection = cliMaxDataPerConnection
  if (cliMaxTotalDataPerClient !== null) limits.maxTotalDataPerClient = cliMaxTotalDataPerClient
  if (cliMaxDataRatePerSecond !== null) limits.maxDataRatePerSecond = cliMaxDataRatePerSecond
  
  // Always include message types (not configurable via CLI)
  if (!limits.allowedMessageTypes) {
    const defaults = require('../config/defaults.js')
    limits.allowedMessageTypes = defaults.allowedMessageTypes
  }
  
  // Auto-calculate maxTotalDataPerClient if both connection and per-connection limits are set
  // but total limit is not explicitly set
  if (limits.maxConnections && limits.maxDataPerConnection && !limits.maxTotalDataPerClient) {
    limits.maxTotalDataPerClient = limits.maxConnections * limits.maxDataPerConnection
  }
  
  return limits
}

module.exports = {
  loadLimitsConfig
} 