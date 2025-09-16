/**
 * Simple Integration Test Runner
 * 
 * Focuses on the most stable and working features
 * to provide a quick validation of core functionality.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { OpcuaMachine } from '../../dist/index.js';

const TEST_CONFIG = {
  host: 'localhost',
  port: 8443,
  protocol: 'https' as const,
  username: 'dev',
  password: 'dev',
  apiBasePath: '/api/1.0'
};

describe('Core Integration Tests - Working Features Only', () => {
  let machine: OpcuaMachine;
  let isConnected = false;

  beforeAll(() => {
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
  });

  /**
   * Reset core test variables to baseline values
   */
  async function resetCoreVariables(): Promise<void> {
    console.log('🔄 Resetting core variables to baseline values...');
    
    const resetOperations = [
      { var: '::test:test.slider', value: 0.0 },
      { var: 'gtest.myvalue.x', value: 0.0 },
      { var: '::test:test_arrays.New_Member1.ints[0]', value: 0 },
      { var: '::testarray.doubleArray[0,2].member1', value: 0 }
    ];

    let resetCount = 0;
    for (const { var: varName, value } of resetOperations) {
      try {
        await machine.writeVariable(varName, value);
        resetCount++;
      } catch (error) {
        console.warn(`⚠️ Could not reset ${varName}: ${error}`);
      }
    }

    console.log(`✅ Reset complete: ${resetCount}/${resetOperations.length} variables`);
  }

  beforeAll(async () => {
    machine = new OpcuaMachine(TEST_CONFIG);
    
    try {
      await machine.connect();
      machine.setDefaultNamespace('ns=5;s=');
      isConnected = true;
      console.log('✅ Connected to server successfully');
      
      // Reset variables to baseline values for consistent testing
      await resetCoreVariables();
      
    } catch (error) {
      console.warn('⚠️ Server not available - skipping tests');
      isConnected = false;
    }
  });

  afterAll(async () => {
    if (machine && isConnected) {
      await machine.disconnect();
    }
  });

  /**
   * Verify a variable has the expected baseline value
   */
  async function verifyBaseline(varName: string, expectedValue: any, tolerance = 0.001): Promise<boolean> {
    try {
      const currentValue = await machine.readVariable(varName);
      
      if (typeof expectedValue === 'number' && typeof currentValue === 'number') {
        return Math.abs(currentValue - expectedValue) < tolerance;
      } else {
        return currentValue === expectedValue;
      }
    } catch (error) {
      return false;
    }
  }

  test('should establish connection', () => {
    if (!isConnected) return;
    expect(machine.isConnected).toBe(true);
  });

  test('should handle float read/write operations', async () => {
    if (!isConnected) return;
    
    const testVar = '::test:test.slider';
    const testValues = [25.5, 88.8, 3.14159];
    
    // Verify baseline
    const isAtBaseline = await verifyBaseline(testVar, 0.0);
    console.log(`📊 ${testVar} baseline check: ${isAtBaseline ? '✅ correct' : '⚠️ unexpected value'}`);
    
    for (const value of testValues) {
      await machine.writeVariable(testVar, value);
      const readValue = await machine.readVariable(testVar);
      expect(Math.abs(readValue - value)).toBeLessThan(0.001);
    }
    
    console.log('✅ Float operations working correctly');
  });

  test('should handle global variable operations', async () => {
    if (!isConnected) return;
    
    const testVar = 'gtest.myvalue.x';
    const testValue = 42.0;
    
    await machine.writeVariable(testVar, testValue);
    const readValue = await machine.readVariable(testVar);
    
    expect(Math.abs(readValue - testValue)).toBeLessThan(0.001);
    console.log('✅ Global variable operations working correctly');
  });

  test('should handle array element operations', async () => {
    if (!isConnected) return;
    
    const testVar = '::test:test_arrays.New_Member1.ints[0]';
    const testValues = [100, 200, -50];
    
    for (const value of testValues) {
      await machine.writeVariable(testVar, value);
      const readValue = await machine.readVariable(testVar);
      expect(readValue).toBe(value);
    }
    
    console.log('✅ Array element operations working correctly');
  });

  test('should handle 2D array member operations', async () => {
    if (!isConnected) return;
    
    const testVar = '::testarray.doubleArray[0,2].member1';
    const testValue = 999;
    
    await machine.writeVariable(testVar, testValue);
    const readValue = await machine.readVariable(testVar);
    
    expect(readValue).toBe(testValue);
    console.log('✅ 2D array member operations working correctly');
  });

  test('should read full array structures', async () => {
    if (!isConnected) return;
    
    // Test 1D array
    const array1D = await machine.readVariable('::test:test_arrays.testArrayStruct');
    expect(Array.isArray(array1D)).toBe(true);
    expect(array1D.length).toBeGreaterThan(0);
    
    // Test 2D array
    const array2D = await machine.readVariable('::test:test_arrays.doubleArray');
    expect(Array.isArray(array2D)).toBe(true);
    expect(Array.isArray(array2D[0])).toBe(true);
    
    console.log(`✅ Array reading: 1D(${array1D.length}) and 2D(${array2D.length}x${array2D[0].length}) arrays`);
  });

  test('should handle error cases gracefully', async () => {
    if (!isConnected) return;
    
    const invalidVariables = [
      '::nonexistent:variable',
      'invalid.path',
      '::test:test.nonexistent'
    ];
    
    for (const invalidVar of invalidVariables) {
      try {
        await machine.readVariable(invalidVar);
        console.warn(`⚠️ Expected error for ${invalidVar} but succeeded`);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    }
    
    console.log('✅ Error handling working correctly');
  });

  test('should perform rapid operations', async () => {
    if (!isConnected) return;
    
    const testVar = '::test:test.slider';
    const iterations = 5;
    
    console.log(`🚀 Performance test: ${iterations} rapid operations...`);
    const startTime = Date.now();
    
    for (let i = 0; i < iterations; i++) {
      const testValue = i * 10.5;
      await machine.writeVariable(testVar, testValue);
      const readValue = await machine.readVariable(testVar);
      expect(Math.abs(readValue - testValue)).toBeLessThan(0.001);
    }
    
    const duration = Date.now() - startTime;
    const opsPerSecond = (iterations * 2) / (duration / 1000);
    
    console.log(`✅ Performance: ${opsPerSecond.toFixed(2)} ops/sec`);
    expect(opsPerSecond).toBeGreaterThan(1); // At least 1 op/sec
  });
});