// No-op implementation of ResourceManager for testing
// Implements the same interface but allows all operations without restrictions
class NoOpResourceManager {
  checkConnection () {
    return { allowed: true }
  }

  checkDataTransfer () {
    return { allowed: true }
  }

  recordConnection () {
    return 1 // Simulate successful recording
  }

  recordDisconnection () {
    return 0 // Simulate successful cleanup
  }

  recordDataTransfer () {
    return true
  }

  canSendData () {
    return { allowed: true }
  }

  recordDataSent () {
    return true
  }

  checkMessage () {
    return { allowed: true }
  }

  getUsage () {
    return {
      connections: 0,
      totalDataUsage: 0,
      activeConnections: new Set()
    }
  }

  getConnectionData () {
    return undefined
  }
}

export function testResourceManager () {
  return new NoOpResourceManager()
}
