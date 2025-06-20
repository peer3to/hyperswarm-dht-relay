/**
 * Parse command line arguments
 */
function argv(name, type, defaultValue = null) {
  const i = process.argv.indexOf('--' + name)
  if (type === Boolean) return i > -1
  if (i === -1) return defaultValue

  const hasValue = i < process.argv.length - 1
  if (!hasValue) return defaultValue

  let value = process.argv[i + 1]

  if (type === Number) {
    value = parseInt(value, 10)
    if (Number.isNaN(value)) throw new Error('Invalid CLI value for argument --' + name)
    return value
  }

  if (type === String) return value

  throw new Error('Invalid CLI type for argument --' + name)
}

module.exports = {
  argv
} 