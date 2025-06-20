import test from 'brittle'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

// Mock process.argv for testing CLI argument parsing
const originalArgv = process.argv

function mockArgv (args) {
  process.argv = ['node', 'bin.js', ...args]
}

function restoreArgv () {
  process.argv = originalArgv
}

// Helper to clear module cache and reimport
async function freshImport (modulePath) {
  const fullPath = require.resolve(modulePath)
  delete require.cache[fullPath]
  return import(modulePath + '?t=' + Date.now())
}

test('Config - default limits loading', async (t) => {
  mockArgv([])

  // Fresh import to avoid cached modules
  const { loadLimitsConfig } = await freshImport('../lib/config.js')
  const defaults = require('../config/defaults.js')

  const config = loadLimitsConfig()

  t.is(config.maxConnections, defaults.maxConnections, 'default max connections loaded')
  t.is(config.maxDataPerConnection, defaults.maxDataPerConnection, 'default max data per connection loaded')

  // The default has null, but config auto-calculates it
  const expectedTotal = defaults.maxTotalDataPerClient || defaults.maxConnections * defaults.maxDataPerConnection
  t.is(config.maxTotalDataPerClient, expectedTotal, 'default max total data per client loaded or auto-calculated')

  t.is(config.maxDataRatePerSecond, defaults.maxDataRatePerSecond, 'default max data rate loaded')
  t.alike(config.allowedMessageTypes, defaults.allowedMessageTypes, 'default allowed message types loaded')

  restoreArgv()
})

test('Config - CLI argument overrides', async (t) => {
  mockArgv([
    '--max-connections', '5',
    '--max-data-per-connection', '2048000', // 2MB
    '--max-total-data-per-client', '10240000', // 10MB
    '--max-data-rate-per-second', '204800' // 200KB/s
  ])

  const { loadLimitsConfig } = await freshImport('../lib/config.js')

  const config = loadLimitsConfig()

  t.is(config.maxConnections, 5, 'CLI max connections override works')
  t.is(config.maxDataPerConnection, 2048000, 'CLI max data per connection override works')
  t.is(config.maxTotalDataPerClient, 10240000, 'CLI max total data per client override works')
  t.is(config.maxDataRatePerSecond, 204800, 'CLI max data rate override works')

  restoreArgv()
})

test('Config - partial CLI overrides', async (t) => {
  mockArgv([
    '--max-connections', '3',
    '--max-data-per-connection', '512000' // Only override some values
  ])

  const { loadLimitsConfig } = await freshImport('../lib/config.js')
  const defaults = require('../config/defaults.js')

  const config = loadLimitsConfig()

  // Overridden values
  t.is(config.maxConnections, 3, 'partially overridden max connections works')
  t.is(config.maxDataPerConnection, 512000, 'partially overridden max data per connection works')

  // Default values for non-overridden
  // maxTotalDataPerClient should be auto-calculated since defaults has null
  // 3 connections * 512000 bytes = 1536000 bytes
  t.is(config.maxTotalDataPerClient, 3 * 512000, 'maxTotalDataPerClient auto-calculated with new values')
  t.is(config.maxDataRatePerSecond, defaults.maxDataRatePerSecond, 'non-overridden values remain default')

  restoreArgv()
})

test('Config - auto-calculated maxTotalDataPerClient', async (t) => {
  // Reset modules
  delete require.cache[require.resolve('../lib/config.js')]
  delete require.cache[require.resolve('../config/defaults.js')]

  // Mock defaults with null maxTotalDataPerClient
  const defaultsPath = require.resolve('../config/defaults.js')
  const originalDefaults = require(defaultsPath)

  // Create mock defaults
  require.cache[defaultsPath].exports = {
    ...originalDefaults,
    maxTotalDataPerClient: null // This should trigger auto-calculation
  }

  mockArgv([
    '--max-connections', '4',
    '--max-data-per-connection', '1000000' // 1MB
  ])

  const { loadLimitsConfig } = await freshImport('../lib/config.js')

  const config = loadLimitsConfig()

  // Should auto-calculate: 4 connections * 1MB = 4MB
  t.is(config.maxTotalDataPerClient, 4000000, 'maxTotalDataPerClient auto-calculated correctly')

  // Restore original defaults
  require.cache[defaultsPath].exports = originalDefaults
  restoreArgv()
})

test('Config - message types not configurable via CLI', async (t) => {
  mockArgv([
    '--max-connections', '2'
    // No way to override allowedMessageTypes via CLI
  ])

  const { loadLimitsConfig } = await freshImport('../lib/config.js')
  const defaults = require('../config/defaults.js')

  const config = loadLimitsConfig()

  // Should always use defaults for message types
  t.alike(config.allowedMessageTypes, defaults.allowedMessageTypes, 'message types always use defaults')

  restoreArgv()
})
