const ERROR_MESSAGES = {
  CONNECTION_LIMIT_EXCEEDED: (current, max) => `Connection limit exceeded (${current}/${max})`,
  PER_CONNECTION_DATA_LIMIT: (current, max) => `Per-connection data limit exceeded (${current}/${max} bytes)`,
  TOTAL_CLIENT_DATA_LIMIT: (current, max) => `Total client data limit exceeded (${current}/${max} bytes)`,
  DATA_RATE_LIMIT: (current, max) => `Data rate limit exceeded (${current}/${max} bytes/sec)`,
  CONNECTION_NOT_FOUND: 'Connection not found',
  MESSAGE_TYPE_NOT_ALLOWED: (type) => `Message type '${type}' not allowed`
}

class ResourceManager {
  constructor (options = {}) {
    this.limits = {
      maxConnections: options.maxConnections,
      maxDataPerConnection: options.maxDataPerConnection,
      maxTotalDataPerClient: options.maxTotalDataPerClient,
      maxDataRatePerSecond: options.maxDataRatePerSecond,
      allowedMessageTypes: options.allowedMessageTypes
    }

    // Track resource usage per public key
    // Map<publicKeyHex: string, {
    //   connections: number,           // Current active connection count
    //   totalDataUsage: number,        // Total bytes across all connections
    //   activeConnections: Set<string> // Set of connection aliases
    // }>
    this.usage = new Map()

    // Track per-connection data usage
    // Map<connectionAlias: string, {
    //   publicKey: Buffer,             // Client's public key
    //   bytesIn: number,               // Incoming bytes (DHT->relay->client)
    //   bytesOut: number,              // Outgoing bytes (client->relay->DHT)
    //   totalBytes: number,            // Sum of bytesIn + bytesOut
    //   createdAt: number,             // Connection creation timestamp
    //   dataRate: Array<{              // Rate limiting data
    //     bytes: number,               // Bytes in this transfer
    //     timestamp: number            // When transfer occurred
    //   }>
    // }>
    this.connectionData = new Map()
  }

  /**
   * Initialize tracking for a new client
   */
  _ensureClient (publicKey) {
    const keyStr = publicKey.toString('hex')
    if (!this.usage.has(keyStr)) {
      this.usage.set(keyStr, {
        connections: 0,
        totalDataUsage: 0,
        activeConnections: new Set() 
      })
    }
    return this.usage.get(keyStr)
  }

  /**
   * Check if a new connection is allowed for this public key
   */
  checkConnection (publicKey) {
    const client = this._ensureClient(publicKey)

    // Skip check if no connection limit is set
    if (this.limits.maxConnections === undefined) {
      return { allowed: true }
    }

    if (client.connections >= this.limits.maxConnections) {
      return {
        allowed: false,
        reason: ERROR_MESSAGES.CONNECTION_LIMIT_EXCEEDED(client.connections, this.limits.maxConnections)
      }
    }

    return { allowed: true }
  }

  /**
   * Check if data transfer is allowed for this connection
   */
  checkDataTransfer (connectionAlias, additionalBytes) {
    const connData = this.connectionData.get(connectionAlias)
    if (!connData) {
      return {
        allowed: false,
        reason: ERROR_MESSAGES.CONNECTION_NOT_FOUND
      }
    }

    const client = this._ensureClient(connData.publicKey)

    // Check per-connection limit (skip if not set)
    if (this.limits.maxDataPerConnection !== undefined) {
      if (connData.totalBytes + additionalBytes > this.limits.maxDataPerConnection) {
        return {
          allowed: false,
          reason: ERROR_MESSAGES.PER_CONNECTION_DATA_LIMIT(connData.totalBytes + additionalBytes, this.limits.maxDataPerConnection)
        }
      }
    }

    // Check total client limit (skip if not set)
    if (this.limits.maxTotalDataPerClient !== undefined) {
      if (client.totalDataUsage + additionalBytes > this.limits.maxTotalDataPerClient) {
        return {
          allowed: false,
          reason: ERROR_MESSAGES.TOTAL_CLIENT_DATA_LIMIT(client.totalDataUsage + additionalBytes, this.limits.maxTotalDataPerClient)
        }
      }
    }

    // Check data rate limit (skip if not set)
    if (this.limits.maxDataRatePerSecond !== undefined && this.limits.maxDataRatePerSecond > 0) {
      const now = Date.now()
      const timeWindow = 1000 // 1 second window

      // Clean old rate data and calculate current rate
      let currentRateBytes = 0
      connData.dataRate = connData.dataRate.filter(entry => {
        const isValid = now - entry.timestamp < timeWindow
        if (isValid) currentRateBytes += entry.bytes
        return isValid
      })

      if (currentRateBytes + additionalBytes > this.limits.maxDataRatePerSecond) {
        return {
          allowed: false,
          reason: ERROR_MESSAGES.DATA_RATE_LIMIT(currentRateBytes + additionalBytes, this.limits.maxDataRatePerSecond)
        }
      }
    }

    return { allowed: true }
  }


