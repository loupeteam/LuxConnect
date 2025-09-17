import { describe, it, expect, beforeEach } from 'vitest';
import { VariableHierarchy } from '../../src/variable-hierarchy';

describe('Object Update Behavior', () => {
  let hierarchy: VariableHierarchy;
  let mockDate: Date;

  beforeEach(() => {
    hierarchy = new VariableHierarchy();
    mockDate = new Date('2024-01-01T12:00:00Z');
  });

  describe('Partial Object Updates (Merging)', () => {
    it('should merge partial object updates, preserving existing properties', () => {
      // Initial object with multiple members
      const initialValue = { 
        member1: 1, 
        member2: 2, 
        member3: 'original' 
      };
      
      hierarchy.addVariable('myobj', 'ns=1;s=myobj', initialValue, mockDate, 'good');
      
      // Verify initial state
      let variable = hierarchy.getVariable('myobj');
      expect(variable?.value).toEqual(initialValue);
      
      // Update with partial object
      const partialUpdate = { member1: 100 };
      hierarchy.updateVariable('myobj', partialUpdate, mockDate, 'good');
      
      // Verify that the object was merged, not replaced
      variable = hierarchy.getVariable('myobj');
      expect(variable?.value).toEqual({
        member1: 100,  // Updated
        member2: 2,    // Preserved
        member3: 'original'  // Preserved
      });
      expect(variable?.value).toHaveProperty('member2');
      expect(variable?.value).toHaveProperty('member3');
    });

    it('should merge partial updates in global state, preserving existing properties', () => {
      // Initial complex object
      const initialValue = { 
        temperature: 25.5, 
        pressure: 1013, 
        status: 'OK',
        metadata: { source: 'sensor1', calibrated: true }
      };
      
      hierarchy.addVariable('sensor', 'ns=1;s=sensor', initialValue, mockDate, 'good');
      
      // Update with partial values
      const partialUpdate = { 
        temperature: 30.0,
        humidity: 65,
        location: 'room2'
      };
      hierarchy.updateVariable('sensor', partialUpdate, mockDate, 'good');
      
      // Check global state - should merge, not replace
      const globalState = hierarchy.getGlobalState();
      const sensorData = globalState._default.AsGlobalPV.sensor;
      
      expect(sensorData).toEqual({
        temperature: 30.0,     // Updated
        humidity: 65,          // Added
        location: 'room2',     // Added
        pressure: 1013,        // Preserved
        status: 'OK',          // Preserved
        metadata: { source: 'sensor1', calibrated: true }  // Preserved
      });
      expect(sensorData).toHaveProperty('pressure');
      expect(sensorData).toHaveProperty('status');
      expect(sensorData).toHaveProperty('metadata');
      expect(sensorData).toHaveProperty('humidity');
      expect(sensorData).toHaveProperty('location');
    });

    it('should merge nested object updates, preserving nested structure', () => {
      // Initial nested structure
      const initialValue = {
        config: {
          timeout: 5000,
          retries: 3,
          endpoints: ['url1', 'url2']
        },
        status: 'active',
        lastUpdate: '2024-01-01'
      };
      
      hierarchy.addVariable('connection', 'ns=1;s=connection', initialValue, mockDate, 'good');
      
      // Update with partial nested structure
      const partialUpdate = {
        config: {
          timeout: 10000,
          maxConnections: 100  // New property
        },
        version: '2.0'  // New top-level property
      };
      hierarchy.updateVariable('connection', partialUpdate, mockDate, 'good');
      
      // Verify merged result
      const variable = hierarchy.getVariable('connection');
      expect(variable?.value).toEqual({
        config: {
          timeout: 10000,        // Updated
          maxConnections: 100,   // Added
          retries: 3,            // Preserved from nested object
          endpoints: ['url1', 'url2']  // Preserved from nested object
        },
        status: 'active',        // Preserved
        lastUpdate: '2024-01-01', // Preserved
        version: '2.0'           // Added
      });
      expect(variable?.value.config).toHaveProperty('retries');
      expect(variable?.value.config).toHaveProperty('endpoints');
      expect(variable?.value).toHaveProperty('status');
      expect(variable?.value).toHaveProperty('lastUpdate');
    });

    it('should preserve other variables when updating one object', () => {
      // Add multiple variables
      hierarchy.addVariable('obj1', 'ns=1;s=obj1', { a: 1, b: 2 }, mockDate, 'good');
      hierarchy.addVariable('obj2', 'ns=1;s=obj2', { x: 10, y: 20 }, mockDate, 'good');
      hierarchy.addVariable('simple', 'ns=1;s=simple', 42, mockDate, 'good');
      
      // Update one object
      hierarchy.updateVariable('obj1', { a: 100 }, mockDate, 'good');
      
      // Verify obj1 was merged (not completely replaced)
      expect(hierarchy.getVariable('obj1')?.value).toEqual({ 
        a: 100,  // Updated
        b: 2     // Preserved from merge
      });
      
      // Verify other variables unchanged
      expect(hierarchy.getVariable('obj2')?.value).toEqual({ x: 10, y: 20 });
      expect(hierarchy.getVariable('simple')?.value).toBe(42);
    });

    it('should merge array properties correctly by index', () => {
      // Initial object with array
      const initialValue = {
        items: [1, 2, 3, 4],
        count: 4,
        type: 'numbers',
        metadata: { version: 1 }
      };
      
      hierarchy.addVariable('collection', 'ns=1;s=collection', initialValue, mockDate, 'good');
      
      // Update with partial array (should merge by index)
      const partialUpdate = {
        items: ['a', 'b'],  // Should replace indices 0,1 but preserve 2,3
        newField: 'added'
      };
      hierarchy.updateVariable('collection', partialUpdate, mockDate, 'good');
      
      // Verify merged result
      const variable = hierarchy.getVariable('collection');
      expect(variable?.value).toEqual({
        items: ['a', 'b', 3, 4],    // Merged by index: indices 0,1 updated, 2,3 preserved
        count: 4,                   // Preserved
        type: 'numbers',            // Preserved
        metadata: { version: 1 },   // Preserved
        newField: 'added'           // Added
      });
      expect(variable?.value).toHaveProperty('count');
      expect(variable?.value).toHaveProperty('type');
      expect(variable?.value).toHaveProperty('metadata');
    });

    it('should handle array extension during merge', () => {
      // Initial shorter array
      const initialValue = {
        sensors: [10, 20],
        status: 'ok'
      };
      
      hierarchy.addVariable('system', 'ns=1;s=system', initialValue, mockDate, 'good');
      
      // Update with longer array
      const partialUpdate = {
        sensors: [15, 25, 35, 45]  // Should extend the array
      };
      hierarchy.updateVariable('system', partialUpdate, mockDate, 'good');
      
      // Verify extension occurred
      const variable = hierarchy.getVariable('system');
      expect(variable?.value).toEqual({
        sensors: [15, 25, 35, 45],  // Extended array
        status: 'ok'                // Preserved
      });
    });

    it('should merge nested objects within arrays', () => {
      // Initial array with objects
      const initialValue = {
        devices: [
          { id: 1, name: 'Sensor1', status: 'online', temp: 25 },
          { id: 2, name: 'Sensor2', status: 'offline', temp: null },
          { id: 3, name: 'Sensor3', status: 'online', temp: 30 }
        ]
      };
      
      hierarchy.addVariable('deviceList', 'ns=1;s=deviceList', initialValue, mockDate, 'good');
      
      // Update specific array elements with partial objects
      const partialUpdate = {
        devices: [
          { status: 'maintenance', temp: 22 }, // Update index 0 (merge with existing)
          undefined, // Skip index 1 (preserve existing)
          { temp: 28, location: 'Room3' }  // Update index 2 (merge, add new property)
        ]
      };
      hierarchy.updateVariable('deviceList', partialUpdate, mockDate, 'good');
      
      // Verify nested object merging within array
      const variable = hierarchy.getVariable('deviceList');
      expect(variable?.value).toEqual({
        devices: [
          { id: 1, name: 'Sensor1', status: 'maintenance', temp: 22 }, // Merged
          { id: 2, name: 'Sensor2', status: 'offline', temp: null },    // Preserved (undefined skips)
          { id: 3, name: 'Sensor3', status: 'online', temp: 28, location: 'Room3' } // Merged with new property
        ]
      });
    });

    it('should handle direct array variable updates with merging', () => {
      // Direct array variable (not within object)
      const initialArray = [
        { sensor: 'A', value: 100 },
        { sensor: 'B', value: 200 },
        { sensor: 'C', value: 300 }
      ];
      
      hierarchy.addVariable('sensorArray', 'ns=1;s=sensorArray', initialArray, mockDate, 'good');
      
      // Update with partial array
      const partialUpdate = [
        { value: 150 }, // Merge with index 0
        undefined,      // Skip index 1  
        { value: 350, status: 'active' } // Merge with index 2, add property
      ];
      hierarchy.updateVariable('sensorArray', partialUpdate, mockDate, 'good');
      
      // Verify array merging
      const variable = hierarchy.getVariable('sensorArray');
      expect(variable?.value).toEqual([
        { sensor: 'A', value: 150 },                    // Merged
        { sensor: 'B', value: 200 },                    // Preserved
        { sensor: 'C', value: 350, status: 'active' }   // Merged with new property
      ]);
    });

    it('should handle primitive to object updates by replacement', () => {
      // Start with primitive value
      hierarchy.addVariable('dynamic', 'ns=1;s=dynamic', 42, mockDate, 'good');
      expect(hierarchy.getVariable('dynamic')?.value).toBe(42);
      
      // Update to object (primitive can't be merged, so this replaces)
      const objectValue = { value: 42, unit: 'degrees', valid: true };
      hierarchy.updateVariable('dynamic', objectValue, mockDate, 'good');
      
      // Verify complete replacement (can't merge with primitive)
      expect(hierarchy.getVariable('dynamic')?.value).toEqual(objectValue);
      
      // Now update the object with partial data (should merge)
      const partialUpdate = { value: 100, newProp: 'test' };
      hierarchy.updateVariable('dynamic', partialUpdate, mockDate, 'good');
      
      // Should merge with existing object
      expect(hierarchy.getVariable('dynamic')?.value).toEqual({
        value: 100,        // Updated
        unit: 'degrees',   // Preserved
        valid: true,       // Preserved
        newProp: 'test'    // Added
      });
      
      // Update back to primitive (replaces object)
      hierarchy.updateVariable('dynamic', 'new string value', mockDate, 'good');
      expect(hierarchy.getVariable('dynamic')?.value).toBe('new string value');
    });

    it('should handle null and undefined updates by replacement', () => {
      // Initial object
      const initialValue = { a: 1, b: 2, c: 3 };
      hierarchy.addVariable('testobj', 'ns=1;s=testobj', initialValue, mockDate, 'good');
      
      // Update with null (replaces entire object)
      hierarchy.updateVariable('testobj', null, mockDate, 'good');
      expect(hierarchy.getVariable('testobj')?.value).toBeNull();
      
      // Update with undefined (replaces entire object)
      hierarchy.updateVariable('testobj', undefined, mockDate, 'good');
      expect(hierarchy.getVariable('testobj')?.value).toBeUndefined();
      
      // Update back to object
      const newValue = { x: 100, y: 200 };
      hierarchy.updateVariable('testobj', newValue, mockDate, 'good');
      expect(hierarchy.getVariable('testobj')?.value).toEqual(newValue);
      
      // Now update with partial object (should merge)
      hierarchy.updateVariable('testobj', { x: 999, z: 300 }, mockDate, 'good');
      expect(hierarchy.getVariable('testobj')?.value).toEqual({
        x: 999,   // Updated
        y: 200,   // Preserved
        z: 300    // Added
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty object updates by merging (no changes)', () => {
      // Initial object
      const initialValue = { a: 1, b: 2 };
      hierarchy.addVariable('test', 'ns=1;s=test', initialValue, mockDate, 'good');
      
      // Update with empty object (should not change anything)
      hierarchy.updateVariable('test', {}, mockDate, 'good');
      
      // Verify no changes occurred
      expect(hierarchy.getVariable('test')?.value).toEqual(initialValue);
      expect(hierarchy.getVariable('test')?.value).toHaveProperty('a');
      expect(hierarchy.getVariable('test')?.value).toHaveProperty('b');
    });

    it('should maintain type consistency in merged global state', () => {
      // Add object variable
      hierarchy.addVariable('typed', 'ns=1;s=typed', { num: 42, str: 'hello' }, mockDate, 'good');
      
      // Update with different types
      hierarchy.updateVariable('typed', { bool: true, arr: [1, 2] }, mockDate, 'good');
      
      // Check global state maintains both old and new types
      const globalState = hierarchy.getGlobalState();
      const typedData = globalState._default.AsGlobalPV.typed;
      
      expect(typeof typedData.bool).toBe('boolean');    // New
      expect(Array.isArray(typedData.arr)).toBe(true);  // New
      expect(typeof typedData.num).toBe('number');      // Preserved
      expect(typeof typedData.str).toBe('string');      // Preserved
      expect(typedData).toHaveProperty('num');
      expect(typedData).toHaveProperty('str');
    });

    it('should handle deep nested object merging', () => {
      // Complex nested structure
      const initialValue = {
        level1: {
          level2: {
            level3: {
              deep: 'value',
              other: 123
            },
            sibling: 'preserved'
          },
          other: 'also preserved'
        },
        topLevel: 'maintained'
      };
      
      hierarchy.addVariable('nested', 'ns=1;s=nested', initialValue, mockDate, 'good');
      
      // Update deep nested value
      const partialUpdate = {
        level1: {
          level2: {
            level3: {
              deep: 'updated',
              newProp: 'added'
            }
          }
        }
      };
      hierarchy.updateVariable('nested', partialUpdate, mockDate, 'good');
      
      // Verify deep merge occurred
      const result = hierarchy.getVariable('nested')?.value;
      expect(result).toEqual({
        level1: {
          level2: {
            level3: {
              deep: 'updated',    // Updated
              newProp: 'added',   // Added
              other: 123          // Preserved
            },
            sibling: 'preserved'  // Preserved
          },
          other: 'also preserved' // Preserved
        },
        topLevel: 'maintained'    // Preserved
      });
    });
  });
});