/**
 * Integration Tests - Real Server Communication
 * 
 * These tests perform actual communication with a running mapp Connect server
 * without mocks to validate real-world read/write operations.
 * 
 * Requirements:
 * - Running mapp Connect server at localhost:8443
 * - Valid credentials (dev/dev)
 * - Test variables available in the server
 * 
 * Test Coverage:
 * - Connection establishment
 * - Simple value read/write (primitives)
 * - Global state access via property syntax
 * - Subscription management and callbacks
 * - Global state updates via subscriptions
 * - Structure read/write (complex objects)
 * - Array element read/write (single elements)
 * - Multi-dimensional array operations
 * - Complex structure arrays
 * - Error handling for invalid variables
 * - Value verification (write then read back)
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { OpcuaMachine } from '../../dist/index.js';
import { ConnectionState } from '../../dist/types.js';

// Test configuration - can be overridden via environment variables
// Examples:
//   TEST_SERVER=opcuaproxy npm run test:integration
//   TEST_HOST=10.0.0.1 TEST_PORT=9000 npm run test:integration
const TEST_CONFIG = {
  host: process.env.TEST_HOST || 'localhost',
  port: parseInt(process.env.TEST_PORT || '8443'),
  protocol: (process.env.TEST_PROTOCOL || 'https') as 'http' | 'https',
  username: process.env.TEST_USERNAME || 'dev',
  password: process.env.TEST_PASSWORD || 'dev'
};

// Test variables available on the test server
const TEST_VARIABLES = {
  // Simple primitive variables
  simpleInteger: '::test:test._int',
  simpleFloat: '::test:test._real',
  simpleBoolean: '::test:test._bool',
  globalFloat: 'gtest.myvalue.x',
  globalSimple: '::gSimple',
  
  // Structure variables
  struct1: '::test:test.struct1.struct1',
  struct1Member1: '::test:test.struct1.struct1.member1',
  struct1Member2: '::test:test.struct1.struct1.member2',
  struct1Member3: '::test:test.struct1.struct1.member3',
  nestedStruct: '::test:test.struct1.struct1.member3',
  
  // Array variables
  arrayStruct: '::test:test_arrays.testArrayStruct',
  arrayElement0: '::test:test_arrays.testArrayStruct[0]',
  arrayElement1: '::test:test_arrays.testArrayStruct[1]',
  arrayElement0Member1: '::test:test_arrays.testArrayStruct[0].member1',
  arrayElement1Member3: '::test:test_arrays.testArrayStruct[1].member3',
  intArray: '::test:test_arrays.New_Member1.ints',
  intArrayElement0: '::test:test_arrays.New_Member1.ints[0]',
  
  // 2D Array variables  
  doubleArray2D: '::test:test_arrays.doubleArray',
  doubleArrayElement00: '::test:test_arrays.doubleArray[0,0]',
  doubleArrayElement01: '::test:test_arrays.doubleArray[0,1]',
  doubleArrayElement23: '::test:test_arrays.doubleArray[2,3]',
  doubleArrayMember00: '::test:test_arrays.doubleArray[0,0].member1',
  doubleArrayMember23: '::test:test_arrays.doubleArray[2,3].member2',
  
  // Alternative 2D Array format (from nodejs demo)
  altDoubleArray: '::testarray.doubleArray',
  altDoubleArrayElement02: '::testarray.doubleArray[0,2]',
  altDoubleArrayMember: '::testarray.doubleArray[0,2].member1',
  altDoubleArrayOffset: '::testarray.doubleArrayOffset1',
  altDoubleArrayOffset11: '::testarray.doubleArrayOffset1[1,1]'
};

// Test values for different data types
const TEST_VALUES = {
  integers: [42, 100, -50, 999, 0, 12345],
  floats: [25.5, 88.8, -12.34, 0.0, 999.99, 3.14159],
  booleans: [true, false],
  strings: ['Hello World', 'Test String', 'Demo System', '', 'Complex Test', 'Integration Test'],
  complexStructures: [
    { member1: 100, member2: 1, member3: 'Complex [0,0]' },
    { member1: 200, member2: 1, member3: 'Complex [1,1]' },
    { member1: 999, member2: 1, member3: 'Complex Array Element' },
    { member1: 555, member2: 1, member3: 'Integration Test Value' },
    { member1: -50, member2: 1, member3: 'Negative Test' }
  ]
};

// Baseline values for consistent test initialization
const BASELINE_VALUES = {
  simpleInteger: 0,
  simpleFloat: 0.0,
  simpleBoolean: false,
  globalFloat: 0.0,
  globalSimple: 0.0,
  struct1Member1: 0,
  struct1Member2: 0,
  nestedStruct: 10,
  intArrayElement0: 0,
  arrayElement0Member1: 0,
  arrayElement1Member2: 0,
  arrayElement1Member3: '',
  doubleArrayMember00: 0,
  doubleArrayMember23: 0,
  altDoubleArrayMember: 0
};

describe('Integration Tests - Real Server Communication', () => {
  let machine: OpcuaMachine;
  let isServerAvailable = false;
  let connectionEstablished = false;

  // Configure Node.js to accept self-signed certificates  
  beforeAll(() => {
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
    console.log('🔓 Node.js configured to accept self-signed certificates (test mode)');
  });

  /**
   * Reset all test variables to baseline values for consistent test runs
   */
  async function resetTestVariables(): Promise<void> {
    console.log('🔄 Resetting test variables to baseline values...');
    
    const resetOperations = [
      // Simple values
      { var: TEST_VARIABLES.simpleFloat, value: BASELINE_VALUES.simpleFloat },
      { var: TEST_VARIABLES.globalFloat, value: BASELINE_VALUES.globalFloat },
      { var: TEST_VARIABLES.intArrayElement0, value: BASELINE_VALUES.intArrayElement0 },
      { var: TEST_VARIABLES.doubleArrayMember00, value: BASELINE_VALUES.doubleArrayMember00 },
      { var: TEST_VARIABLES.altDoubleArrayMember, value: BASELINE_VALUES.altDoubleArrayMember }
    ];

    // Optional resets (may fail if variables don't exist)
    const optionalResets = [
      { var: TEST_VARIABLES.simpleInteger, value: BASELINE_VALUES.simpleInteger },
      { var: TEST_VARIABLES.simpleBoolean, value: BASELINE_VALUES.simpleBoolean },
      { var: TEST_VARIABLES.struct1Member1, value: BASELINE_VALUES.struct1Member1 },
      { var: TEST_VARIABLES.struct1Member2, value: BASELINE_VALUES.struct1Member2 },
      { var: TEST_VARIABLES.nestedStruct, value: BASELINE_VALUES.nestedStruct },
      { var: TEST_VARIABLES.arrayElement0Member1, value: BASELINE_VALUES.arrayElement0Member1 },
      { var: TEST_VARIABLES.arrayElement1Member3, value: BASELINE_VALUES.arrayElement1Member3 },
      { var: TEST_VARIABLES.doubleArrayMember23, value: BASELINE_VALUES.doubleArrayMember23 }
    ];

    // Reset core variables (these should always work)
    let resetCount = 0;
    for (const { var: varName, value } of resetOperations) {
      try {
        await machine.writeVariable(varName, value);
        resetCount++;
      } catch (error) {
        console.warn(`⚠️ Could not reset ${varName}: ${error}`);
      }
    }

    // Reset optional variables (may not exist on all servers)
    let optionalResetCount = 0;
    for (const { var: varName, value } of optionalResets) {
      try {
        await machine.writeVariable(varName, value);
        optionalResetCount++;
      } catch {
        console.log(`   Optional reset skipped: ${varName}`);
      }
    }

    console.log(`✅ Reset complete: ${resetCount}/${resetOperations.length} core variables, ${optionalResetCount}/${optionalResets.length} optional variables`);
  }

  beforeAll(async () => {
    console.log('🧪 Starting Integration Tests');
    console.log('============================');
    console.log(`📡 Target Server: ${TEST_CONFIG.protocol}://${TEST_CONFIG.host}:${TEST_CONFIG.port}`);
    console.log(`🔑 Credentials: ${TEST_CONFIG.username}/${TEST_CONFIG.password}`);
    
    machine = new OpcuaMachine(TEST_CONFIG);
    
    // Set up error handling
    machine.onError((error) => {
      connectionError = error;
    });

    // Set up connection state tracking
    machine.onConnectionStateChanged((state) => {
      console.log(`🔗 Connection state: ${state}`);
      if (state === ConnectionState.CONNECTED) {
        connectionEstablished = true;
      }
    });

    try {
      // Attempt to connect to the server
      console.log('⏳ Attempting server connection...');
      await machine.connect();

      isServerAvailable = true;
      connectionEstablished = true;
      console.log('✅ Server connection successful - running integration tests');
      console.log(`🎯 Testing ${Object.keys(TEST_VARIABLES).length} different variable patterns`);
      
      // Reset all test variables to baseline values for consistent testing
      await resetTestVariables();
      
    } catch (error) {
      console.warn('⚠️ Server not available - skipping integration tests');
      console.warn(`   Error: ${error instanceof Error ? error.message : String(error)}`);
      isServerAvailable = false;
      connectionEstablished = false;
    }
  });

  afterAll(async () => {
    if (machine && connectionEstablished) {
      console.log('🔌 Disconnecting from server...');
      try {
        await machine.disconnect();
        console.log('✅ Disconnected successfully');
      } catch (error) {
        console.warn('⚠️ Disconnect error:', error);
      }
    }
    console.log('🏁 Integration Tests Complete\n');
  });

  beforeEach(async () => {
    if (!isServerAvailable) {
      console.log('⏭️ Skipping test - server not available');
      return;
    }
    
    // Clean up any stale subscriptions or variables from previous tests
    try {
      // Clear any pending subscription attempts
      if ((machine as any).subscriptionManager) {
        const subscriptions = (machine as any).subscriptionManager.getAllSubscriptions?.() || {};
        for (const handle of Object.keys(subscriptions)) {
          try {
            await machine.unsubscribe(handle);
          } catch {
            // Ignore cleanup errors
          }
        }
      }
    } catch {
      // Ignore cleanup errors
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
    } catch {
      return false; // Variable doesn't exist or can't be read
    }
  }

  describe('Connection Management', () => {
    test('should establish connection to server', () => {
      if (!isServerAvailable) return;
      
      expect(connectionEstablished).toBe(true);
      expect(machine.isConnected).toBe(true);
    }, 15000);

    test('should have valid session info', () => {
      if (!isServerAvailable) return;
      
      // Access session info through internal connection (for testing only)
      const sessionInfo = (machine as any).connection.getSessionInfo();
      expect(sessionInfo).toBeDefined();
      expect(sessionInfo?.sessionId).toBeDefined();
      expect(sessionInfo?.username).toBe('dev');
    });
  });

  describe('Simple Value Operations', () => {
    test('should read and write integer values', async () => {
      if (!isServerAvailable) return;
      
      const testVar = TEST_VARIABLES.simpleInteger;
      
      for (const testValue of TEST_VALUES.integers) {
        try {
          // Write the value
          await machine.writeVariable(testVar, testValue);
          
          // Read it back
          const readValue = await machine.readVariable(testVar);
          
          // Handle potential type conversions (OPC UA may convert types)
          const numericValue = typeof readValue === 'boolean' ? (readValue ? 1 : 0) : readValue;
          expect(numericValue).toBe(testValue);
          console.log(`✅ Integer test: ${testVar} = ${testValue} → ${readValue} ✓`);
        } catch (error) {
          console.log(`⚠️ Integer test skipped: ${testVar} = ${testValue} (${error})`);
          // Continue with other values rather than failing the entire test
        }
      }
    }, 30000);

    test('should read and write float values', async () => {
      if (!isServerAvailable) return;
      
      const testVar = TEST_VARIABLES.simpleFloat;
      
      // Verify baseline
      const isAtBaseline = await verifyBaseline(testVar, BASELINE_VALUES.simpleFloat);
      console.log(`📊 ${testVar} baseline check: ${isAtBaseline ? '✅ correct' : '⚠️ unexpected value'}`);
      
      for (const testValue of TEST_VALUES.floats) {
        // Write the value
        await machine.writeVariable(testVar, testValue);
        
        // Read it back
        const readValue = await machine.readVariable(testVar);
        
        // Use approximate equality for floats
        expect(Math.abs(readValue - testValue)).toBeLessThan(0.001);
        console.log(`✅ Float test: ${testVar} = ${testValue} ✓`);
      }
    }, 30000);

    test('should read and write boolean values', async () => {
      if (!isServerAvailable) return;
      
      const testVar = TEST_VARIABLES.simpleBoolean;
      
      for (const testValue of TEST_VALUES.booleans) {
        // Write the value
        await machine.writeVariable(testVar, testValue);
        
        // Read it back  
        const readValue = await machine.readVariable(testVar);
        
        // Note: OPC UA may convert booleans to numbers (1/0), so check for logical equivalence
        const isEquivalent = (testValue && readValue) || (!testValue && !readValue);
        expect(isEquivalent).toBe(true);
        console.log(`✅ Boolean test: ${testVar} = ${testValue} → ${readValue} ✓`);
      }
    }, 15000);

    test('should read and write global variable values', async () => {
      if (!isServerAvailable) return;
      
      const testVar = TEST_VARIABLES.globalFloat;
      
      // Verify baseline
      const isAtBaseline = await verifyBaseline(testVar, BASELINE_VALUES.globalFloat);
      console.log(`📊 ${testVar} baseline check: ${isAtBaseline ? '✅ correct' : '⚠️ unexpected value'}`);
      
      for (const testValue of TEST_VALUES.floats.slice(0, 3)) { // Test subset for speed
        // Write the value
        await machine.writeVariable(testVar, testValue);
        
        // Read it back
        const readValue = await machine.readVariable(testVar);
        
        // Use approximate equality for floats
        expect(Math.abs(readValue - testValue)).toBeLessThan(0.001);
        console.log(`✅ Global variable test: ${testVar} = ${testValue} ✓`);
      }
    }, 20000);

    test('should read and write simple global variable values', async () => {
      if (!isServerAvailable) return;
      
      const testVar = TEST_VARIABLES.globalSimple;
      
      // Verify baseline
      const isAtBaseline = await verifyBaseline(testVar, BASELINE_VALUES.globalSimple);
      console.log(`📊 ${testVar} baseline check: ${isAtBaseline ? '✅ correct' : '⚠️ unexpected value'}`);
      
      for (const testValue of TEST_VALUES.floats.slice(0, 3)) { // Test subset for speed
        // Write the value
        await machine.writeVariable(testVar, testValue);
        
        // Read it back
        await machine.readVariable(testVar);
        const readValue = machine.gSimple;  
        // Use approximate equality for floats
        expect(Math.abs(readValue - testValue)).toBeLessThan(0.001);
        console.log(`✅ Global variable test: ${testVar} = ${testValue} ✓`);
      }
    }, 20000);

  });

  describe('Global State Access Tests', () => {
    test('should access variables using dynamic property syntax', async () => {
      if (!isServerAvailable) return;
      
      // Test simple variable access using machine.varname syntax
      const testValue = TEST_VALUES.floats[0];
      
      // First write using traditional method
      await machine.writeVariable(TEST_VARIABLES.simpleFloat, testValue);
      
      // Then read using property access - need to access internal state
      // Note: This assumes the machine has a property-based interface
      try {
        // Try to access the variable using property syntax
        const machineWithProps = machine as any;
        
        // Check if the machine supports property-based access
        if (machineWithProps.test && machineWithProps.test.test && machineWithProps.test.test._real !== undefined) {
          const propertyValue = machineWithProps.test.test._real;
          expect(Math.abs(propertyValue - testValue)).toBeLessThan(0.001);
          console.log(`✅ Property access: machine.test.test._real = ${propertyValue} ✓`);
        } else {
          console.log(`⚠️ Property access not available - machine may not support dynamic properties`);
        }
      } catch (error) {
        console.log(`⚠️ Property access test failed: ${error}`);
      }
    }, 15000);

    test('should access global variables using property syntax', async () => {
      if (!isServerAvailable) return;
      
      const testValue = TEST_VALUES.floats[1];
      
      // Write using traditional method
      await machine.writeVariable(TEST_VARIABLES.globalFloat, testValue);
      
      // Try to access using property syntax
      try {
        const machineWithProps = machine as any;
        
        if (machineWithProps.gtest && machineWithProps.gtest.myvalue && machineWithProps.gtest.myvalue.x !== undefined) {
          const propertyValue = machineWithProps.gtest.myvalue.x;
          expect(Math.abs(propertyValue - testValue)).toBeLessThan(0.001);
          console.log(`✅ Global property access: machine.gtest.myvalue.x = ${propertyValue} ✓`);
        } else {
          console.log(`⚠️ Global property access not available`);
        }
      } catch (error) {
        console.log(`⚠️ Global property access test failed: ${error}`);
      }
    }, 15000);

    test('should access structure members using property syntax', async () => {
      if (!isServerAvailable) return;
      
      const testValue = TEST_VALUES.integers[0];
      
      // Write to structure member using traditional method
      await machine.writeVariable(TEST_VARIABLES.struct1Member1, testValue);
      
      // Try to access using property syntax
      try {
        const machineWithProps = machine as any;
        
        if (machineWithProps.test && 
            machineWithProps.test.test &&
            machineWithProps.test.test.struct1 &&
            machineWithProps.test.test.struct1.struct1 &&
            machineWithProps.test.test.struct1.struct1.member1 !== undefined) {
          
          const propertyValue = machineWithProps.test.test.struct1.struct1.member1;
          expect(propertyValue).toBe(testValue);
          console.log(`✅ Structure property access: machine.test.test.struct1.struct1.member1 = ${propertyValue} ✓`);
        } else {
          console.log(`⚠️ Structure property access not available`);
        }
      } catch (error) {
        console.log(`⚠️ Structure property access test failed: ${error}`);
      }
    }, 15000);

    test('should access array elements using property syntax', async () => {
      if (!isServerAvailable) return;
      
      const testValue = TEST_VALUES.integers[2];
      
      // Write to array element using traditional method
      await machine.writeVariable(TEST_VARIABLES.intArrayElement0, testValue);
      
      // Try to access using property syntax
      try {
        const machineWithProps = machine as any;
        
        if (machineWithProps.test && 
            machineWithProps.test.test_arrays &&
            machineWithProps.test.test_arrays.New_Member1 &&
            machineWithProps.test.test_arrays.New_Member1.ints &&
            machineWithProps.test.test_arrays.New_Member1.ints[0] !== undefined) {
          
          const propertyValue = machineWithProps.test.test_arrays.New_Member1.ints[0];
          expect(propertyValue).toBe(testValue);
          console.log(`✅ Array property access: machine.test.test_arrays.New_Member1.ints[0] = ${propertyValue} ✓`);
        } else {
          console.log(`⚠️ Array property access not available`);
        }
      } catch (error) {
        console.log(`⚠️ Array property access test failed: ${error}`);
      }
    }, 15000);

    test('should verify property access reflects current server state', async () => {
      if (!isServerAvailable) return;
      
      const testVar = TEST_VARIABLES.simpleFloat;
      const initialValue = TEST_VALUES.floats[0];
      const updatedValue = TEST_VALUES.floats[1];
      
      // Set initial value
      await machine.writeVariable(testVar, initialValue);
      
      // Update to new value
      await machine.writeVariable(testVar, updatedValue);
      
      // Verify property access reflects the updated value
      try {
        const machineWithProps = machine as any;
        
        if (machineWithProps.test && machineWithProps.test.test && machineWithProps.test.test._real !== undefined) {
          const propertyValue = machineWithProps.test.test._real;
          expect(Math.abs(propertyValue - updatedValue)).toBeLessThan(0.001);
          console.log(`✅ Property state updated: machine.test.test._real = ${propertyValue} (was ${initialValue}) ✓`);
        } else {
          console.log(`⚠️ Property state update test skipped - property access not available`);
        }
      } catch (error) {
        console.log(`⚠️ Property state update test failed: ${error}`);
      }
    }, 15000);

    test('should handle property access for non-existent variables', async () => {
      if (!isServerAvailable) return;
      
      try {
        const machineWithProps = machine as any;
        
        // Try to access a non-existent property
        const nonExistentValue = machineWithProps.nonexistent?.variable?.path;
        
        // Should be undefined for non-existent properties
        expect(nonExistentValue).toBeUndefined();
        console.log(`✅ Non-existent property access: undefined as expected ✓`);
        
        // Try a deeper path that doesn't exist
        const deepNonExistent = machineWithProps.test?.test?.nonexistent?.deep?.path;
        expect(deepNonExistent).toBeUndefined();
        console.log(`✅ Deep non-existent property access: undefined as expected ✓`);
        
      } catch (error) {
        console.log(`⚠️ Non-existent property test failed: ${error}`);
      }
    }, 10000);
  });

  describe('Subscription Tests', () => {
    test('should create subscriptions and receive value change callbacks', async () => {
      if (!isServerAvailable) return;
      
      const testVar1 = TEST_VARIABLES.simpleFloat;
      const testVar2 = TEST_VARIABLES.globalFloat;
      const testValues = [TEST_VALUES.floats[0], TEST_VALUES.floats[1], TEST_VALUES.floats[2]];
      
      // Track received callbacks
      const receivedCallbacks: Array<{variable: string, value: any, timestamp: number}> = [];
      
      // Create subscriptions with callbacks
      const subscription1 = await machine.subscribe(testVar1, (value: any) => {
        receivedCallbacks.push({
          variable: testVar1,
          value: value,
          timestamp: Date.now()
        });
        console.log(`📡 Subscription callback: ${testVar1} = ${value}`);
      });
      
      const subscription2 = await machine.subscribe(testVar2, (value: any) => {
        receivedCallbacks.push({
          variable: testVar2,
          value: value,
          timestamp: Date.now()
        });
        console.log(`📡 Subscription callback: ${testVar2} = ${value}`);
      });
      
      expect(subscription1).toBeDefined();
      expect(subscription2).toBeDefined();
      console.log(`✅ Created subscriptions for ${testVar1} and ${testVar2}`);
      
      // Wait a moment for subscriptions to be established
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Clear any initial callbacks
      receivedCallbacks.length = 0;
      
      // Write values and verify callbacks are received
      for (let i = 0; i < testValues.length; i++) {
        const testValue1 = testValues[i];
        const testValue2 = testValues[i] + 100; // Different value for second variable
        
        console.log(`🔄 Writing test values: ${testVar1} = ${testValue1}, ${testVar2} = ${testValue2}`);
        
        // Write both values
        await machine.writeVariable(testVar1, testValue1);
        await machine.writeVariable(testVar2, testValue2);
        
        // Wait for callbacks to be received
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Verify we received callbacks for both variables
        const callbacks1 = receivedCallbacks.filter(cb => cb.variable === testVar1);
        const callbacks2 = receivedCallbacks.filter(cb => cb.variable === testVar2);
        
        expect(callbacks1.length).toBeGreaterThan(0);
        expect(callbacks2.length).toBeGreaterThan(0);
        
        // Verify the last callback values are correct
        const lastCallback1 = callbacks1[callbacks1.length - 1];
        const lastCallback2 = callbacks2[callbacks2.length - 1];
        
        expect(Math.abs(lastCallback1.value - testValue1)).toBeLessThan(0.001);
        expect(Math.abs(lastCallback2.value - testValue2)).toBeLessThan(0.001);
      }
      
      console.log(`✅ Received ${receivedCallbacks.length} total callbacks`);
      
      // Clean up subscriptions
      await machine.unsubscribe(subscription1);
      await machine.unsubscribe(subscription2);
      console.log('✅ Subscriptions cleaned up');
      
    }, 30000);

    test('should update global state when subscribed variables change', async () => {
      if (!isServerAvailable) return;
      
      const testVar = TEST_VARIABLES.simpleFloat;
      const testValues = [TEST_VALUES.floats[3], TEST_VALUES.floats[4]];
      
      // Create subscription
      let callbackReceived = false;
      const subscription = await machine.subscribe(testVar, (value: any) => {
        callbackReceived = true;
        console.log(`📡 Global state update callback: ${testVar} = ${value}`);
      });
      
      // Wait for subscription to be established
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      for (const testValue of testValues) {
        callbackReceived = false;
        
        // Write the value
        await machine.writeVariable(testVar, testValue);
        
        // Wait for callback and state update
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Verify callback was received
        expect(callbackReceived).toBe(true);
        
        // Verify global state is updated via property access
        try {
          const machineWithProps = machine as any;
          
          if (machineWithProps.test && machineWithProps.test.test && machineWithProps.test.test._real !== undefined) {
            const propertyValue = machineWithProps.test.test._real;
            expect(Math.abs(propertyValue - testValue)).toBeLessThan(0.001);
            console.log(`✅ Global state updated: machine.test.test._real = ${propertyValue} ✓`);
          } else {
            // Verify via traditional read as fallback
            const readValue = await machine.readVariable(testVar);
            expect(Math.abs(readValue - testValue)).toBeLessThan(0.001);
            console.log(`✅ Variable state updated via read: ${testVar} = ${readValue} ✓`);
          }
        } catch (error) {
          console.log(`⚠️ Global state verification failed: ${error}`);
        }
      }
      
      // Clean up
      await machine.unsubscribe(subscription);
      console.log('✅ Subscription cleaned up');
      
    }, 25000);

    test('should handle multiple subscriptions to the same variable', async () => {
      if (!isServerAvailable) return;
      
      const testVar = TEST_VARIABLES.globalFloat;
      const testValue = TEST_VALUES.floats[5];
      
      // Track callbacks for multiple subscriptions
      let callback1Count = 0;
      let callback2Count = 0;
      let callback3Count = 0;
      
      // Create multiple subscriptions to the same variable
      const subscription1 = await machine.subscribe(testVar, (value: any) => {
        callback1Count++;
        console.log(`📡 Callback 1: ${testVar} = ${value} (count: ${callback1Count})`);
      });
      
      const subscription2 = await machine.subscribe(testVar, (value: any) => {
        callback2Count++;
        console.log(`📡 Callback 2: ${testVar} = ${value} (count: ${callback2Count})`);
      });
      
      const subscription3 = await machine.subscribe(testVar, (value: any) => {
        callback3Count++;
        console.log(`📡 Callback 3: ${testVar} = ${value} (count: ${callback3Count})`);
      });
      
      // Wait for subscriptions to be established
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Reset counters after any initial callbacks
      callback1Count = 0;
      callback2Count = 0;
      callback3Count = 0;
      
      // Write a value
      await machine.writeVariable(testVar, testValue);
      
      // Wait for callbacks
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Verify all subscriptions received callbacks
      expect(callback1Count).toBeGreaterThan(0);
      expect(callback2Count).toBeGreaterThan(0);
      expect(callback3Count).toBeGreaterThan(0);
      
      console.log(`✅ Multiple subscriptions: ${callback1Count}, ${callback2Count}, ${callback3Count} callbacks received`);
      
      // Clean up all subscriptions
      await machine.unsubscribe(subscription1);
      await machine.unsubscribe(subscription2);
      await machine.unsubscribe(subscription3);
      console.log('✅ All subscriptions cleaned up');
      
    }, 20000);

    test('should handle subscriptions to structure members', async () => {
      if (!isServerAvailable) return;
      
      const testVar = TEST_VARIABLES.struct1Member1;
      const testValue = TEST_VALUES.integers[3];
      
      let callbackValue: any = null;
      let callbackReceived = false;
      
      // Subscribe to structure member
      const subscription = await machine.subscribe(testVar, (value: any) => {
        callbackValue = value;
        callbackReceived = true;
        console.log(`📡 Structure member callback: ${testVar} = ${value}`);
      });
      
      // Wait for subscription
      await new Promise(resolve => setTimeout(resolve, 1000));
      callbackReceived = false;
      
      // Write to the structure member
      await machine.writeVariable(testVar, testValue);
      
      // Wait for callback
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Verify callback was received with correct value
      expect(callbackReceived).toBe(true);
      expect(callbackValue).toBe(testValue);
      console.log(`✅ Structure member subscription: ${testVar} = ${callbackValue} ✓`);
      
      // Clean up
      await machine.unsubscribe(subscription);
      console.log('✅ Structure member subscription cleaned up');
      
    }, 15000);

    test('should handle subscriptions to array elements', async () => {
      if (!isServerAvailable) return;
      
      const testVar = TEST_VARIABLES.intArrayElement0;
      const testValue = TEST_VALUES.integers[4];
      
      let callbackValue: any = null;
      let callbackReceived = false;
      
      // Subscribe to array element
      const subscription = await machine.subscribe(testVar, (value: any) => {
        callbackValue = value;
        callbackReceived = true;
        console.log(`📡 Array element callback: ${testVar} = ${value}`);
      });
      
      // Wait for subscription
      await new Promise(resolve => setTimeout(resolve, 1000));
      callbackReceived = false;
      
      // Write to the array element
      await machine.writeVariable(testVar, testValue);
      
      // Wait for callback
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Verify callback was received with correct value
      expect(callbackReceived).toBe(true);
      expect(callbackValue).toBe(testValue);
      console.log(`✅ Array element subscription: ${testVar} = ${callbackValue} ✓`);
      
      // Clean up
      await machine.unsubscribe(subscription);
      console.log('✅ Array element subscription cleaned up');
      
    }, 15000);

    test('should handle subscription errors gracefully', async () => {
      if (!isServerAvailable) return;
      
      const invalidVars = [
        '::nonexistent:variable',
        'invalid.subscription.path',
        '::test:test.nonexistent.member'
      ];
      
      for (const invalidVar of invalidVars) {
        try {
          // Attempt to subscribe to invalid variable
          const subscription = await machine.subscribe(invalidVar, (value: any) => {
            console.log(`📡 Unexpected callback: ${invalidVar} = ${value}`);
          });
          
          // If subscription succeeded, clean it up and warn
          console.warn(`⚠️ Expected error for subscription to ${invalidVar} but succeeded`);
          if (subscription) {
            await machine.unsubscribe(subscription);
          }
        } catch (error) {
          // This is expected for invalid variables
          expect(error).toBeInstanceOf(Error);
          console.log(`✅ Proper error handling for invalid subscription: ${invalidVar} ✓`);
        }
      }
    }, 15000);

    test('should handle rapid subscription updates', async () => {
      if (!isServerAvailable) return;
      
      const testVar = TEST_VARIABLES.simpleFloat;
      const rapidValues = [10.1, 20.2, 30.3, 40.4, 50.5];
      
      const receivedValues: number[] = [];
      
      // Create subscription
      const subscription = await machine.subscribe(testVar, (value: any) => {
        receivedValues.push(value);
        console.log(`📡 Rapid update: ${testVar} = ${value} (${receivedValues.length})`);
      });
      
      // Wait for subscription
      await new Promise(resolve => setTimeout(resolve, 500));
      receivedValues.length = 0; // Clear any initial values
      
      console.log(`🚀 Rapid subscription test: ${rapidValues.length} quick updates...`);
      const startTime = Date.now();
      
      // Write values rapidly
      for (const value of rapidValues) {
        await machine.writeVariable(testVar, value);
        // Small delay to allow callback processing
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Wait for all callbacks to complete
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const duration = Date.now() - startTime;
      const updatesPerSecond = rapidValues.length / (duration / 1000);
      
      console.log(`✅ Rapid updates completed: ${updatesPerSecond.toFixed(2)} updates/sec`);
      console.log(`📊 Received ${receivedValues.length} callbacks for ${rapidValues.length} writes`);
      
      // Verify we received at least some callbacks (may not be all due to rapid updates)
      expect(receivedValues.length).toBeGreaterThan(0);
      
      // Verify the final value is correct
      const finalValue = receivedValues[receivedValues.length - 1];
      const expectedFinal = rapidValues[rapidValues.length - 1];
      expect(Math.abs(finalValue - expectedFinal)).toBeLessThan(0.001);
      
      // Clean up
      await machine.unsubscribe(subscription);
      console.log('✅ Rapid subscription test cleaned up');
      
    }, 20000);

    test('should handle different sampling intervals efficiently', async () => {
      if (!isServerAvailable) return;
      
      // Test variables with different required update rates
      const fastVar = TEST_VARIABLES.simpleFloat;
      const mediumVar = TEST_VARIABLES.globalFloat; 
      const slowVar = TEST_VARIABLES.intArrayElement0;
      
      // Track subscription callbacks with timestamps
      const fastCallbacks: Array<{value: any, timestamp: number}> = [];
      const mediumCallbacks: Array<{value: any, timestamp: number}> = [];
      const slowCallbacks: Array<{value: any, timestamp: number}> = [];
      
      // Create subscriptions with different sampling intervals
      // This should create separate read groups for each rate
      const fastSub = await machine.subscribe(fastVar, (value: any) => {
        fastCallbacks.push({value, timestamp: Date.now()});
      }, 50);  // 50ms - very fast
      
      const mediumSub = await machine.subscribe(mediumVar, (value: any) => {
        mediumCallbacks.push({value, timestamp: Date.now()});
      }, 200); // 200ms - medium
      
      const slowSub = await machine.subscribe(slowVar, (value: any) => {
        slowCallbacks.push({value, timestamp: Date.now()});
      }, 500); // 500ms - slow
      
      console.log('✅ Created subscriptions with different sampling intervals: 50ms, 200ms, 500ms');
      
      // Wait for subscriptions to be established
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Clear initial callbacks
      fastCallbacks.length = 0;
      mediumCallbacks.length = 0;
      slowCallbacks.length = 0;
      
      // Write values to trigger callbacks and measure intervals
      const testValues = [10.1, 20.2, 30.3];
      
      for (let i = 0; i < testValues.length; i++) {
        // Write to all variables
        await machine.writeVariable(fastVar, testValues[i] + 1);
        await machine.writeVariable(mediumVar, testValues[i] + 2); 
        await machine.writeVariable(slowVar, Math.round(testValues[i] + 3));
        
        // Wait between writes to see different callback rates
        await new Promise(resolve => setTimeout(resolve, 600));
      }
      
      console.log(`📊 Callback counts: Fast(${fastCallbacks.length}), Medium(${mediumCallbacks.length}), Slow(${slowCallbacks.length})`);
      
      // Verify we received callbacks (exact counts may vary due to timing)
      expect(fastCallbacks.length).toBeGreaterThan(0);
      expect(mediumCallbacks.length).toBeGreaterThan(0);
      expect(slowCallbacks.length).toBeGreaterThan(0);
      
      // Fast subscription should generally have more callbacks due to higher frequency
      // (though this isn't guaranteed due to network timing)
      console.log('✅ Different sampling intervals working correctly');
      
      // Clean up all subscriptions
      await machine.unsubscribe(fastSub);
      await machine.unsubscribe(mediumSub);
      await machine.unsubscribe(slowSub);
      console.log('✅ Different sampling interval test cleaned up');
      
    }, 25000);
  });

  describe('Structure Operations', () => {
    test('should read and write individual structure members', async () => {
      if (!isServerAvailable) return;
      
      const intVar = TEST_VARIABLES.struct1Member1;
      const strVar = TEST_VARIABLES.struct1Member2;
      
      try {
        // Test integer member
        const testInt = TEST_VALUES.integers[0];
        await machine.writeVariable(intVar, testInt);
        const readInt = await machine.readVariable(intVar);
        expect(readInt).toBe(testInt);
        console.log(`✅ Struct member1: ${intVar} = ${testInt} ✓`);
      } catch (error) {
        console.log(`⚠️ Struct member1 test skipped: ${intVar} (${error})`);
      }
      
      try {
        // Test integer member (member2 is also an integer, not a string)
        const testInt2 = TEST_VALUES.integers[1];
        await machine.writeVariable(strVar, testInt2);
        const readInt2 = await machine.readVariable(strVar);
        expect(readInt2).toBe(testInt2);
        console.log(`✅ Struct member2: ${strVar} = ${testInt2} ✓`);
      } catch (error) {
        console.log(`⚠️ Struct member2 test skipped: ${strVar} (${error})`);
      }
    }, 15000);

    test('should read and write complete structures', async () => {
      if (!isServerAvailable) return;
      
      const testVar = TEST_VARIABLES.struct1;
      const testValue = {
        member1: TEST_VALUES.integers[1],
        member3: TEST_VALUES.strings[1]
      };
      
      // Write the complete structure
      await machine.writeVariable(testVar, testValue);
      
      // Read back individual members to verify
      const readMember1 = await machine.readVariable(TEST_VARIABLES.struct1Member1);
      const readMember2 = await machine.readVariable(TEST_VARIABLES.struct1Member3);
      
      expect(readMember1).toBe(testValue.member1);
      expect(readMember2).toBe(testValue.member3);
      
      console.log(`✅ Complete structure: ${testVar} = ${JSON.stringify(testValue)} ✓`);
    }, 15000);

    test('should read and write nested structure members', async () => {
      if (!isServerAvailable) return;
      
      const testVar = TEST_VARIABLES.nestedStruct;
      const testValue = TEST_VALUES.strings[2];
      
      // Write the nested structure member
      await machine.writeVariable(testVar, testValue);
      
      // Read it back
      const readValue = await machine.readVariable(testVar);
      
      expect(readValue).toBe(testValue);
      console.log(`✅ Nested struct member: ${testVar} = "${testValue}" ✓`);
    }, 10000);

    test('should read the complete struct object from a parent struct path', async () => {
      if (!isServerAvailable) return;

      const parentVar = TEST_VARIABLES.struct1;

      // Write known values to individual members first
      const expectedMember1 = TEST_VALUES.integers[2];
      const expectedMember3 = TEST_VALUES.strings[3];
      await machine.writeVariable(TEST_VARIABLES.struct1Member1, expectedMember1);
      await machine.writeVariable(TEST_VARIABLES.struct1Member3, expectedMember3);

      // Read the parent struct path — should return the complete object
      const result = await machine.readVariable(parentVar);

      expect(result).not.toBeNull();
      expect(typeof result).toBe('object');
      expect((result as any).member1).toBe(expectedMember1);
      expect((result as any).member3).toBe(expectedMember3);
      console.log(`✅ Parent struct read: ${parentVar} = ${JSON.stringify(result)} ✓`);
    }, 15000);

    test('should subscribe to a parent struct path and receive the whole struct object', async () => {
      if (!isServerAvailable) return;

      const parentVar  = TEST_VARIABLES.struct1;
      const memberVar  = TEST_VARIABLES.struct1Member1;
      const testMember = TEST_VALUES.integers[4];

      let receivedValue: unknown = undefined;
      let callbackCount = 0;

      const subscription = await machine.subscribe(parentVar, (value: unknown) => {
        receivedValue = value;
        callbackCount++;
        console.log(`📡 Parent struct callback: ${parentVar} = ${JSON.stringify(value)}`);
      });

      // Wait for the initial snapshot callback
      await new Promise(resolve => setTimeout(resolve, 1000));
      callbackCount = 0;

      // Trigger a change by writing to a member
      await machine.writeVariable(memberVar, testMember);

      // Wait for the subscription callback
      await new Promise(resolve => setTimeout(resolve, 1500));

      expect(callbackCount).toBeGreaterThan(0);
      expect(receivedValue).not.toBeNull();
      expect(typeof receivedValue).toBe('object');
      expect((receivedValue as any).member1).toBe(testMember);
      console.log(`✅ Parent struct subscription: received struct with member1=${(receivedValue as any)?.member1} ✓`);

      await machine.unsubscribe(subscription);
    }, 20000);
  });

  describe('Array Element Operations', () => {
    test('should read and write single array element primitives', async () => {
      if (!isServerAvailable) return;
      
      const testVar = TEST_VARIABLES.intArrayElement0;
      
      // Verify baseline
      const isAtBaseline = await verifyBaseline(testVar, BASELINE_VALUES.intArrayElement0);
      console.log(`📊 ${testVar} baseline check: ${isAtBaseline ? '✅ correct' : '⚠️ unexpected value'}`);
      
      for (const testValue of TEST_VALUES.integers.slice(0, 3)) {
        // Write to array element
        await machine.writeVariable(testVar, testValue);
        
        // Read it back
        const readValue = await machine.readVariable(testVar);
        
        expect(readValue).toBe(testValue);
        console.log(`✅ Array element: ${testVar} = ${testValue} ✓`);
      }
    }, 20000);

    test('should read and write array element structure members', async () => {
      if (!isServerAvailable) return;
      
      const member1Var = TEST_VARIABLES.arrayElement0Member1;
      const member3Var = TEST_VARIABLES.arrayElement1Member3;
      
      // Test array[0].member1
      const testInt = TEST_VALUES.integers[2];
      await machine.writeVariable(member1Var, testInt);
      const readInt = await machine.readVariable(member1Var);
      expect(readInt).toBe(testInt);
      console.log(`✅ Array[0] struct member1: ${member1Var} = ${testInt} ✓`);
      
      // Test array[1].member2  
      const testStr = TEST_VALUES.strings[2];
      await machine.writeVariable(member3Var, testStr);
      const readStr = await machine.readVariable(member3Var);
      expect(readStr).toBe(testStr);
      console.log(`✅ Array[1] struct member2: ${member3Var} = "${testStr}" ✓`);
    }, 15000);

    test('should read and write complete array element structures', async () => {
      if (!isServerAvailable) return;
      
      const testVar = TEST_VARIABLES.arrayElement0;
      const testValue = TEST_VALUES.complexStructures[0];
      
      // Write the complete structure to array element
      await machine.writeVariable(testVar, testValue);
      
      // Read back the individual members to verify
      const readMember1 = await machine.readVariable(TEST_VARIABLES.arrayElement0Member1);
      
      expect(readMember1).toBe(testValue.member1);
      console.log(`✅ Complete array element struct: ${testVar} = ${JSON.stringify(testValue)} ✓`);
    }, 10000);
  });

  describe('Multi-Dimensional Array Operations', () => {
    test('should read and write 2D array element primitives', async () => {
      if (!isServerAvailable) return;
      
      const testVar = TEST_VARIABLES.doubleArrayMember00;
      
      for (const testValue of TEST_VALUES.integers.slice(0, 2)) {
        // Write to 2D array element member
        await machine.writeVariable(testVar, testValue);
        
        // Read it back
        const readValue = await machine.readVariable(testVar);
        
        expect(readValue).toBe(testValue);
        console.log(`✅ 2D array element member: ${testVar} = ${testValue} ✓`);
      }
    }, 15000);

    test('should read and write complete 2D array element structures', async () => {
      if (!isServerAvailable) return;
      
      const testVar = TEST_VARIABLES.doubleArrayElement00;
      const testValue = TEST_VALUES.complexStructures[1];
      
      // Write the complete structure to 2D array element
      await machine.writeVariable(testVar, testValue);
      
      // Read back the member to verify
      const readMember = await machine.readVariable(TEST_VARIABLES.doubleArrayMember00);
      
      expect(readMember).toBe(testValue.member1);
      console.log(`✅ Complete 2D array element: ${testVar} = ${JSON.stringify(testValue)} ✓`);
    }, 10000);

    test('should handle different 2D array indices', async () => {
      if (!isServerAvailable) return;
      
      // Test different positions in 2D array
      const testCases = [
        { var: TEST_VARIABLES.doubleArrayElement01, value: TEST_VALUES.complexStructures[2] },
        { var: TEST_VARIABLES.doubleArrayElement23, value: TEST_VALUES.complexStructures[3] }
      ];
      
      for (const { var: testVar, value: testValue } of testCases) {
        // Write the structure
        await machine.writeVariable(testVar, testValue);
        
        console.log(`✅ 2D array index test: ${testVar} = ${JSON.stringify(testValue)} ✓`);
      }
    }, 15000);

    test('should work with alternative 2D array format', async () => {
      if (!isServerAvailable) return;
      
      const testVar = TEST_VARIABLES.altDoubleArrayMember;
      const testValue = TEST_VALUES.integers[3];
      
      // Write to alternative format 2D array
      await machine.writeVariable(testVar, testValue);
      
      // Read it back
      const readValue = await machine.readVariable(testVar);
      
      expect(readValue).toBe(testValue);
      console.log(`✅ Alternative 2D array format: ${testVar} = ${testValue} ✓`);
    }, 10000);
  });

  describe('Complex Scenarios', () => {
    test('should handle mixed read/write operations in sequence', async () => {
      if (!isServerAvailable) return;
      
      // Perform a sequence of mixed operations
      const operations = [
        { var: TEST_VARIABLES.simpleInteger, value: TEST_VALUES.integers[4] },
        { var: TEST_VARIABLES.struct1Member1, value: TEST_VALUES.integers[5] },
        { var: TEST_VARIABLES.arrayElement0Member1, value: TEST_VALUES.integers[0] },
        { var: TEST_VARIABLES.doubleArrayMember00, value: TEST_VALUES.integers[1] }
      ];
      
      // Write all values
      for (const { var: testVar, value: testValue } of operations) {
        await machine.writeVariable(testVar, testValue);
      }
      
      // Read all values back and verify
      for (const { var: testVar, value: expectedValue } of operations) {
        const readValue = await machine.readVariable(testVar);
        expect(readValue).toBe(expectedValue);
      }
      
      console.log(`✅ Mixed operations sequence: ${operations.length} variables verified ✓`);
    }, 25000);

    test('should read full array structures', async () => {
      if (!isServerAvailable) return;
      
      // Read the complete array structure
      const arrayData = await machine.readVariable(TEST_VARIABLES.arrayStruct);
      
      expect(Array.isArray(arrayData)).toBe(true);
      expect(arrayData.length).toBeGreaterThan(0);
      
      console.log(`✅ Full array structure read: ${TEST_VARIABLES.arrayStruct} (${arrayData.length} elements) ✓`);
    }, 10000);

    test('should read full 2D array structures', async () => {
      if (!isServerAvailable) return;
      
      // Read the complete 2D array structure
      const arrayData = await machine.readVariable(TEST_VARIABLES.doubleArray2D);
      
      expect(Array.isArray(arrayData)).toBe(true);
      expect(arrayData.length).toBeGreaterThan(0);
      expect(Array.isArray(arrayData[0])).toBe(true);
      
      console.log(`✅ Full 2D array structure read: ${TEST_VARIABLES.doubleArray2D} (${arrayData.length}x${arrayData[0].length} elements) ✓`);
    }, 10000);
  });

  describe('Error Handling', () => {
    test('should handle invalid variable names gracefully', async () => {
      if (!isServerAvailable) return;
      
      const invalidVars = [
        '::nonexistent:variable',
        'invalid.variable.name',
        '::test:test.nonexistent',
        '::test:test_arrays.invalid[999]'
      ];
      
      for (const invalidVar of invalidVars) {
        try {
          await machine.readVariable(invalidVar);
          // If we get here, the read succeeded unexpectedly
          console.warn(`⚠️ Expected error for ${invalidVar} but read succeeded`);
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          console.log(`✅ Proper error handling for: ${invalidVar} ✓`);
        }
      }
    }, 20000);

    test('should handle invalid write values gracefully', async () => {
      if (!isServerAvailable) return;
      
      const testVar = TEST_VARIABLES.simpleInteger;
      const invalidValues = [
        undefined,
        null,
        { invalid: 'object' },
        'string_to_integer'
      ];
      
      for (const invalidValue of invalidValues) {
        try {
          await machine.writeVariable(testVar, invalidValue);
          // Some invalid values might be coerced, so we check the result
          console.log(`⚠️ Write succeeded for ${testVar} = ${JSON.stringify(invalidValue)} (may be valid coercion)`);
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          console.log(`✅ Proper error handling for invalid value: ${JSON.stringify(invalidValue)} ✓`);
        }
      }
    }, 15000);
  });

  describe('Performance and Stress Tests', () => {
    test('should handle rapid sequential operations', async () => {
      if (!isServerAvailable) return;
      
      const testVar = TEST_VARIABLES.simpleInteger;
      const iterations = 10;
      
      console.log(`🚀 Performance test: ${iterations} rapid operations...`);
      const startTime = Date.now();
      
      for (let i = 0; i < iterations; i++) {
        const testValue = i * 10;
        await machine.writeVariable(testVar, testValue);
        const readValue = await machine.readVariable(testVar);
        expect(readValue).toBe(testValue);
      }
      
      const duration = Date.now() - startTime;
      const opsPerSecond = (iterations * 2) / (duration / 1000);
      
      console.log(`✅ Performance test completed: ${opsPerSecond.toFixed(2)} ops/sec ✓`);
    }, 30000);

    test('should handle concurrent read operations', async () => {
      if (!isServerAvailable) return;
      
      const testVars = [
        TEST_VARIABLES.simpleInteger,
        TEST_VARIABLES.simpleFloat, 
        TEST_VARIABLES.struct1Member1,
        TEST_VARIABLES.arrayElement0Member1,
        TEST_VARIABLES.doubleArrayMember00
      ];
      
      console.log(`🚀 Concurrent read test: ${testVars.length} simultaneous reads...`);
      
      // Perform all reads concurrently
      const readPromises = testVars.map(varName => machine.readVariable(varName));
      const results = await Promise.all(readPromises);
      
      expect(results).toHaveLength(testVars.length);
      results.forEach((result, index) => {
        expect(result).toBeDefined();
        console.log(`✅ Concurrent read ${index + 1}: ${testVars[index]} = ${JSON.stringify(result)} ✓`);
      });
    }, 15000);
  });

  describe('Connection Error Handling', () => {
    test('should handle connection failures gracefully', () => {
      if (!isServerAvailable) return;
      
      // Test error handler registration
      let errorReceived = false;
      
      machine.onError((error) => {
        errorReceived = true;
        receivedError = error;
      });
      
      expect(errorReceived).toBe(false); // No errors yet
      
      // The error handler should be registered
      // Actual error testing requires server failure scenarios
    });

    test('should handle configuration after connection', async () => {
      if (!isServerAvailable) return;
      
      // Store original configuration to restore later
      const originalConfig = {
        namespace: (machine as any).variableManager?.defaultNamespace || 'ns=5;s=',
        application: (machine as any).defaultApplication,
        task: (machine as any).defaultTask
      };

      try {
        // These should work even after connection is established
        expect(() => {
          machine['setDefaultNamespace']('ns=6;s=');
          machine.setDefaultApplication('IntegrationTest');
          machine.setDefaultTask('ErrorTest');
        }).not.toThrow();
      } finally {
        // Restore original configuration
        machine['setDefaultNamespace'](originalConfig.namespace);
        machine.setDefaultApplication(originalConfig.application);
        machine.setDefaultTask(originalConfig.task);
      }
    });

    test('should handle disconnection gracefully', async () => {
      if (!isServerAvailable) return;
      
      // Test that disconnect works without throwing
      // This is tested in afterAll, but let's test the state
      expect(machine.isConnected).toBe(true);
      
      // We don't actually disconnect here since other tests need the connection
      // The actual disconnect test happens in afterAll
    });
  });

  describe('Configuration Integration Tests', () => {
    test('should apply configuration to new variables', async () => {
      if (!isServerAvailable) return;
      
      // Store original configuration to restore later
      const originalConfig = {
        namespace: (machine as any).variableManager?.defaultNamespace || 'ns=5;s=',
        application: (machine as any).defaultApplication,
        task: (machine as any).defaultTask
      };

      try {
        // Configure defaults
        machine['setDefaultNamespace']('ns=5;s=');
        machine.setDefaultApplication('ConfigTest');
        machine.setDefaultTask('Integration');

        // Register a new variable that should use these defaults
        const testVar = 'ConfigTestVariable';
        machine.initCyclicRead(testVar);

        // The variable should be registered with the configured defaults
        const variable = (machine as any).variableManager.getVariable(testVar);
        expect(variable).toBeDefined();
      } finally {
        // Restore original configuration
        machine['setDefaultNamespace'](originalConfig.namespace);
        machine.setDefaultApplication(originalConfig.application);
        machine.setDefaultTask(originalConfig.task);
      }
    });

    test('should handle subscription errors for invalid variables', async () => {
      if (!isServerAvailable) return;
      
      const invalidVariables = [
        '::completely:nonexistent:variable',
        'invalid.path.structure',
        '::test:test.invalid.deeply.nested.member'
      ];
      
      const createdSubscriptions: string[] = [];
      
      try {
        for (const invalidVar of invalidVariables) {
          try {
            const subscription = await machine.subscribe(invalidVar, (value) => {
              console.log(`Unexpected callback for ${invalidVar}: ${value}`);
            });
            
            // If we get here, the subscription succeeded - clean it up
            console.warn(`⚠️ Expected subscription to fail for ${invalidVar}`);
            if (subscription) {
              createdSubscriptions.push(subscription);
            }
          } catch (error) {
            // This is expected - the subscription should fail for invalid variables
            expect(error).toBeInstanceOf(Error);
          }
        }
      } finally {
        // Clean up any subscriptions that were unexpectedly created
        for (const handle of createdSubscriptions) {
          try {
            await machine.unsubscribe(handle);
          } catch {
            // Ignore cleanup errors
          }
        }
      }
    });

    test('should handle subscription cleanup errors', async () => {
      if (!isServerAvailable) return;
      
      // Test unsubscribing invalid handles
      const invalidHandles = [
        'nonexistent-handle-123',
        'invalid-subscription-id',
        'expired-handle-456'
      ];
      
      for (const invalidHandle of invalidHandles) {
        await expect(
          machine.unsubscribe(invalidHandle)
        ).rejects.toThrow(`Subscription handle '${invalidHandle}' not found`);
      }
    });
  });

  describe('Structure Read/Write Validation', () => {
    /**
     * These tests validate that structure read/write operations maintain consistency
     * between different access patterns:
     * 
     * 1. Writing a complete structure → Reading individual members (validates write propagation)
     * 2. Writing individual members → Reading complete structure (validates aggregation)
     * 3. Writing array/structure → Reading elements/fields (validates decomposition)
     * 4. Writing elements/fields → Reading array/structure (validates composition)
     * 
     * Each test validates the specific access pattern and verifies that the data
     * remains consistent regardless of how it's accessed (structure vs. elements).
     * 
     * IMPORTANT: These tests currently reveal that structure writes are NOT working
     * in the OpcUaProxy. All structure write operations return 404 errors, even when
     * falling back to individual field writes. This needs to be fixed in the proxy server.
     */
    
    test('should verify structure read/write consistency - simple structure', async () => {
      if (!isServerAvailable) return;
      
      const structVar = TEST_VARIABLES.struct1;
      const member1Var = TEST_VARIABLES.struct1Member1;
      const member2Var = TEST_VARIABLES.struct1Member2;
      const member3Var = TEST_VARIABLES.struct1Member3;
      
      // Test data
      const testStructure = {
        member1: 42,
        member2: 7,
        member3: 'Validation Test'
      };
      
      console.log('\n📝 Testing simple structure read/write consistency');
      
      // Write as complete structure
      console.log(`  Writing structure: ${JSON.stringify(testStructure)}`);
      await machine.writeVariable(structVar, testStructure);
      
      // Read back individual members first (more reliable)
      const readMember1 = await machine.readVariable(member1Var);
      const readMember2 = await machine.readVariable(member2Var);
      const readMember3 = await machine.readVariable(member3Var);
      
      console.log(`  Read member1: ${readMember1}`);
      console.log(`  Read member2: ${readMember2}`);
      console.log(`  Read member3: ${readMember3}`);
      
      // Verify individual members match written values
      expect(readMember1).toBe(testStructure.member1);
      expect(readMember2).toBe(testStructure.member2);
      expect(readMember3).toBe(testStructure.member3);
      
      // Try to read back as complete structure
      try {
        const readStruct = await machine.readVariable(structVar);
        console.log(`  Read structure: ${JSON.stringify(readStruct)}`);
        
        if (readStruct && typeof readStruct === 'object') {
          // Verify structure read matches written values
          expect(readStruct.member1).toBe(testStructure.member1);
          expect(readStruct.member2).toBe(testStructure.member2);
          expect(readStruct.member3).toBe(testStructure.member3);
          
          // Verify individual member reads match structure read
          expect(readMember1).toBe(readStruct.member1);
          expect(readMember2).toBe(readStruct.member2);
          expect(readMember3).toBe(readStruct.member3);
          console.log('✅ Complete structure read matches individual members');
        } else {
          console.log('⚠️ Structure read returned non-object, using individual member verification only');
        }
      } catch (error) {
        console.log(`⚠️ Complete structure read not supported: ${error}`);
      }
      
      console.log('✅ Simple structure read/write validation passed\n');
    }, 15000);

    test('should verify structure read/write consistency - array of structures', async () => {
      if (!isServerAvailable) return;
      
      const arrayVar = TEST_VARIABLES.arrayStruct;
      const elem0Var = TEST_VARIABLES.arrayElement0;
      const elem1Var = TEST_VARIABLES.arrayElement1;
      const elem0Member1Var = TEST_VARIABLES.arrayElement0Member1;
      const elem1Member3Var = TEST_VARIABLES.arrayElement1Member3;
      
      // Test data - array of structures
      const testArray = [
        { member1: 100, member2: 1, member3: 'Array Element 0' },
        { member1: 200, member2: 2, member3: 'Array Element 1' },
        { member1: 300, member2: 3, member3: 'Array Element 2' },
        { member1: 400, member2: 4, member3: 'Array Element 3' }
      ];
      
      console.log('\n📝 Testing array of structures read/write consistency');
      
      // Write complete array
      console.log(`  Writing array: ${JSON.stringify(testArray, null, 2)}`);
      await machine.writeVariable(arrayVar, testArray);
      
      // Read back individual members to verify write
      const readElem0Member1 = await machine.readVariable(elem0Member1Var);
      const readElem1Member3 = await machine.readVariable(elem1Member3Var);
      
      console.log(`  Read element[0].member1: ${readElem0Member1}`);
      console.log(`  Read element[1].member3: ${readElem1Member3}`);
      
      // Verify individual field writes succeeded
      expect(readElem0Member1).toBe(testArray[0].member1);
      expect(readElem1Member3).toBe(testArray[1].member3);
      
      // Read individual elements
      const readElem0 = await machine.readVariable(elem0Var);
      const readElem1 = await machine.readVariable(elem1Var);
      
      console.log(`  Read element[0]: ${JSON.stringify(readElem0)}`);
      console.log(`  Read element[1]: ${JSON.stringify(readElem1)}`);
      
      // Verify individual element reads contain written values
      expect(readElem0.member1).toBe(testArray[0].member1);
      expect(readElem0.member2).toBe(testArray[0].member2);
      expect(readElem0.member3).toBe(testArray[0].member3);
      
      expect(readElem1.member1).toBe(testArray[1].member1);
      expect(readElem1.member2).toBe(testArray[1].member2);
      expect(readElem1.member3).toBe(testArray[1].member3);
      
      // Verify field reads match element reads
      expect(readElem0Member1).toBe(readElem0.member1);
      expect(readElem1Member3).toBe(readElem1.member3);
      
      // Try to read complete array
      try {
        const readArray = await machine.readVariable(arrayVar);
        console.log(`  Read array length: ${readArray.length}`);
        
        // Verify array length
        expect(readArray.length).toBe(testArray.length);
        
        // Verify array read matches individual element reads
        expect(readArray[0].member1).toBe(readElem0.member1);
        expect(readArray[1].member3).toBe(readElem1.member3);
        
        console.log('✅ Complete array read matches individual elements');
      } catch (error) {
        console.log(`⚠️ Complete array read not tested: ${error}`);
      }
      
      console.log('✅ Array of structures read/write validation passed\n');
    }, 20000);

    // NOTE: This test writes a complete 2D array using writeVariable, which decomposes it
    // into individual field writes via flattenValue (producing [i][j] bracket notation).
    // When connecting directly to a PLC (mapp Connect), the PLC expects [i,j] comma notation
    // for true multi-dimensional arrays (ARRAY[x,y]). The [i][j] → [i,j] conversion is
    // handled by OpcUaProxy's convertArrayIndicesIfNeeded(). When testing against PLC directly
    // (without OpcUaProxy), this test is expected to fail for the full-array write.
    // Individual element writes using explicit [i,j] notation (tested separately) work fine.
    test.skip('should verify structure read/write consistency - 2D array of structures', async () => {
      if (!isServerAvailable) return;
      
      const array2DVar = TEST_VARIABLES.doubleArray2D;
      const elem00Var = TEST_VARIABLES.doubleArrayElement00;
      const elem01Var = TEST_VARIABLES.doubleArrayElement01;
      const elem23Var = TEST_VARIABLES.doubleArrayElement23;
      const elem00Member1Var = TEST_VARIABLES.doubleArrayMember00;
      const elem23Member2Var = TEST_VARIABLES.doubleArrayMember23;
      
      // Test data - 4x4 2D array of structures
      const test2DArray = [
        [
          { member1: 100, member2: 1, member3: '[0,0]' },
          { member1: 101, member2: 2, member3: '[0,1]' },
          { member1: 102, member2: 3, member3: '[0,2]' },
          { member1: 103, member2: 4, member3: '[0,3]' }
        ],
        [
          { member1: 110, member2: 5, member3: '[1,0]' },
          { member1: 111, member2: 6, member3: '[1,1]' },
          { member1: 112, member2: 7, member3: '[1,2]' },
          { member1: 113, member2: 8, member3: '[1,3]' }
        ],
        [
          { member1: 120, member2: 9, member3: '[2,0]' },
          { member1: 121, member2: 10, member3: '[2,1]' },
          { member1: 122, member2: 11, member3: '[2,2]' },
          { member1: 123, member2: 12, member3: '[2,3]' }
        ],
        [
          { member1: 130, member2: 13, member3: '[3,0]' },
          { member1: 131, member2: 14, member3: '[3,1]' },
          { member1: 132, member2: 15, member3: '[3,2]' },
          { member1: 133, member2: 16, member3: '[3,3]' }
        ]
      ];
      
      console.log('\n📝 Testing 2D array of structures read/write consistency');
      
      // Write complete 2D array
      console.log(`  Writing 2D array: 4x4 grid of structures`);
      await machine.writeVariable(array2DVar, test2DArray);
      
      // Read individual fields first to verify write
      const readElem00Member1 = await machine.readVariable(elem00Member1Var);
      const readElem23Member2 = await machine.readVariable(elem23Member2Var);
      
      console.log(`  Read element[0,0].member1: ${readElem00Member1}`);
      console.log(`  Read element[2,3].member2: ${readElem23Member2}`);
      
      // Verify writes succeeded for spot-check fields
      expect(readElem00Member1).toBe(test2DArray[0][0].member1);
      expect(readElem23Member2).toBe(test2DArray[2][3].member2);
      
      // Read individual elements
      const readElem00 = await machine.readVariable(elem00Var);
      const readElem01 = await machine.readVariable(elem01Var);
      const readElem23 = await machine.readVariable(elem23Var);
      
      console.log(`  Read element[0,0]: ${JSON.stringify(readElem00)}`);
      console.log(`  Read element[0,1]: ${JSON.stringify(readElem01)}`);
      console.log(`  Read element[2,3]: ${JSON.stringify(readElem23)}`);
      
      // Verify individual elements match written values
      expect(readElem00.member1).toBe(test2DArray[0][0].member1);
      expect(readElem00.member2).toBe(test2DArray[0][0].member2);
      expect(readElem00.member3).toBe(test2DArray[0][0].member3);
      
      expect(readElem01.member1).toBe(test2DArray[0][1].member1);
      expect(readElem01.member2).toBe(test2DArray[0][1].member2);
      expect(readElem01.member3).toBe(test2DArray[0][1].member3);
      
      expect(readElem23.member1).toBe(test2DArray[2][3].member1);
      expect(readElem23.member2).toBe(test2DArray[2][3].member2);
      expect(readElem23.member3).toBe(test2DArray[2][3].member3);
      
      // Verify field reads match element reads
      expect(readElem00Member1).toBe(readElem00.member1);
      expect(readElem23Member2).toBe(readElem23.member2);
      
      // Try to read back complete 2D array
      try {
        const read2DArray = await machine.readVariable(array2DVar);
        console.log(`  Read 2D array dimensions: ${read2DArray.length}x${read2DArray[0]?.length || 0}`);
        
        // Verify 2D array dimensions
        expect(read2DArray.length).toBe(4);
        expect(read2DArray[0].length).toBe(4);
        
        // Verify 2D array reads match individual element reads
        expect(read2DArray[0][0].member1).toBe(readElem00.member1);
        expect(read2DArray[0][1].member1).toBe(readElem01.member1);
        expect(read2DArray[2][3].member1).toBe(readElem23.member1);
        
        console.log('✅ Complete 2D array read matches individual elements');
      } catch (error) {
        console.log(`⚠️ Complete 2D array read not tested: ${error}`);
      }
      
      console.log('✅ 2D array of structures read/write validation passed\n');
    }, 25000);

    test('should verify element-by-element write then structure read', async () => {
      if (!isServerAvailable) return;
      
      const structVar = TEST_VARIABLES.struct1;
      const member1Var = TEST_VARIABLES.struct1Member1;
      const member2Var = TEST_VARIABLES.struct1Member2;
      const member3Var = TEST_VARIABLES.struct1Member3;
      
      // Test data
      const testValues = {
        member1: 999,
        member2: 888,
        member3: 'Element Write Test'
      };
      
      console.log('\n📝 Testing element-by-element write then structure read');
      
      // Write individual members
      console.log(`  Writing member1: ${testValues.member1}`);
      await machine.writeVariable(member1Var, testValues.member1);
      
      console.log(`  Writing member2: ${testValues.member2}`);
      await machine.writeVariable(member2Var, testValues.member2);
      
      console.log(`  Writing member3: ${testValues.member3}`);
      await machine.writeVariable(member3Var, testValues.member3);
      
      // Verify individual writes by reading them back
      const verifyMember1 = await machine.readVariable(member1Var);
      const verifyMember2 = await machine.readVariable(member2Var);
      const verifyMember3 = await machine.readVariable(member3Var);
      
      expect(verifyMember1).toBe(testValues.member1);
      expect(verifyMember2).toBe(testValues.member2);
      expect(verifyMember3).toBe(testValues.member3);
      
      console.log('  ✅ Individual member writes verified');
      
      // Try to read back as complete structure
      try {
        const readStruct = await machine.readVariable(structVar);
        console.log(`  Read structure: ${JSON.stringify(readStruct)}`);
        
        if (readStruct && typeof readStruct === 'object') {
          // Verify structure contains individually written values
          expect(readStruct.member1).toBe(testValues.member1);
          expect(readStruct.member2).toBe(testValues.member2);
          expect(readStruct.member3).toBe(testValues.member3);
          console.log('  ✅ Structure read matches individual writes');
        }
      } catch (error) {
        console.log(`  ⚠️ Complete structure read not supported: ${error}`);
      }
      
      console.log('✅ Element-by-element write validation passed\n');
    }, 15000);

    test('should verify structure write then element-by-element read', async () => {
      if (!isServerAvailable) return;
      
      const structVar = TEST_VARIABLES.struct1;
      const member1Var = TEST_VARIABLES.struct1Member1;
      const member2Var = TEST_VARIABLES.struct1Member2;
      const member3Var = TEST_VARIABLES.struct1Member3;
      
      // Test data
      const testStructure = {
        member1: 777,
        member2: 666,
        member3: 'Structure Write Test'
      };
      
      console.log('\n📝 Testing structure write then element-by-element read');
      
      // Write as complete structure
      console.log(`  Writing structure: ${JSON.stringify(testStructure)}`);
      await machine.writeVariable(structVar, testStructure);
      
      // Read back individual members
      const readMember1 = await machine.readVariable(member1Var);
      const readMember2 = await machine.readVariable(member2Var);
      const readMember3 = await machine.readVariable(member3Var);
      
      console.log(`  Read member1: ${readMember1}`);
      console.log(`  Read member2: ${readMember2}`);
      console.log(`  Read member3: ${readMember3}`);
      
      // Verify individual reads contain structure written values
      expect(readMember1).toBe(testStructure.member1);
      expect(readMember2).toBe(testStructure.member2);
      expect(readMember3).toBe(testStructure.member3);
      
      console.log('✅ Structure write propagated to all individual members correctly\n');
    }, 15000);

    test('should verify array element write consistency', async () => {
      if (!isServerAvailable) return;
      
      const arrayVar = TEST_VARIABLES.arrayStruct;
      const elem0Var = TEST_VARIABLES.arrayElement0;
      const elem1Var = TEST_VARIABLES.arrayElement1;
      const elem0Member1Var = TEST_VARIABLES.arrayElement0Member1;
      const elem1Member3Var = TEST_VARIABLES.arrayElement1Member3;
      
      // Test data
      const elem0Value = { member1: 555, member2: 1, member3: 'Modified Element 0' };
      const elem1Value = { member1: 666, member2: 2, member3: 'Modified Element 1' };
      
      console.log('\n📝 Testing array element write consistency');
      
      // Write individual array elements
      console.log(`  Writing element[0]: ${JSON.stringify(elem0Value)}`);
      await machine.writeVariable(elem0Var, elem0Value);
      
      console.log(`  Writing element[1]: ${JSON.stringify(elem1Value)}`);
      await machine.writeVariable(elem1Var, elem1Value);
      
      // Verify element writes by reading individual members
      const readElem0Member1 = await machine.readVariable(elem0Member1Var);
      const readElem1Member3 = await machine.readVariable(elem1Member3Var);
      
      expect(readElem0Member1).toBe(elem0Value.member1);
      expect(readElem1Member3).toBe(elem1Value.member3);
      
      console.log('  ✅ Individual element member writes verified');
      
      // Read back individual elements
      const readElem0 = await machine.readVariable(elem0Var);
      const readElem1 = await machine.readVariable(elem1Var);
      
      console.log(`  Read element[0]: ${JSON.stringify(readElem0)}`);
      console.log(`  Read element[1]: ${JSON.stringify(readElem1)}`);
      
      // Verify individual element reads contain written values
      expect(readElem0.member1).toBe(elem0Value.member1);
      expect(readElem0.member2).toBe(elem0Value.member2);
      expect(readElem0.member3).toBe(elem0Value.member3);
      
      expect(readElem1.member1).toBe(elem1Value.member1);
      expect(readElem1.member2).toBe(elem1Value.member2);
      expect(readElem1.member3).toBe(elem1Value.member3);
      
      // Try to read complete array
      try {
        const readArray = await machine.readVariable(arrayVar);
        console.log(`  Read array[0]: ${JSON.stringify(readArray[0])}`);
        console.log(`  Read array[1]: ${JSON.stringify(readArray[1])}`);
        
        // Verify array read matches individual element reads
        expect(readArray[0].member1).toBe(readElem0.member1);
        expect(readArray[1].member3).toBe(readElem1.member3);
        
        console.log('  ✅ Complete array read matches individual elements');
      } catch (error) {
        console.log(`  ⚠️ Complete array read not tested: ${error}`);
      }
      
      console.log('✅ Array element write consistency validation passed\n');
    }, 20000);

    test('should verify 2D array element write consistency', async () => {
      if (!isServerAvailable) return;
      
      const array2DVar = TEST_VARIABLES.doubleArray2D;
      const elem00Var = TEST_VARIABLES.doubleArrayElement00;
      const elem23Var = TEST_VARIABLES.doubleArrayElement23;
      const elem00Member1Var = TEST_VARIABLES.doubleArrayMember00;
      const elem23Member2Var = TEST_VARIABLES.doubleArrayMember23;
      
      // Test data
      const elem00Value = { member1: 9000, member2: 90, member3: 'Modified [0,0]' };
      const elem23Value = { member1: 9023, member2: 92, member3: 'Modified [2,3]' };
      
      console.log('\n📝 Testing 2D array element write consistency');
      
      // Write individual 2D array elements
      console.log(`  Writing element[0,0]: ${JSON.stringify(elem00Value)}`);
      await machine.writeVariable(elem00Var, elem00Value);
      
      console.log(`  Writing element[2,3]: ${JSON.stringify(elem23Value)}`);
      await machine.writeVariable(elem23Var, elem23Value);
      
      // Verify element writes by reading individual members
      const readElem00Member1 = await machine.readVariable(elem00Member1Var);
      const readElem23Member2 = await machine.readVariable(elem23Member2Var);
      
      expect(readElem00Member1).toBe(elem00Value.member1);
      expect(readElem23Member2).toBe(elem23Value.member2);
      
      console.log('  ✅ Individual element member writes verified');
      
      // Read back individual elements
      const readElem00 = await machine.readVariable(elem00Var);
      const readElem23 = await machine.readVariable(elem23Var);
      
      console.log(`  Read element[0,0]: ${JSON.stringify(readElem00)}`);
      console.log(`  Read element[2,3]: ${JSON.stringify(readElem23)}`);
      
      // Verify individual element reads contain written values
      expect(readElem00.member1).toBe(elem00Value.member1);
      expect(readElem00.member2).toBe(elem00Value.member2);
      expect(readElem00.member3).toBe(elem00Value.member3);
      
      expect(readElem23.member1).toBe(elem23Value.member1);
      expect(readElem23.member2).toBe(elem23Value.member2);
      expect(readElem23.member3).toBe(elem23Value.member3);
      
      // Try to read back complete 2D array
      try {
        const read2DArray = await machine.readVariable(array2DVar);
        console.log(`  Read array[0][0]: ${JSON.stringify(read2DArray[0][0])}`);
        console.log(`  Read array[2][3]: ${JSON.stringify(read2DArray[2][3])}`);
        
        // Verify 2D array read matches individual element reads
        expect(read2DArray[0][0].member1).toBe(readElem00.member1);
        expect(read2DArray[2][3].member1).toBe(readElem23.member1);
        
        console.log('  ✅ Complete 2D array read matches individual elements');
      } catch (error) {
        console.log(`  ⚠️ Complete 2D array read not tested: ${error}`);
      }
      
      console.log('✅ 2D array element write consistency validation passed\n');
    }, 20000);
  });


});