  recordConnection (publicKey, connectionAlias = null) {
    const client = this._ensureClient(publicKey)
    client.connections++


    if (connectionAlias) {
      client.activeConnections.add(connectionAlias)
      this.connectionData.set(connectionAlias, {
        publicKey,
        bytesIn: 0,
        bytesOut: 0,
        totalBytes: 0,
        createdAt: Date.now(),
        dataRate: [] 
      })
    }

    return client.connections
  }


  recordDisconnection (publicKey, connectionAlias = null) {
    const client = this._ensureClient(publicKey)
    client.connections = Math.max(0, client.connections - 1)


    if (connectionAlias) {
      client.activeConnections.delete(connectionAlias)
      this.connectionData.delete(connectionAlias)
    }

    return client.connections
  }

  /**
   * Record data transfer for a connection
   *
   * Note: Currently tracks both incoming (DHT->relay->client) and outgoing (client->relay->DHT)
   * data for statistics, but only outgoing data is rate-limited.

   */
  recordDataTransfer (connectionAlias, bytesIn = 0, bytesOut = 0) {
    const connData = this.connectionData.get(connectionAlias)
    if (!connData) {
      return false
    }

    const totalBytes = bytesIn + bytesOut
    connData.bytesIn += bytesIn
    connData.bytesOut += bytesOut
    connData.totalBytes += totalBytes

    // Track for rate limiting (only outgoing data counts toward rate limits)
    if (bytesOut > 0) {
      connData.dataRate.push({
        bytes: bytesOut,
        timestamp: Date.now()
      })
    }


    const client = this._ensureClient(connData.publicKey)
    client.totalDataUsage += totalBytes

    return true
  }


  checkMessage (_publicKey, messageType, _messageData = null) {
    if (!this.limits.allowedMessageTypes.includes(messageType)) {
      return {
        allowed: false,
        reason: ERROR_MESSAGES.MESSAGE_TYPE_NOT_ALLOWED(messageType)
      }
    }

    return { allowed: true }
  }

  /**
   * Get current usage stats for a client
   */
  getUsage (publicKey) {
    return this._ensureClient(publicKey)
  }

  /**
   * Get connection data for a specific connection
   */
  getConnectionData (connectionAlias) {
    return this.connectionData.get(connectionAlias)
  }

  /**
   * Get usage stats for all clients
   */
  getAllUsage () {
    const stats = {}
    for (const [key, usage] of this.usage.entries()) {
      stats[key] = { ...usage, activeConnections: Array.from(usage.activeConnections) }
    }
    return stats
  }


  getAllConnectionData () {
    const stats = {}
    for (const [alias, data] of this.connectionData.entries()) {
      stats[alias] = { ...data, publicKey: data.publicKey.toString('hex') }
    }
    return stats
  }




  canSendData (connectionAlias, dataChunks) {
    const connData = this.connectionData.get(connectionAlias)
    if (!connData) {
      return {
        allowed: false,
        reason: ERROR_MESSAGES.CONNECTION_NOT_FOUND
      }
    }

    // Calculate total data being sent
    let totalBytes = 0
    for (const chunk of dataChunks) {
      totalBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk)
    }

    // Check data transfer limits
    return this.checkDataTransfer(connectionAlias, totalBytes)
  }

  /**
   * Record data that was successfully sent
   */
  recordDataSent (connectionAlias, dataChunks) {
    // Calculate total data being sent
    let totalBytes = 0
    for (const chunk of dataChunks) {
      totalBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk)
    }

    // Record the outgoing data transfer (0 incoming, totalBytes outgoing)
    return this.recordDataTransfer(connectionAlias, 0, totalBytes)
  }
}

module.exports = {
  ResourceManager
}
