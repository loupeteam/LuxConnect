import { describe, it, expect } from 'vitest'

describe('WebSocket (Browser)', () => {
  it('should have native WebSocket API', () => {
    expect(typeof WebSocket).toBe('function')
    expect(WebSocket.prototype.send).toBeDefined()
    expect(WebSocket.prototype.close).toBeDefined()
    expect(WebSocket.CONNECTING).toBe(0)
    expect(WebSocket.OPEN).toBe(1)
    expect(WebSocket.CLOSING).toBe(2)
    expect(WebSocket.CLOSED).toBe(3)
  })

  it('should have browser specific globals', () => {
    expect(typeof window).toBe('object')
    expect(typeof document).toBe('object')
    expect(typeof navigator).toBe('object')
    expect(typeof location).toBe('object')
  })

  it('should not have Node.js specific globals', () => {
    expect(typeof process).toBe('undefined')
    expect(typeof global).toBe('undefined')
    expect(typeof require).toBe('undefined')
  })
})

describe('DOM API (Browser)', () => {
  it('should have basic DOM methods', () => {
    expect(typeof document.createElement).toBe('function')
    expect(typeof document.getElementById).toBe('function')
    expect(typeof document.querySelector).toBe('function')
  })

  it('should be able to create elements', () => {
    const div = document.createElement('div')
    expect(div).toBeDefined()
    expect(div.tagName).toBe('DIV')
  })
})

describe('Fetch API (Browser)', () => {
  it('should have native fetch API', () => {
    expect(typeof fetch).toBe('function')
    expect(typeof Request).toBe('function')
    expect(typeof Response).toBe('function')
    expect(typeof Headers).toBe('function')
  })
})
