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

import { OpcuaMachine, isLuxConnectError, LuxConnectErrorCode } from '../dist/index.js';

// Global error handlers to prevent crashes from unhandled promises
process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Promise Rejection at:', promise, 'reason:', reason);
  if (isLuxConnectError(reason)) {
    console.error(`   LuxConnect Error [${reason.code}]: ${reason.message}`);
    if (reason.isConnectionError()) {
      console.error('   → This appears to be a connection issue');
      return; // Don't exit for connection errors
    }
  }
  console.error('   → This might indicate a programming error that should be fixed');
});

process.on('uncaughtException', (error) => {
  console.error('🚨 Uncaught Exception:', error);
  console.error('   → The process will exit');
  process.exit(1);
});

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

  // Configure error handling policy
  console.log('🛡️  Setting error policy to "default" - reads will not crash, will return cached values');
  machine.setErrorPolicy('default'); // Won't crash on unhandled read errors
  
  // Uncomment the next line to enable strict mode (will crash on unhandled errors)
  // machine.setErrorPolicy('strict');

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
    machine.initCyclicRead('::demo:test');

    "ApplicationModule::Scope:PLC_PRG.test";

    // Example 2: Individual structure members
    machine.initCyclicRead('::demo:test.command');

    machine.initCyclicRead('::demo:test.slider');

    // Example 3: A global variable
    machine.initCyclicRead('gtest.myvalue.x');

    let doubleArray = await machine.readVariable('::testarray.doubleArray');

    console.log(`📝 Initial read return : = ${JSON.stringify(doubleArray)}`);
    console.log(`📝 Initial read global structure: = ${JSON.stringify(machine.testarray.doubleArray)}`);
    let value = machine.testarray.doubleArray[0][0].member1 + 1;
    console.log(`📝 read incremented value: = ${value}`);
    await machine.writeVariable('::testarray.doubleArray[0,0]', {member1: value});
    await machine.readVariable('::testarray.doubleArray[0,0]');
    console.log(`📝 Final read: = ${JSON.stringify(machine.testarray.doubleArray[0][0].member1)}`);

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
        // Read some values explicitly - now with crash-resistant behavior!
        // These reads will NOT crash if the connection fails - they'll return cached values and log warnings
        
        // This read will not crash even without .catch() in default mode
        machine.readVariable('::demo:test.command'); // No await, no .catch() - but won't crash!
        
        // You can still handle errors explicitly if needed
        machine.readVariable('::demo:test.command')
          .then(v => {
            console.log(`� Explicit read: test.command=${v}`);
          })
          .catch(error => {
            // This .catch() is now optional - the library won't crash without it
            console.log(`⚠️ Explicit error handling: ${error.message}`);
          });
          
        // Await with no .catch() - in default mode this won't crash
        let myval = await machine.readVariable('gtest.myvalue.x');
        console.log(`📝 Global variable: gtest.myvalue.x=${myval}`);

        // Try writing a value
        if (counter === 5) {
          console.log('\n✏️  Writing test values...');
          // These writes also won't crash in default mode
          await machine.writeVariable('::demo:test.command', counter * 10);
          await machine.writeVariable('gtest.myvalue.x', counter * 5.5);
          console.log('✅ Values written successfully\n');
        }
        
      } catch (error) {
        // This catch is now mainly for programming errors, not connection issues
        if (isLuxConnectError(error)) {
          console.log(`⚠️ Programming error: [${error.code}] ${error.message}`);
        } else {
          console.log(`❌ Unexpected error: ${error.message}`);
        }
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
    console.error('\n❌ Demo failed:');
    if (isLuxConnectError(error)) {
      console.error(`   Error Code: ${error.code}`);
      console.error(`   Message: ${error.message}`);
      
      if (error.isConnectionError()) {
        console.error('   → This is a connection-related error');
        if (error.code === LuxConnectErrorCode.NOT_CONNECTED) {
          console.error('   → The client is not connected to the server');
        } else if (error.code === LuxConnectErrorCode.NETWORK_ERROR) {
          console.error('   → Check if the server is running and accessible');
        } else if (error.code === LuxConnectErrorCode.AUTHENTICATION_FAILED) {
          console.error('   → Check username/password credentials');
        }
      }
      
      if (error.isRetryable()) {
        console.error('   → This error could be retried');
      }
    } else {
      console.error(`   ${error.message}`);
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

// Run the demo
console.log('▶️ Running demo...\n');
simpleDemo().catch((error) => {
  console.error('Demo error:', error);
  process.exit(1);
});