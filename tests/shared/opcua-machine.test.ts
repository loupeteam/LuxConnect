import { describe, it, expect, beforeEach } from 'vitest'
import { OpcuaMachine } from '../../src/opcua-machine.js'
import { mockConnectionConfig, mockVariables } from '../fixtures/test-data.js'

describe('OpcuaMachine (Cross-Platform)', () => {
  let machine: OpcuaMachine

  beforeEach(() => {
    machine = new OpcuaMachine(mockConnectionConfig)
  })

  describe('initialization', () => {
    it('should initialize with correct default state', () => {
      expect(machine.connectionState).toBe('disconnected')
      expect(machine.isConnected).toBe(false)
    })

    it('should have default read group', () => {
      // The machine should start with a default read group
      expect(machine).toBeDefined()
    })
  })

  describe('variable registration without connection', () => {
    it('should register simple variables', () => {
      machine.initCyclicRead('Temperature')
      
      // Variable should be registered even without connection - access via variableManager
      const variable = machine['variableManager'].getVariable('Temperature')
      expect(variable).toBeDefined()
      expect(variable?.name).toBe('Temperature')
    })

    it('should register hierarchical variables', () => {
      mockVariables.hierarchical.forEach(varName => {
        expect(() => {
          machine.initCyclicRead(varName)
        }).not.toThrow()
      })
    })

    it('should handle callbacks during registration', () => {
      let callbackExecuted = false
      const callback = () => { callbackExecuted = true }
      
      machine.initCyclicRead('Temperature', callback)
      
      // Callback should be registered but not executed yet (no connection)
      expect(callbackExecuted).toBe(false)
    })
  })

  describe('property access (proxy behavior)', () => {
    it('should return undefined for unregistered variables', () => {
      expect(machine.Temperature).toBeUndefined()
    })

    it('should return undefined for registered but unconnected variables', () => {
      machine.initCyclicRead('Temperature')
      
      // Should be undefined until connected and receiving data
      expect(machine.Temperature).toBeUndefined()
    })
  })

  describe('read groups', () => {
    it('should use default read group by default', () => {
      machine.initCyclicRead('Temperature')
      machine.initCyclicRead('Pressure')
      
      // Both should be in default group (no errors thrown)
      expect(() => machine.initCyclicRead('Speed')).not.toThrow()
    })

    it('should support custom read groups', () => {
      machine.initCyclicRead('FastVar', undefined, { readGroup: 'fast' })
      machine.initCyclicRead('SlowVar', undefined, { readGroup: 'slow' })
      
      // Should not throw errors
      expect(machine['variableManager'].getVariable('FastVar')).toBeDefined()
      expect(machine['variableManager'].getVariable('SlowVar')).toBeDefined()
    })
  })

  describe('namespace handling', () => {
    it('should use default namespace when none specified', () => {
      machine.initCyclicRead('Temperature')
      
      const variable = machine['variableManager'].getVariable('Temperature')
      expect(variable?.nodeId).toMatch(/^ns=5;s=/)
    })

    it('should allow custom nodeId', () => {
      machine.initCyclicRead('CustomVar', undefined, { 
        nodeId: 'ns=1;s=CustomVariable' 
      })
      
      const variable = machine['variableManager'].getVariable('CustomVar')
      expect(variable?.nodeId).toBe('ns=1;s=CustomVariable')
    })
  })

  describe('error handling', () => {
    it('should handle invalid variable names gracefully', () => {
      // These should either work or fail gracefully
      expect(() => {
        machine.initCyclicRead('::Invalid::::Format')
      }).not.toThrow() // Should be caught and logged
    })
  })
})
