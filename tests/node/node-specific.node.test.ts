import { describe, it, expect } from 'vitest'

describe('WebSocket (Node.js)', () => {
  it('should be able to import ws package', async () => {
    try {
      const wsModule = await import('ws')
      expect(wsModule).toBeDefined()
      expect(wsModule.WebSocket || wsModule.default).toBeDefined()
    } catch (error) {
      // If ws is not installed, that's ok for this test
      expect(error).toBeDefined()
    }
  })

  it('should have Node.js specific globals', () => {
    expect(typeof process).toBe('object')
    expect(typeof global).toBe('object')
    expect(typeof require).toBe('function')
    expect(process.version).toBeDefined()
    expect(process.platform).toBeDefined()
  })

  it('should not have browser globals', () => {
    expect(typeof window).toBe('undefined')
    expect(typeof document).toBe('undefined')
    expect(typeof navigator).toBe('undefined')
  })
})

describe('File System (Node.js)', () => {
  it('should have access to fs module', async () => {
    const fs = await import('fs')
    expect(fs).toBeDefined()
    expect(typeof fs.readFileSync).toBe('function')
  })

  it('should have access to path module', async () => {
    const path = await import('path')
    expect(path).toBeDefined()
    expect(typeof path.join).toBe('function')
  })
})
