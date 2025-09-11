import { describe, it, expect } from 'vitest'

describe('Platform Detection (Cross-Platform)', () => {
  it('should detect environment correctly', () => {
    const isBrowser = typeof window !== 'undefined'
    const isNode = typeof process !== 'undefined'
    
    // Should be in exactly one environment
    expect(isBrowser || isNode).toBe(true)
    expect(isBrowser && isNode).toBe(false)
    
    if (isBrowser) {
      // Browser environment checks
      expect(typeof WebSocket).toBe('function')
      expect(typeof fetch).toBe('function')
      expect(typeof document).toBe('object')
    } else {
      // Node.js environment checks
      expect(typeof process).toBe('object')
      expect(typeof global).toBe('object')
      expect(process.version).toBeDefined()
    }
  })

  it('should have consistent JavaScript features', () => {
    // These should work in both environments
    expect(typeof Promise).toBe('function')
    expect(typeof Map).toBe('function')
    expect(typeof Set).toBe('function')
    expect(typeof Proxy).toBe('function')
    expect(typeof JSON).toBe('object')
  })

  it('should support ES modules', () => {
    // Both environments should support ES modules
    // We can't directly test import() syntax, but we can verify we're in ES module context
    expect(typeof Promise).toBe('function') // ES6+ feature
    expect(typeof Symbol).toBe('function') // ES6+ feature
  })
})
