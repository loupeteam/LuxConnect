/**
 * Lux.js Style OPC UA Example
 * 
 * This example demonstrates the new lux.js-compatible API that provides:
 * - Direct property access (machine.Temperature)
 * - Automatic subscription management via read groups
 * - Simple setup and configuration
 * - Explicit read/write operations with async/await
 */

import { OpcuaMachine } from '../src/index.js';

async function luxStyleExample() {
  console.log('Starting lux.js style OPC UA example...');

  // Create machine instance (lux.js style)
  const machine = new OpcuaMachine({
    host: 'localhost',
    port: 80,
    username: 'user',
    password: 'pass'
  });

  try {
    // Connect to server
    console.log('Connecting to OPC UA server...');
    await machine.connect();
    console.log('Connected successfully!');

    // Set default namespace for convenience
    machine.setDefaultNamespace('ns=1;s=');

    // Configure default read group (optional - has sensible defaults)
    machine.configureReadGroup('default', {
      publishingInterval: 1000,  // 1 second polling
      enabled: true
    });

    // Add variables to cyclic reading (lux.js style)
    console.log('Setting up cyclic reading...');
    
    // Basic variable addition
    machine.initCyclicRead('Temperature');
    machine.initCyclicRead('Pressure');
    machine.initCyclicRead('MotorSpeed');

    // With callback for immediate change notifications
    machine.initCyclicRead('Status', (value) => {
      console.log(`Status changed to: ${value}`);
    });

    // Add to specific read group with faster polling
    machine.configureReadGroup('fastGroup', {
      publishingInterval: 250,  // 4 times per second
      enabled: true
    });
    
    machine.initCyclicReadGroup('fastGroup', 'CriticalSensor', (value) => {
      console.log(`Critical sensor: ${value}`);
    });

    // Wait a moment for initial values
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Direct property access (lux.js style)
    console.log('\n--- Direct Property Access ---');
    console.log(`Temperature: ${machine.Temperature}`);
    console.log(`Pressure: ${machine.Pressure}`);
    console.log(`Motor Speed: ${machine.MotorSpeed}`);
    console.log(`Status: ${machine.Status}`);

    // Direct property writing (lux.js style)
    console.log('\n--- Direct Property Writing ---');
    machine.Temperature = 25.5;
    machine.MotorSpeed = 1500;
    console.log('Values written via direct property access');

    // Explicit async read/write operations
    console.log('\n--- Explicit Read/Write Operations ---');
    
    // Read with await
    const currentTemp = await machine.readVariable('Temperature');
    console.log(`Current temperature (explicit read): ${currentTemp}`);
    
    // Write with await
    await machine.writeVariable('Pressure', 10.5);
    console.log('Pressure written explicitly');

    // Read variable from different namespace
    const systemVar = await machine.readVariable('SystemTime', { 
      namespace: 'ns=0;i=' 
    });
    console.log(`System time: ${systemVar}`);

    // Set up change handlers
    console.log('\n--- Change Handlers ---');
    machine.onChange('Temperature', (value) => {
      console.log(`Temperature callback: ${value}°C`);
    });

    machine.onChange('Pressure', (value) => {
      console.log(`Pressure callback: ${value} bar`);
    });

    // Simulate some value changes
    console.log('\n--- Simulating Value Changes ---');
    for (let i = 0; i < 5; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const newTemp = 20 + (i * 2);
      machine.Temperature = newTemp;
      console.log(`Set temperature to: ${newTemp}°C`);
    }

    // Read group management
    console.log('\n--- Read Group Management ---');
    
    // Temporarily disable fast group
    machine.setReadGroupEnable('fastGroup', false);
    console.log('Fast group disabled');
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Re-enable with different settings
    machine.configureReadGroup('fastGroup', {
      publishingInterval: 500,  // Slower now
      enabled: true
    });
    console.log('Fast group re-enabled with 500ms interval');

    // Let it run for a bit
    await new Promise(resolve => setTimeout(resolve, 5000));

  } catch (error) {
    console.error('Error during example:', error);
  } finally {
    // Clean disconnect
    console.log('\nDisconnecting...');
    await machine.disconnect();
    console.log('Disconnected');
  }
}

// Run the example
luxStyleExample().catch(console.error);
