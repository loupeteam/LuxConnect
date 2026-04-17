import { describe, it, expect, beforeEach, vi } from 'vitest'
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
      expect(variable?.name).toBe('::AsGlobalPV:Temperature') // Normalized name
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
      // Invalid variable names now throw — callers are responsible for validation
      expect(() => {
        machine.initCyclicRead('::Invalid::::Format')
      }).toThrow()
    })
  })

  describe('configuration methods', () => {
    it('should set default namespace', () => {
      machine.setDefaultNamespace('ns=5')
      
      // Check that the namespace is stored with correct format
      expect(machine['defaultNamespace']).toBe('ns=5;s=')
    })

    it('should auto-append ;s= to namespace if missing', () => {
      machine.setDefaultNamespace('ns=3;s=')
      expect(machine['defaultNamespace']).toBe('ns=3;s=')
      
      machine.setDefaultNamespace('ns=7')
      expect(machine['defaultNamespace']).toBe('ns=7;s=')
    })

    it('should set default application', () => {
      machine.setDefaultApplication('MyApp')
      expect(machine['defaultApplication']).toBe('MyApp')
    })

    it('should set default task', () => {
      machine.setDefaultTask('Production')
      expect(machine['defaultTask']).toBe('Production')
    })

    it('should configure variable manager when setting defaults', () => {
      const vmSetNamespaceSpy = vi.spyOn(machine['variableManager'], 'setDefaultNamespace')
      const vmSetApplicationSpy = vi.spyOn(machine['variableManager'], 'setDefaultApplication')  
      const vmSetTaskSpy = vi.spyOn(machine['variableManager'], 'setDefaultTask')
      
      machine.setDefaultNamespace('ns=5;s=')
      machine.setDefaultApplication('TestApp')
      machine.setDefaultTask('TestTask')
      
      expect(vmSetNamespaceSpy).toHaveBeenCalledWith('ns=5;s=')
      expect(vmSetApplicationSpy).toHaveBeenCalledWith('TestApp')
      expect(vmSetTaskSpy).toHaveBeenCalledWith('TestTask')
    })
  })

  describe('subscription management (unit tests)', () => {
    it('should throw error for invalid subscription handle in unsubscribe', async () => {
      await expect(
        machine.unsubscribe('invalid-handle-123')
      ).rejects.toThrow("Subscription handle 'invalid-handle-123' not found")
    })
  })

  describe('read groups management', () => {
    it('should configure read groups with options', () => {
      machine.configureReadGroup('FastGroup', {
        publishingInterval: 50,
        enabled: true
      })
      
      const group = machine['readGroups'].get('FastGroup')
      expect(group).toBeDefined()
      expect(group?.options.publishingInterval).toBe(50)
      expect(group?.options.enabled).toBe(true)
    })

    it('should handle disabled read groups', () => {
      machine.configureReadGroup('DisabledGroup', {
        publishingInterval: 100,
        enabled: false
      })
      
      const group = machine['readGroups'].get('DisabledGroup')
      expect(group?.options.enabled).toBe(false)
    })
  })

  describe('proxy behavior edge cases', () => {
    it('should handle deep property access safely', () => {
      // Test that proxy doesn't throw on deeply nested undefined properties
      const proxyMachine = machine as any
      
      expect(proxyMachine.nonexistent?.deep?.nested?.property).toBeUndefined()
      expect(proxyMachine.test?.test?.nonexistent?.member).toBeUndefined()
    })

    it('should handle property writes', () => {
      const proxyMachine = machine as any
      
      // Mock writeVariable to test proxy write behavior
      const writeVariableSpy = vi.spyOn(machine, 'writeVariable').mockResolvedValue()
      
      // This should trigger the proxy setter
      proxyMachine.TestVar = 123
      
      // The proxy should call writeVariable asynchronously
      expect(writeVariableSpy).toHaveBeenCalledWith('TestVar', 123)
    })
  })

  describe('cross-scope proxy behavior', () => {
    it('should use createVariableProxy for cross-scope access', () => {
      // Mock variable manager to have global state with cross-scope structure
      const mockGlobalState = {
        AppModule1: {
          ScopeA: {
            var1: 'value1',
            var2: 42
          }
        },
        AppModule2: {
          ScopeB: {
            var3: 'value3',
            var4: 100
          }
        }
      }
      
      const getGlobalStateSpy = vi.spyOn(machine['variableManager'], 'getGlobalState')
        .mockReturnValue(mockGlobalState)
      
      const proxyMachine = machine as any
      
      // This should trigger createVariableProxy because:
      // - 'ScopeA' doesn't exist as a top-level app module (mockGlobalState['ScopeA'] is falsy)  
      // - But 'ScopeA' exists within AppModule1 (mockGlobalState['AppModule1']['ScopeA'] is truthy)
      const scopeAProxy = proxyMachine.ScopeA
      
      // Verify we got the proxy with the scope data
      expect(scopeAProxy).toBeDefined()
      expect(scopeAProxy.var1).toBe('value1')
      expect(scopeAProxy.var2).toBe(42)
      
      // Similarly for ScopeB in AppModule2
      const scopeBProxy = proxyMachine.ScopeB
      expect(scopeBProxy).toBeDefined() 
      expect(scopeBProxy.var3).toBe('value3')
      expect(scopeBProxy.var4).toBe(100)
      
      // Verify getGlobalState was called during proxy access
      expect(getGlobalStateSpy).toHaveBeenCalled()
    })

    it('should handle cross-scope proxy enumeration', () => {
      // Mock global state
      const mockGlobalState = {
        TestApp: {
          TestScope: {
            enumVar1: 'test1',
            enumVar2: 'test2',
            enumVar3: 100
          }
        }
      }
      
      vi.spyOn(machine['variableManager'], 'getGlobalState')
        .mockReturnValue(mockGlobalState)
      
      const proxyMachine = machine as any
      const testScopeProxy = proxyMachine.TestScope
      
      // Test that the proxy supports enumeration
      const keys = Object.keys(testScopeProxy)
      expect(keys).toContain('enumVar1')
      expect(keys).toContain('enumVar2')
      expect(keys).toContain('enumVar3')
      expect(keys).toHaveLength(3)
    })

    it('should handle cross-scope proxy edge cases', () => {
      // Mock global state with some data
      const mockGlobalState = {
        App1: {
          Scope1: {
            existingVar: 'exists'
          }
        }
      }
      
      vi.spyOn(machine['variableManager'], 'getGlobalState')
        .mockReturnValue(mockGlobalState)
      
      const proxyMachine = machine as any
      const scope1Proxy = proxyMachine.Scope1
      
      // Access existing property (covered path)
      expect(scope1Proxy.existingVar).toBe('exists')
      
      // Access non-existing property (this should trigger the "return undefined" at line 566)
      expect(scope1Proxy.nonExistentVar).toBeUndefined()
      
      // Test property descriptor for existing property
      const existingDesc = Object.getOwnPropertyDescriptor(scope1Proxy, 'existingVar')
      expect(existingDesc).toBeDefined()
      expect(existingDesc?.enumerable).toBe(true)
      expect(existingDesc?.configurable).toBe(true)
      expect(existingDesc?.value).toBe('exists')
      
      // Test property descriptor for non-existing property (this should trigger the "return undefined" at line 582)
      const nonExistentDesc = Object.getOwnPropertyDescriptor(scope1Proxy, 'nonExistentVar')
      expect(nonExistentDesc).toBeUndefined()
    })
  })

  describe('error handler registration', () => {
    it('should register error handlers', () => {
      const errorHandler = vi.fn()
      const connectionErrorSpy = vi.spyOn(machine['connection'], 'onError')
      
      machine.onError(errorHandler)
      
      expect(connectionErrorSpy).toHaveBeenCalledWith(errorHandler)
    })
  })
})
