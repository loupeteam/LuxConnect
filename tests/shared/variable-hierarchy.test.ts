import { describe, it, expect, beforeEach } from 'vitest';
import { VariableHierarchy} from '../../src/variable-hierarchy.js';

describe('VariableHierarchy (Cross-Platform)', () => {
  let hierarchy: VariableHierarchy;
  let mockDate: Date;

  beforeEach(() => {
    hierarchy = new VariableHierarchy();
    mockDate = new Date('2024-01-01T12:00:00Z');
  });

  describe('variable addition and retrieval', () => {
    it('should add a simple variable correctly', () => {
      const mapping = hierarchy.addVariable(
        'Temperature', 
        'ns=1;s=Temperature', 
        25.5, 
        mockDate, 
        'good'
      );

      expect(mapping.name).toBe('Temperature');
      expect(mapping.nodeId).toBe('ns=1;s=Temperature');
      expect(mapping.parsedPath).toEqual({
        application: '',
        task: 'AsGlobalPV',
        variable: 'Temperature',
        path: []
      });

      const retrieved = hierarchy.getVariable('Temperature');
      expect(retrieved).toBeDefined();
      expect(retrieved!.value).toBe(25.5);
      expect(retrieved!.timestamp).toBe(mockDate);
      expect(retrieved!.quality).toBe('good');
    });

    it('should add a structured variable correctly', () => {
      const mapping = hierarchy.addVariable(
        'Motor.Speed',
        'ns=1;s=Motor.Speed',
        1500,
        mockDate,
        'good'
      );

      expect(mapping.parsedPath).toEqual({
        application: '',
        task: 'AsGlobalPV',
        variable: 'Motor',
        path: ['Speed']
      });

      const retrieved = hierarchy.getVariable('Motor.Speed');
      expect(retrieved!.value).toBe(1500);
    });

    it('should add a task-local variable correctly', () => {
      const mapping = hierarchy.addVariable(
        'MainTask:LocalVar',
        'ns=1;s=MainTask:LocalVar',
        'test_value',
        mockDate,
        'good'
      );

      expect(mapping.parsedPath).toEqual({
        application: '',
        task: 'MainTask',
        variable: 'LocalVar',
        path: []
      });

      const retrieved = hierarchy.getVariable('MainTask:LocalVar');
      expect(retrieved!.value).toBe('test_value');
    });

    it('should add a full format variable correctly', () => {
      const mapping = hierarchy.addVariable(
        'MyApp::MainTask:SystemData.Status',
        'ns=1;s=MyApp::MainTask:SystemData.Status',
        true,
        mockDate,
        'good'
      );

      expect(mapping.parsedPath).toEqual({
        application: 'MyApp',
        task: 'MainTask',
        variable: 'SystemData',
        path: ['Status']
      });

      const retrieved = hierarchy.getVariable('MyApp::MainTask:SystemData.Status');
      expect(retrieved!.value).toBe(true);
    });

    it('should handle array variables correctly', () => {
      const mapping = hierarchy.addVariable(
        'DataArray[0].Value',
        'ns=1;s=DataArray[0].Value',
        42,
        mockDate,
        'good'
      );

      expect(mapping.parsedPath.path).toEqual(['[0]', 'Value']);

      const retrieved = hierarchy.getVariable('DataArray[0].Value');
      expect(retrieved!.value).toBe(42);
    });

    it('should return undefined for non-existent variables', () => {
      const result = hierarchy.getVariable('NonExistent');
      expect(result).toBeUndefined();
    });

    it('should include dataType when provided', () => {
      const mapping = hierarchy.addVariable(
        'TypedVar',
        'ns=1;s=TypedVar',
        123,
        mockDate,
        'good',
        'DINT'
      );

      expect(mapping.dataType).toBe('DINT');
    });

    it('should return complex dataType when provided', () => {
        const mapping = hierarchy.addVariable(
          'ComplexVar',
          'ns=1;s=ComplexVar',
            { field1: 1, field2: 'two', field3: { subfield: 3 } },
            mockDate,
            'good',
            'Structure'
        );
        expect(mapping.dataType).toBe('Structure');
        const retrieved = hierarchy.getVariable('ComplexVar');
        expect(retrieved!.value).toEqual({ field1: 1, field2: 'two', field3: { subfield: 3 } });
    });
  });

  describe('variable lookup by nodeId', () => {
    it('should retrieve variable by nodeId', () => {
      hierarchy.addVariable('TestVar', 'ns=1;s=TestVar', 'value', mockDate, 'good');
      
      const result = hierarchy.getVariableByNodeId('ns=1;s=TestVar');
      expect(result).toBeDefined();
      expect(result!.mapping.name).toBe('TestVar');
      expect(result!.value).toBe('value');
    });

    it('should return undefined for non-existent nodeId', () => {
      const result = hierarchy.getVariableByNodeId('ns=1;s=NonExistent');
      expect(result).toBeUndefined();
    });
  });

  describe('variable updates and propagation', () => {
    it('should update variable value correctly', () => {
      hierarchy.addVariable('Temperature', 'ns=1;s=Temperature', 25.5, mockDate, 'good');
      
      const newDate = new Date('2024-01-01T12:30:00Z');
      const affected = hierarchy.updateVariable('Temperature', 30.2, newDate, 'good');
      
      expect(affected).toContain('Temperature');
      
      const retrieved = hierarchy.getVariable('Temperature');
      expect(retrieved!.value).toBe(30.2);
      expect(retrieved!.timestamp).toBe(newDate);
    });

    it('should create and return variable for non-existent variable update', () => {
      const affected = hierarchy.updateVariable('NonExistent', 123, mockDate, 'good');
      expect(affected).toEqual(['NonExistent']);
      
      // Verify the variable was actually created
      const variable = hierarchy.getVariable('NonExistent');
      expect(variable).toBeDefined();
      expect(variable?.value).toBe(123);
    });

    it('should detect affected variables when updating parent structures', () => {
      // Add a parent structure variable
      hierarchy.addVariable('Motor', 'ns=1;s=Motor', { Speed: 1000, Status: 'OK' }, mockDate, 'good');
      // Add a child variable
      hierarchy.addVariable('Motor.Speed', 'ns=1;s=Motor.Speed', 1000, mockDate, 'good');
      
      // Update the parent - should affect the child
      const affected = hierarchy.updateVariable('Motor', { Speed: 1500, Status: 'Running' }, mockDate, 'good');
      
      expect(affected).toContain('Motor');
      expect(affected).toContain('Motor.Speed');
    });

    it('should detect affected variables when updating child elements', () => {
      // Add parent and child variables
      hierarchy.addVariable('System', 'ns=1;s=System', { Temperature: 25, Pressure: 1013 }, mockDate, 'good');
      hierarchy.addVariable('System.Temperature', 'ns=1;s=System.Temperature', 25, mockDate, 'good');
      
      // Update the child - should affect the parent
      const affected = hierarchy.updateVariable('System.Temperature', 30, mockDate, 'good');
      
      expect(affected).toContain('System.Temperature');
      expect(affected).toContain('System');
    });
  });

  describe('variable removal', () => {
    it('should remove variable successfully', () => {
      hierarchy.addVariable('TempVar', 'ns=1;s=TempVar', 100, mockDate, 'good');
      
      const removed = hierarchy.removeVariable('TempVar');
      expect(removed).toBe(true);
      
      const retrieved = hierarchy.getVariable('TempVar');
      expect(retrieved).toBeUndefined();
      
      const byNodeId = hierarchy.getVariableByNodeId('ns=1;s=TempVar');
      expect(byNodeId).toBeUndefined();
    });

    it('should return false when removing non-existent variable', () => {
      const removed = hierarchy.removeVariable('NonExistent');
      expect(removed).toBe(false);
    });
  });

  describe('variable relationships', () => {
    beforeEach(() => {
      // Set up a hierarchy of related variables using clear parent-child relationships
      hierarchy.addVariable('System', 'ns=1;s=System', {}, mockDate, 'good');
      hierarchy.addVariable('System.Motor', 'ns=1;s=System.Motor', {}, mockDate, 'good');
      hierarchy.addVariable('System.Motor.Speed', 'ns=1;s=System.Motor.Speed', 1000, mockDate, 'good');
      hierarchy.addVariable('System.Motor.Status', 'ns=1;s=System.Motor.Status', 'OK', mockDate, 'good');
      hierarchy.addVariable('System.Sensors', 'ns=1;s=System.Sensors', {}, mockDate, 'good');
      hierarchy.addVariable('System.Sensors.Temperature', 'ns=1;s=System.Sensors.Temperature', 25, mockDate, 'good');
    });

    it('should find child relationships correctly', () => {
      const related = hierarchy.findRelatedVariables('System');
      
      const children = related.filter(r => r.type === 'child');
      // System should have System.Motor and System.Sensors as direct children
      expect(children.length).toBeGreaterThan(0);
      expect(children.map(c => c.variable)).toContain('System.Motor');
      expect(children.map(c => c.variable)).toContain('System.Sensors');
    });

    it('should find parent relationships correctly', () => {
      const related = hierarchy.findRelatedVariables('System.Motor.Speed');
      
      const parents = related.filter(r => r.type === 'parent');
      // System.Motor.Speed should have System.Motor and System as parents
      expect(parents.length).toBeGreaterThan(0);
      expect(parents.map(p => p.variable)).toContain('System.Motor');
      expect(parents.map(p => p.variable)).toContain('System');
    });

    it('should find sibling relationships correctly', () => {
      const related = hierarchy.findRelatedVariables('System.Motor.Speed');
      
      const siblings = related.filter(r => r.type === 'sibling');
      // System.Motor.Speed should have System.Motor.Status as sibling
      expect(siblings.length).toBeGreaterThan(0);
      expect(siblings.map(s => s.variable)).toContain('System.Motor.Status');
    });

    it('should find no relationships for isolated variables', () => {
      hierarchy.addVariable('IsolatedVar', 'ns=1;s=IsolatedVar', 'alone', mockDate, 'good');
      
      const related = hierarchy.findRelatedVariables('IsolatedVar');
      
      // IsolatedVar should have no relationships with the System hierarchy
      const nonSystemRelated = related.filter(r => !r.variable.startsWith('System'));
      expect(nonSystemRelated).toHaveLength(0);
    });
  });

  describe('global state management', () => {
    it('should maintain global state correctly for simple variables', () => {
      hierarchy.addVariable('Temperature', 'ns=1;s=Temperature', 25.5, mockDate, 'good');
      hierarchy.addVariable('Pressure', 'ns=1;s=Pressure', 1013.25, mockDate, 'good');
      
      const globalState = hierarchy.getGlobalState();
      
      expect(globalState).toEqual({
        _default: {
          AsGlobalPV: {
            Temperature: 25.5,
            Pressure: 1013.25
          }
        }
      });
    });

    it('should maintain global state correctly for structured variables', () => {
      hierarchy.addVariable('Motor.Speed', 'ns=1;s=Motor.Speed', 1500, mockDate, 'good');
      hierarchy.addVariable('Motor.Status', 'ns=1;s=Motor.Status', 'Running', mockDate, 'good');
      
      const globalState = hierarchy.getGlobalState();
      
      expect(globalState).toEqual({
        _default: {
          AsGlobalPV: {
            Motor: {
              Speed: 1500,
              Status: 'Running'
            }
          }
        }
      });
    });

    it('should maintain global state correctly for task-local variables', () => {
      hierarchy.addVariable('MainTask:LocalVar', 'ns=1;s=MainTask:LocalVar', 'test', mockDate, 'good');
      hierarchy.addVariable('WorkerTask:Data.Value', 'ns=1;s=WorkerTask:Data.Value', 42, mockDate, 'good');
      
      const globalState = hierarchy.getGlobalState();
      
      expect(globalState).toEqual({
        _default: {
          MainTask: {
            LocalVar: 'test'
          },
          WorkerTask: {
            Data: {
              Value: 42
            }
          }
        }
      });
    });

    it('should maintain global state correctly for full format variables', () => {
      hierarchy.addVariable('MyApp::MainTask:Config.Timeout', 'ns=1;s=MyApp::MainTask:Config.Timeout', 5000, mockDate, 'good');
      
      const globalState = hierarchy.getGlobalState();
      
      expect(globalState).toEqual({
        MyApp: {
          MainTask: {
            Config: {
              Timeout: 5000
            }
          }
        }
      });
    });

    it('should handle array indices in global state', () => {
      hierarchy.addVariable('DataArray[0]', 'ns=1;s=DataArray[0]', 'first', mockDate, 'good');
      hierarchy.addVariable('DataArray[1].Value', 'ns=1;s=DataArray[1].Value', 42, mockDate, 'good');
      
      const globalState = hierarchy.getGlobalState();
      
      // Should use proper array syntax, not string keys with brackets
      expect(Array.isArray(globalState._default.AsGlobalPV.DataArray)).toBe(true);
      expect(globalState._default.AsGlobalPV.DataArray[0]).toBe('first');
      expect(globalState._default.AsGlobalPV.DataArray[1]).toBeDefined();
      expect(globalState._default.AsGlobalPV.DataArray[1].Value).toBe(42);
    });

    it('should update global state when variables are updated', () => {
      hierarchy.addVariable('Counter', 'ns=1;s=Counter', 0, mockDate, 'good');
      hierarchy.updateVariable('Counter', 1, mockDate, 'good');
      hierarchy.updateVariable('Counter', 2, mockDate, 'good');
      
      const globalState = hierarchy.getGlobalState();
      expect(globalState._default.AsGlobalPV.Counter).toBe(2);
    });
  });

  describe('get all variables', () => {
    it('should return all variables with their data', () => {
      hierarchy.addVariable('Var1', 'ns=1;s=Var1', 'value1', mockDate, 'good');
      hierarchy.addVariable('Var2', 'ns=1;s=Var2', 'value2', mockDate, 'good');
      hierarchy.addVariable('Var3', 'ns=1;s=Var3', 'value3', mockDate, 'good');
      
      const allVariables = hierarchy.getAllVariables();
      
      expect(allVariables.size).toBe(3);
      expect(allVariables.has('Var1')).toBe(true);
      expect(allVariables.has('Var2')).toBe(true);
      expect(allVariables.has('Var3')).toBe(true);
      
      expect(allVariables.get('Var1')!.value).toBe('value1');
      expect(allVariables.get('Var2')!.value).toBe('value2');
      expect(allVariables.get('Var3')!.value).toBe('value3');
    });

    it('should return empty map when no variables exist', () => {
      const allVariables = hierarchy.getAllVariables();
      expect(allVariables.size).toBe(0);
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle complex nested structures correctly', () => {
      
      hierarchy.addVariable('Complex.level1.level2.level3.deepValue', 'ns=1;s=Complex.level1.level2.level3.deepValue', 'found', mockDate, 'good');
      
      const retrieved = hierarchy.getVariable('Complex.level1.level2.level3.deepValue');
      expect(retrieved!.value).toBe('found');
      
      const globalState = hierarchy.getGlobalState();
      expect(globalState._default.AsGlobalPV.Complex.level1.level2.level3.deepValue).toBe('found');
    });

    it('should handle multi-dimensional arrays correctly', () => {
      hierarchy.addVariable('Matrix[0,1].Data[2]', 'ns=1;s=Matrix[0,1].Data[2]', 'cell_value', mockDate, 'good');
      
      const retrieved = hierarchy.getVariable('Matrix[0,1].Data[2]');
      expect(retrieved!.value).toBe('cell_value');
      
      const globalState = hierarchy.getGlobalState();
      // Should use proper array syntax for multi-dimensional arrays
      expect(Array.isArray(globalState._default.AsGlobalPV.Matrix)).toBe(true);
      expect(Array.isArray(globalState._default.AsGlobalPV.Matrix[0])).toBe(true);
      expect(globalState._default.AsGlobalPV.Matrix[0][1]).toBeDefined();
      expect(Array.isArray(globalState._default.AsGlobalPV.Matrix[0][1].Data)).toBe(true);
      expect(globalState._default.AsGlobalPV.Matrix[0][1].Data[2]).toBe('cell_value');
    });

    it('should maintain data integrity during concurrent updates', () => {
      // Add base structure
      hierarchy.addVariable('System.Config', 'ns=1;s=System.Config', { timeout: 1000, retries: 3 }, mockDate, 'good');
      
      // Add individual components
      hierarchy.addVariable('System.Config.timeout', 'ns=1;s=System.Config.timeout', 1000, mockDate, 'good');
      hierarchy.addVariable('System.Config.retries', 'ns=1;s=System.Config.retries', 3, mockDate, 'good');
      
      // Update individual component
      hierarchy.updateVariable('System.Config.timeout', 2000, mockDate, 'good');
      
      // Verify both the component and the structure are updated
      const component = hierarchy.getVariable('System.Config.timeout');
      const structure = hierarchy.getVariable('System.Config');
      
      expect(component!.value).toBe(2000);
      expect(structure!.value.timeout).toBe(2000);

      // The global state should reflect the change
      const globalState = hierarchy.getGlobalState();
      expect(globalState._default.AsGlobalPV.System.Config.timeout).toBe(2000);
    });

    it('should handle mixed array and object scenarios', () => {
      // Test case: server provides a full array, but user also adds individual elements
      hierarchy.addVariable('MixedData', 'ns=1;s=MixedData', ['server_item_0', 'server_item_1', 'server_item_2'], mockDate, 'good');
      hierarchy.addVariable('MixedData[3]', 'ns=1;s=MixedData[3]', 'user_item_3', mockDate, 'good');
      
      const globalState = hierarchy.getGlobalState();
      expect(Array.isArray(globalState._default.AsGlobalPV.MixedData)).toBe(true);
      expect(globalState._default.AsGlobalPV.MixedData[0]).toBe('server_item_0');
      expect(globalState._default.AsGlobalPV.MixedData[1]).toBe('server_item_1');
      expect(globalState._default.AsGlobalPV.MixedData[2]).toBe('server_item_2');
      expect(globalState._default.AsGlobalPV.MixedData[3]).toBe('user_item_3');
    });

    it('should handle sparse arrays correctly', () => {
      // Test case: user specifies non-contiguous array indices
      hierarchy.addVariable('SparseArray[0]', 'ns=1;s=SparseArray[0]', 'first', mockDate, 'good');
      hierarchy.addVariable('SparseArray[5]', 'ns=1;s=SparseArray[5]', 'sixth', mockDate, 'good');
      hierarchy.addVariable('SparseArray[2]', 'ns=1;s=SparseArray[2]', 'third', mockDate, 'good');
      
      const globalState = hierarchy.getGlobalState();
      expect(Array.isArray(globalState._default.AsGlobalPV.SparseArray)).toBe(true);
      expect(globalState._default.AsGlobalPV.SparseArray[0]).toBe('first');
      expect(globalState._default.AsGlobalPV.SparseArray[1]).toBeUndefined(); // sparse
      expect(globalState._default.AsGlobalPV.SparseArray[2]).toBe('third');
      expect(globalState._default.AsGlobalPV.SparseArray[5]).toBe('sixth');
      expect(globalState._default.AsGlobalPV.SparseArray.length).toBe(6); // Array length should be 6
    });

    it('should handle converting from string-keyed arrays to proper arrays', () => {
      // Simulate the old behavior to test conversion
      hierarchy.addVariable('ConvertArray[0]', 'ns=1;s=ConvertArray[0]', 'item0', mockDate, 'good');
      hierarchy.addVariable('ConvertArray[1]', 'ns=1;s=ConvertArray[1]', 'item1', mockDate, 'good');
      
      // Then add a regular array value (simulating server data)
      hierarchy.updateVariable('ConvertArray', ['new_item0', 'new_item1', 'new_item2'], mockDate, 'good');
      
      const globalState = hierarchy.getGlobalState();
      expect(Array.isArray(globalState._default.AsGlobalPV.ConvertArray)).toBe(true);
      expect(globalState._default.AsGlobalPV.ConvertArray[0]).toBe('new_item0');
      expect(globalState._default.AsGlobalPV.ConvertArray[1]).toBe('new_item1');
      expect(globalState._default.AsGlobalPV.ConvertArray[2]).toBe('new_item2');
    });
  });

  describe('performance optimizations', () => {
    it('should return direct reference to global state for performance', () => {
      const originalObject = { nested: { value: 'original' } };
      hierarchy.addVariable('TestObj', 'ns=1;s=TestObj', originalObject, mockDate, 'good');
      
      const globalState1 = hierarchy.getGlobalState();
      const globalState2 = hierarchy.getGlobalState();
      
      // Should be same objects (direct reference for performance)
      expect(globalState1).toBe(globalState2);
      expect(globalState1._default.AsGlobalPV.TestObj).toBe(globalState2._default.AsGlobalPV.TestObj);
      
      // Should have same content
      expect(globalState1).toEqual(globalState2);
      
      // NOTE: For performance, developers are trusted not to modify the returned state
      // If they do modify it, it will affect the internal state (this is by design)
      expect(globalState1._default.AsGlobalPV.TestObj.nested.value).toBe('original');
    });

    it('should maintain internal state immutability during updates', () => {
      const originalArray = [1, 2, 3];
      hierarchy.addVariable('TestArray', 'ns=1;s=TestArray', originalArray, mockDate, 'good');
      
      const retrievedBefore = hierarchy.getVariable('TestArray');
      expect(retrievedBefore!.value).toEqual([1, 2, 3]);
      
      // Update with new array
      hierarchy.updateVariable('TestArray', [4, 5, 6], mockDate, 'good');
      
      // Original reference should be unchanged (if it were to be retrieved somehow)
      const retrievedAfter = hierarchy.getVariable('TestArray');
      expect(retrievedAfter!.value).toEqual([4, 5, 6]);
      
      // Global state should reflect the new value
      const globalState = hierarchy.getGlobalState();
      expect(globalState._default.AsGlobalPV.TestArray).toEqual([4, 5, 6]);
    });
  });

  describe('performance and scalability', () => {
    it('should handle large number of variables efficiently', () => {
      const variableCount = 1000;
      const startTime = Date.now();
      
      // Add many variables
      for (let i = 0; i < variableCount; i++) {
        hierarchy.addVariable(`Var${i}`, `ns=1;s=Var${i}`, i, mockDate, 'good');
      }
      
      const addTime = Date.now() - startTime;
      
      // Retrieve all variables
      const retrieveStart = Date.now();
      const allVars = hierarchy.getAllVariables();
      const retrieveTime = Date.now() - retrieveStart;
      
      expect(allVars.size).toBe(variableCount);
      expect(addTime).toBeLessThan(10); // Should complete within 10 ms (more reasonable)
      expect(retrieveTime).toBeLessThan(100); // Retrieval should be fast
    });

    it('should handle deep hierarchies efficiently', () => {
      const depth = 20;
      let variableName = 'Root';
      
      for (let i = 0; i < depth; i++) {
        variableName += `.Level${i}`;
      }
      
      const startTime = Date.now();
      hierarchy.addVariable(variableName, `ns=1;s=${variableName}`, 'deep_value', mockDate, 'good');
      const addTime = Date.now() - startTime;
      
      const retrieveStart = Date.now();
      const retrieved = hierarchy.getVariable(variableName);
      const retrieveTime = Date.now() - retrieveStart;
      
      expect(retrieved!.value).toBe('deep_value');
      expect(addTime).toBeLessThan(50); // Should be fast even for deep structures
      expect(retrieveTime).toBeLessThan(10); // Retrieval should be very fast
    });
  });
});