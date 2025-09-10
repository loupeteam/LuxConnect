/**
 * Basic Usage Example - lux-opcua Library
 * 
 * This example demonstrates the main features of lux-opcua using the new
 * lux.js-style API (OpcuaMachine) which provides:
 * - Direct property access (machine.Temperature)
 * - Automatic subscription management via read groups
 * - Simple setup with familiar lux.js patterns
 * - Additional explicit read/write operations for advanced control
 */

import { 
  OpcuaMachine,
  ConnectionConfig, 
  ConnectionState
} from '../src/index.js';

// Extend Window interface for debugging
declare global {
  interface Window {
    machine?: OpcuaMachine;
  }
}

async function basicUsageExample() {
  console.log('🚀 Basic lux-opcua Usage Example');
  console.log('=================================\n');

  // Configuration for mapp Connect server
  const config: ConnectionConfig = {
    host: 'localhost',
    port: 80,
    username: 'user',           // Required for mapp Connect
    password: 'pass'            // Required for mapp Connect
  };

  // Create the OPC UA machine (lux.js style)
  const machine = new OpcuaMachine(config);
  window.machine = machine; // Expose for debugging in browser console
  try {
    // Set up event handlers
    machine.onConnectionStateChanged((state: ConnectionState) => {
      console.log(`🔗 Connection state: ${state}`);
    });

    machine.onError((error: Error) => {
      console.error(`❌ Error: ${error.message}`);
    });

    // Connect to the server
    console.log('📡 Connecting to OPC UA server...');
    await machine.connect();
    console.log('✅ Connected successfully!\n');

    // Set default namespace for convenience
    machine.setDefaultNamespace('ns=1;s=');
    console.log('⚙️  Default namespace set to: ns=1;s=\n');

    // ===========================================
    // BASIC VARIABLE SETUP (lux.js style)
    // ===========================================
    
    console.log('📊 Setting up basic variable monitoring...');
    
    // Add variables to automatic cyclic reading (lux.js style)
    machine.initCyclicRead('Temperature');
    machine.initCyclicRead('Pressure');
    machine.initCyclicRead('Status');
    
    console.log('✅ Variables added to cyclic reading\n');

    // ===========================================
    // CHANGE CALLBACKS
    // ===========================================
    
    console.log('🔔 Setting up change callbacks...');
    
    // Set up change handlers for specific variables
    machine.onChange('Temperature', (value) => {
      console.log(`🌡️  Temperature changed: ${value}°C`);
    });

    machine.onChange('Pressure', (value) => {
      console.log(`📊 Pressure changed: ${value} bar`);
    });

    machine.onChange('Status', (value) => {
      console.log(`📢 Status changed: ${value}`);
    });
    
    console.log('✅ Change callbacks configured\n');

    // Wait a moment for initial subscription setup
    console.log('⏳ Waiting for initial values...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // ===========================================
    // DIRECT PROPERTY ACCESS (lux.js style)
    // ===========================================
    
    console.log('🎯 Testing direct property access (lux.js style)...');
    
    try {
      // Read values using direct property access
      console.log(`   Temperature: ${(machine as any).Temperature}`);
      console.log(`   Pressure: ${(machine as any).Pressure}`);
      console.log(`   Status: ${(machine as any).Status}`);
    } catch (error) {
      console.log('   ⚠️  Some variables may not be available for direct access');
    }
    
    console.log();

    // ===========================================
    // EXPLICIT READ/WRITE OPERATIONS
    // ===========================================
    
    console.log('📖 Testing explicit read operations...');
    
    try {
      const temp = await machine.readVariable('Temperature');
      console.log(`   Temperature (explicit read): ${temp}°C`);
    } catch (error) {
      console.log(`   ⚠️  Temperature read failed: ${error.message}`);
    }

    try {
      const pressure = await machine.readVariable('Pressure');
      console.log(`   Pressure (explicit read): ${pressure} bar`);
    } catch (error) {
      console.log(`   ⚠️  Pressure read failed: ${error.message}`);
    }

    console.log('\n✏️  Testing write operations...');
    
    try {
      await machine.writeVariable('Temperature', 25.5);
      console.log('   ✅ Temperature written: 25.5°C');
    } catch (error) {
      console.log(`   ⚠️  Temperature write failed: ${error.message}`);
    }

    // Also test direct property writing (lux.js style)
    try {
      (machine as any).Pressure = 10.5;
      console.log('   ✅ Pressure set via direct property: 10.5 bar');
    } catch (error) {
      console.log(`   ⚠️  Pressure direct write failed: ${error.message}`);
    }

    // ===========================================
    // READ GROUP MANAGEMENT
    // ===========================================
    
    console.log('\n🏃 Testing read group management...');
    
    // Configure a fast read group for critical variables
    machine.configureReadGroup('critical', {
      publishingInterval: 250,  // 4 times per second
      enabled: true
    });
    
    // Add a critical variable to the fast group
    machine.initCyclicReadGroup('critical', 'CriticalValue', (value) => {
      console.log(`⚡ Critical value update: ${value}`);
    });
    
    console.log('✅ Fast read group configured\n');

    // ===========================================
    // NAMESPACE HANDLING
    // ===========================================
    
    console.log('🏷️  Testing namespace handling...');
    
    try {
      // Read a system variable from different namespace
      const serverTime = await machine.readVariable('ServerTime', { 
        namespace: 'ns=0;i=' 
      });
      console.log(`   Server time: ${serverTime}`);
    } catch (error) {
      console.log(`   ⚠️  Server time read failed: ${error.message}`);
    }

    // ===========================================
    // MONITORING PERIOD
    // ===========================================
    
    console.log('\n📡 Monitoring real-time updates for 10 seconds...');
    console.log('    (You should see change notifications if values are updating)\n');

    let counter = 0;
    const monitorInterval = setInterval(() => {
      counter++;
      
      // Show current values via direct access
      const temp = (machine as any).Temperature;
      const pressure = (machine as any).Pressure;
      const status = (machine as any).Status;
      
      console.log(`   [${counter}] Current values: T=${temp}, P=${pressure}, S=${status}`);
      
      if (counter >= 10) {
        clearInterval(monitorInterval);
      }
    }, 1000);

    await new Promise(resolve => setTimeout(resolve, 10000));

    console.log('\n✅ Example completed successfully!');
    console.log('\n💡 Key takeaways:');
    console.log('   • Use initCyclicRead() to set up automatic monitoring');
    console.log('   • Access values directly: machine.VariableName');
    console.log('   • Use onChange() for change notifications');
    console.log('   • Use readVariable()/writeVariable() for explicit control');
    console.log('   • Configure read groups for different update rates');

  } catch (error) {
    console.error('\n❌ Example failed:', error);
    
    if (error.message.includes('ECONNREFUSED')) {
      console.log('\n💡 Troubleshooting:');
      console.log('   • Ensure mapp Connect server is running on localhost:80');
      console.log('   • Check firewall settings');
      console.log('   • Verify OPC UA is enabled in mapp Connect');
    } else if (error.message.includes('Unauthorized')) {
      console.log('\n💡 Authentication issue:');
      console.log('   • Check username/password credentials');
      console.log('   • Verify user permissions in mapp Connect');
    }
  } finally {
    // Clean disconnect
    console.log('\n🔌 Disconnecting...');
    try {
      await machine.disconnect();
      console.log('✅ Disconnected successfully!');
    } catch (error) {
      console.log('⚠️  Disconnect error (usually harmless)');
    }
  }
}

// ===========================================
// COMPARISON WITH LEGACY API
// ===========================================

function showApiComparison() {
  console.log('\n📋 API Evolution:');
  console.log('================');
  console.log('');
  console.log('Legacy API (registration-based):');
  console.log('  const client = new OpcuaClient(config);');
  console.log('  await client.registerVariable("temp", "ns=1;s=Temperature");');
  console.log('  client.onChange("temp", callback);');
  console.log('  await client.createSubscription("monitoring");');
  console.log('  await client.addVariableToSubscription("monitoring", "temp");');
  console.log('  const value = await client.readValue("temp");');
  console.log('');
  console.log('New lux.js-style API:');
  console.log('  const machine = new OpcuaMachine(config);');
  console.log('  machine.initCyclicRead("Temperature", callback);');
  console.log('  const value = machine.Temperature;  // Direct access!');
  console.log('  machine.Temperature = 25.5;        // Direct writing!');
  console.log('');
  console.log('✨ Much simpler and more intuitive!');
  console.log('');
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  showApiComparison();
  basicUsageExample().catch(console.error);
}
