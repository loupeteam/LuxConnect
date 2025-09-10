/**
 * Working Lux.js Style Demo
 * 
 * This is a practical demonstration that can be run against a real mapp Connect server
 */

import { OpcuaMachine } from '../src/index.js';

async function luxStyleDemo() {
  console.log('🚀 Starting lux.js style OPC UA demo...');

  // Create machine instance (lux.js style)
  const machine = new OpcuaMachine({
    host: 'localhost',
    port: 80,
    username: 'user',
    password: 'pass'
  });

  try {
    // Connect to server
    console.log('🔌 Connecting to OPC UA server...');
    await machine.connect();
    console.log('✅ Connected successfully!');

    // Set default namespace for convenience (adjust for your server)
    machine.setDefaultNamespace('ns=1;s=');

    // Configure read groups
    console.log('⚙️  Configuring read groups...');
    
    // Default group for most variables (1 second)
    machine.configureReadGroup('default', {
      publishingInterval: 1000,
      enabled: true
    });

    // Fast group for critical variables (250ms)
    machine.configureReadGroup('fast', {
      publishingInterval: 250,
      enabled: true
    });

    // Add variables to cyclic reading (lux.js style)
    console.log('📊 Setting up variable monitoring...');
    
    // Basic variables - these will auto-subscribe when values are accessed
    machine.initCyclicRead('Temperature');
    machine.initCyclicRead('Pressure');
    machine.initCyclicRead('Speed');
    
    // Variable with immediate callback
    machine.initCyclicRead('Status', (value) => {
      console.log(`📢 Status update: ${value}`);
    });

    // Fast-updating variable
    machine.initCyclicReadGroup('fast', 'CriticalValue', (value) => {
      console.log(`⚡ Critical value: ${value}`);
    });

    // Add change handlers for other variables
    machine.onChange('Temperature', (value) => {
      console.log(`🌡️  Temperature: ${value}°C`);
    });

    machine.onChange('Pressure', (value) => {
      console.log(`💨 Pressure: ${value} bar`);
    });

    machine.onChange('Speed', (value) => {
      console.log(`🏃 Speed: ${value} rpm`);
    });

    // Wait for initial subscription setup
    console.log('⏳ Waiting for initial values...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Demonstrate explicit read operations
    console.log('\n📖 Testing explicit read operations:');
    
    try {
      const temp = await machine.readVariable('Temperature');
      console.log(`   Temperature (explicit): ${temp}`);
    } catch (error) {
      console.log(`   Temperature read failed: ${error.message}`);
    }

    try {
      const pressure = await machine.readVariable('Pressure');
      console.log(`   Pressure (explicit): ${pressure}`);
    } catch (error) {
      console.log(`   Pressure read failed: ${error.message}`);
    }

    // Demonstrate direct property access (lux.js style)
    console.log('\n🎯 Testing direct property access:');
    console.log(`   machine.Temperature = ${(machine as any).Temperature}`);
    console.log(`   machine.Pressure = ${(machine as any).Pressure}`);
    console.log(`   machine.Speed = ${(machine as any).Speed}`);

    // Demonstrate explicit write operations
    console.log('\n✏️  Testing write operations:');
    
    try {
      await machine.writeVariable('Temperature', 25.5);
      console.log(`   ✅ Temperature written: 25.5`);
    } catch (error) {
      console.log(`   ❌ Temperature write failed: ${error.message}`);
    }

    try {
      await machine.writeVariable('Speed', 1500);
      console.log(`   ✅ Speed written: 1500`);
    } catch (error) {
      console.log(`   ❌ Speed write failed: ${error.message}`);
    }

    // Demonstrate direct property writing (lux.js style)
    console.log('\n🎯 Testing direct property writing:');
    (machine as any).Pressure = 10.5;
    console.log(`   Set machine.Pressure = 10.5`);
    
    (machine as any).Temperature = 30.0;
    console.log(`   Set machine.Temperature = 30.0`);

    // Let subscriptions run and collect data
    console.log('\n📡 Monitoring real-time updates for 10 seconds...');
    
    let counter = 0;
    const monitorInterval = setInterval(() => {
      counter++;
      console.log(`   [${counter}] Monitoring... (${(machine as any).Temperature}, ${(machine as any).Pressure}, ${(machine as any).Speed})`);
      
      if (counter >= 10) {
        clearInterval(monitorInterval);
      }
    }, 1000);

    await new Promise(resolve => setTimeout(resolve, 10000));

    // Demonstrate read group management
    console.log('\n🔧 Testing read group management:');
    
    // Disable fast group temporarily
    machine.setReadGroupEnable('fast', false);
    console.log('   Fast group disabled');
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Re-enable with different settings
    machine.configureReadGroup('fast', {
      publishingInterval: 500,  // Slower
      enabled: true
    });
    console.log('   Fast group re-enabled with 500ms interval');

    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('\n🎉 Demo completed successfully!');

  } catch (error) {
    console.error('❌ Error during demo:', error);
    
    if (error.message.includes('ECONNREFUSED')) {
      console.log('\n💡 Make sure your mapp Connect server is running on localhost:80');
    } else if (error.message.includes('Unauthorized')) {
      console.log('\n💡 Check your username/password credentials');
    }
  } finally {
    // Clean disconnect
    console.log('\n🔌 Disconnecting...');
    try {
      await machine.disconnect();
      console.log('✅ Disconnected successfully');
    } catch (error) {
      console.log('⚠️  Disconnect error (this is usually harmless)');
    }
  }
}

// Helper function to demonstrate the API differences
function showApiComparison() {
  console.log('\n📋 API Comparison - lux.js vs lux-opcua:');
  console.log('');
  console.log('Original lux.js:');
  console.log('  var machine = new LUX.Machine({host: "localhost", port: 8080});');
  console.log('  machine.initCyclicRead("Temperature");');
  console.log('  var temp = machine.Temperature;  // Direct read');
  console.log('  machine.Temperature = 25.5;      // Direct write');
  console.log('');
  console.log('lux-opcua (new):');
  console.log('  const machine = new OpcuaMachine({host: "localhost", port: 80});');
  console.log('  await machine.connect();');
  console.log('  machine.initCyclicRead("Temperature");');
  console.log('  const temp = machine.Temperature;    // Direct read (via proxy)');
  console.log('  machine.Temperature = 25.5;          // Direct write (via proxy)');
  console.log('  const temp = await machine.readVariable("Temperature");  // Explicit');
  console.log('  await machine.writeVariable("Temperature", 25.5);        // Explicit');
  console.log('');
}

// Run the demo
if (import.meta.url === `file://${process.argv[1]}`) {
  showApiComparison();
  luxStyleDemo().catch(console.error);
}
