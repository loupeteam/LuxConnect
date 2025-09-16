/**
 * Simple Node.js Demo - lux-opcua Library
 * 
 * A basic demonstration of connecting to an OPC UA server,
 * adding variables, and reading their values.
 * Based on the browser-demo but simplified for Node.js.
 * 
 * This demo will show:
 * - Connection configuration and setup
 * - Variable setup and monitoring (when connected)
 * - Read/write operations
 * 
 * To use with a real server:
 * 1. Start your mapp Connect server
 * 2. Run: node examples/simple-nodejs-demo-clean.js
 */

import { OpcuaMachine } from '../dist/index.js';

// Configure Node.js to accept self-signed certificates (for development only)
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
console.log('🔓 Node.js configured to accept self-signed certificates (development mode)');
console.log('⚠️  WARNING: This disables certificate verification - only use in development!');

async function simpleDemo() {
  console.log('🚀 Simple Node.js OPC UA Demo');
  console.log('=============================\n');

  // Configuration for mapp Connect server
  const config = {
    host: 'localhost',
    port: 8443,
    protocol: 'https',
    username: 'dev',
    password: 'dev',
    apiBasePath: '/api/1.0'
  };

  console.log(`📡 Connecting to: ${config.protocol}://${config.host}:${config.port}${config.apiBasePath}`);
  console.log(`   Credentials: ${config.username}/${config.password}\n`);

  // Create the OPC UA machine
  const machine = new OpcuaMachine(config);

  try {
    // Set up event handlers
    machine.onConnectionStateChanged((state) => {
      console.log(`🔗 Connection state: ${state}`);
    });

    machine.onError((error) => {
      console.error(`❌ Error: ${error.message}`);
    });

    // Connect to the server
    console.log('⏳ Attempting connection...');
    await machine.connect();
    console.log('✅ Connected successfully!\n');

    // Set default namespace for Automation Studio variables
    machine.setDefaultNamespace('ns=5;s=');
    
    // Configure a read group for receiving updates
    machine.configureReadGroup("default", {
      publishingInterval: 50,  // Update every 1 second
      samplingInterval: 50,     // Sample every 500ms
      maxNotificationsPerPublish: 1000,
      priority: 1
    });

    console.log('📊 Adding variables for monitoring...');
    
    // Add some example variables (adjust these paths to match your PLC variables)

    // Example 1: A simple test structure
    // machine.initCyclicRead('::demo:test', (value) => {
      // console.log(`📈 TestStruct: ${JSON.stringify(value, null, 2)}`);
    // });

    // // Example 2: Individual structure members
    // machine.initCyclicRead('::demo:test.command', (value) => {
    //   console.log(`🎛️  Command: ${value}`);
    // });

    // machine.initCyclicRead('::demo:test.slider', (value) => {
    //   console.log(`📊 Slider: ${value}`);
    // });

    // // Example 3: A global variable
    // machine.initCyclicRead('gtest.myvalue.x', (value) => {
    //   console.log(`🌍 Global test value: ${value}`);
    // });

    // let doubleArray = await machine.readVariable('::testarray.doubleArray');

    // console.log(`📝 Initial read return : = ${JSON.stringify(doubleArray)}`);
    // console.log(`📝 Initial read global structure: = ${JSON.stringify(machine.testarray.doubleArray)}`);
    // let value = machine.testarray.doubleArray[0][0].member1 + 1;
    // console.log(`📝 read incremented value: = ${value}`);
    // await machine.writeVariable('::testarray.doubleArray[0,0]', {member1: value});
    // await machine.readVariable('::testarray.doubleArray[0,0]');
    // console.log(`📝 Final read: = ${JSON.stringify(machine.testarray.doubleArray[0][0].member1)}`);

    await machine.writeVariable('::testarray.doubleArray[0,2]', {member1: 100});
    // let member1 = await machine.readVariable('::testarray.doubleArray[0,2].member1');
    let member1 = await machine.readVariable('::testarray.doubleArray');
    await machine.writeVariable('::testarray.doubleArrayOffset1[1,1]', {member1: 100});
    console.log(`📝 Final read of member1: = ${JSON.stringify(member1)}`);
    console.log(`📝 Final read of single item: = ${machine.testarray.doubleArray[0][2].member1}`);

    let doubleArrayOffset = await machine.readVariable('::testarray.doubleArrayOffset1');
    console.log(`📝 Final read of doubleArrayOffset1: = ${JSON.stringify(doubleArrayOffset)}`);
    console.log('✅ Variables added to cyclic reading\n');

    // Enable the read group to start receiving data
    machine.setReadGroupEnable('default', true);
    console.log('🟢 Read group enabled - starting to receive updates\n');

    // Monitor for a while
    console.log('📡 Monitoring values for 30 seconds...\n');
    
    let counter = 0;
    const monitorInterval = setInterval(async () => {
      counter++;
      
      try {
        // Read some values explicitly (one-time reads)
        machine.readVariable('::demo:test.command').then(v=>{
          console.log(`📝 Explicit read: test.command=${v}`);
        });
        await machine.readVariable('gtest.myvalue.x').then(v=>{
          console.log(`📝 Explicit read: gtest.myvalue.x=${v}`);
        });

        // Try writing a value
        if (counter === 5) {
          console.log('\n✏️  Writing test values...');
          machine.writeVariable('::demo:test.command', counter * 10);
          machine.writeVariable('gtest.myvalue.x', counter * 5.5);
          console.log('✅ Values written successfully\n');
        }
        
      } catch (error) {
        console.log(`⚠️  Read/write error: ${error.message}`);
      }
      
      if (counter >= 30) {
        clearInterval(monitorInterval);
      }
    }, 1000);

    await new Promise(resolve => setTimeout(resolve, 30000));

    console.log('\n🎯 Demo completed successfully!');
    console.log('\n📋 Summary:');
    console.log('   • Connected to OPC UA server');
    console.log('   • Set up cyclic reading for multiple variables');
    console.log('   • Received real-time updates via callbacks');
    console.log('   • Performed explicit read and write operations');
    console.log('   • Used both task-local (::demo:) and global variables');

  } catch (error) {
    console.error('\n❌ Demo failed:', error.message);    
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

// Run the demo
console.log('▶️ Running demo...\n');
simpleDemo().catch((error) => {
  console.error('Demo error:', error);
  process.exit(1);
});