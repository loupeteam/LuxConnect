import { describe, it, expect, beforeEach } from 'vitest'
import { VariableManager } from '../../src/variable-manager.js'
import { OpcuaConnection } from '../../src/connection.js'
import { mockConnectionConfig, mockNodeIds } from '../fixtures/test-data.js'

describe('VariableManager (Cross-Platform)', () => {
  let variableManager: VariableManager
  let connection: OpcuaConnection

  beforeEach(() => {
    connection = new OpcuaConnection(mockConnectionConfig)
    variableManager = new VariableManager(connection)
  })

  describe('variable registration', () => {
    it('should register valid variables', () => {
      const variable = variableManager.registerVariable('Temperature', mockNodeIds.Temperature)
      
      expect(variable.name).toBe('Temperature')
      expect(variable.nodeId).toBe(mockNodeIds.Temperature)
      expect(variable.value).toBeUndefined()
      expect(variable.quality).toBe('unknown')
    })

    it('should prevent duplicate registration', () => {
      variableManager.registerVariable('Temperature', mockNodeIds.Temperature)
      
      expect(() => {
        variableManager.registerVariable('Temperature', 'ns=5;s=AnotherNodeId')
      }).toThrow('already registered')
    })

    it('should gracefully handle multiple registrations of the same variable', () => {
      variableManager.registerVariable('Temperature', mockNodeIds.Temperature)
      variableManager.registerVariable('Temperature', mockNodeIds.Temperature)
      expect(variableManager.getVariable('Temperature')).toBeDefined()
    })


    it('should validate variable name format', () => {
      expect(() => {
        variableManager.registerVariable('::Invalid::::Format', 'ns=5;s=Test')
      }).toThrow('Invalid variable name format')
    })
  })

  describe('variable retrieval', () => {
    it('should retrieve registered variables', () => {
      variableManager.registerVariable('Temperature', mockNodeIds.Temperature)
      
      const retrieved = variableManager.getVariable('Temperature')
      expect(retrieved).toBeDefined()
      expect(retrieved?.name).toBe('Temperature')
      expect(retrieved?.nodeId).toBe(mockNodeIds.Temperature)
    })

    it('should return undefined for unregistered variables', () => {
      const retrieved = variableManager.getVariable('NonExistent')
      expect(retrieved).toBeUndefined()
    })
  })

  describe('variable lifecycle', () => {
    it('should unregister variables', () => {
      variableManager.registerVariable('Temperature', mockNodeIds.Temperature)
      expect(variableManager.getVariable('Temperature')).toBeDefined()
      
      variableManager.unregisterVariable('Temperature')
      expect(variableManager.getVariable('Temperature')).toBeUndefined()
    })

    it('should handle unregistering non-existent variables', () => {
      const result = variableManager.unregisterVariable('NonExistent')
      expect(result).toBe(false)  // Should return false, not throw
    })
  })

  describe('change handlers', () => {
    it('should register change handlers', () => {
      variableManager.registerVariable('Temperature', mockNodeIds.Temperature)
      
      let changeTriggered = false
      variableManager.onChange('Temperature', () => {
        changeTriggered = true
      })
      
      // Handler should be registered (no error thrown)
      expect(changeTriggered).toBe(false) // Not triggered yet
    })

    it('should not allow handlers for unregistered variables', () => {
      expect(() => {
        variableManager.onChange('NonExistent', () => {})
      }).toThrow('not registered')
    })
  })

  describe('global state management', () => {
    it('should provide global state access', () => {
      variableManager.registerVariable('Temperature', mockNodeIds.Temperature)
      variableManager.registerVariable('Motor.Speed', mockNodeIds['Motor.Speed'])
      
      const globalState = variableManager.getGlobalState()
      expect(globalState).toBeDefined()
      expect(typeof globalState).toBe('object')
    })
  })
})
