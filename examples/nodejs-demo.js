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
      publishingInterval: 1000,  // Update every 1 second
      samplingInterval: 500,     // Sample every 500ms
      maxNotificationsPerPublish: 1000,
      priority: 1
    });

    console.log('📊 Adding variables for monitoring...');
    
    // Add some example variables (adjust these paths to match your PLC variables)
    
    // Example 1: A simple test structure
    machine.initCyclicRead('::demo:test', (value) => {
      console.log(`📈 TestStruct: ${JSON.stringify(value, null, 2)}`);
    });

    // Example 2: Individual structure members
    machine.initCyclicRead('::demo:test.command', (value) => {
      console.log(`🎛️  Command: ${value}`);
    });

    machine.initCyclicRead('::demo:test.slider', (value) => {
      console.log(`📊 Slider: ${value}`);
    });

    // Example 3: A global variable
    machine.initCyclicRead('gtest.myvalue.x', (value) => {
      console.log(`🌍 Global test value: ${value}`);
    });

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
        const testValue = await machine.readVariable('::demo:test.command');
        const globalValue = await machine.readVariable('gtest.myvalue.x');
        
        console.log(`[${counter}] Explicit reads: test.command=${testValue}, global.x=${globalValue}`);
        
        // Try writing a value
        if (counter === 5) {
          console.log('\n✏️  Writing test values...');
          await machine.writeVariable('::demo:test.command', counter * 10);
          await machine.writeVariable('gtest.myvalue.x', counter * 5.5);
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
    
    // Provide helpful troubleshooting tips
    if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed')) {
      console.log('\n💡 Connection troubleshooting:');
      console.log('   • Ensure mapp Connect server is running');
      console.log(`   • Verify server is accessible at ${config.host}:${config.port}`);
      console.log('   • Check firewall settings');
    } else if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      console.log('\n💡 Authentication troubleshooting:');
      console.log('   • Check username/password credentials');
      console.log('   • Default mapp Connect: dev/dev');
      console.log('   • Verify user permissions in mapp Connect configuration');
      console.log('   • Check if OPC UA server accepts these credentials');
    } else if (error.message.includes('404') || error.message.includes('Not Found')) {
      console.log('\n💡 API path troubleshooting:');
      console.log('   • Try different API paths: /opcua, /opc, /api/opcua');
      console.log('   • Check mapp Connect OPC UA configuration');
    } else if (error.message.includes('503') || error.message.includes('Service Unavailable')) {
      console.log('\n💡 Service troubleshooting:');
      console.log('   • Server is running but OPC UA service may not be enabled');
      console.log('   • Check mapp Connect OPC UA configuration');
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

// Configuration guide
function showConfigurationOptions() {
  console.log('\n⚙️  Configuration Options:');
  console.log('=========================');
  console.log('');
  console.log('For mapp Connect HTTPS (port 8443):');
  console.log('  {');
  console.log('    host: "localhost",');
  console.log('    port: 8443,');
  console.log('    protocol: "https",');
  console.log('    username: "dev",');
  console.log('    password: "dev",');
  console.log('    apiBasePath: "/api/1.0"');
  console.log('  }');
  console.log('');
  console.log('Variable naming conventions:');
  console.log('  • Task-local: "::demo:variableName"');
  console.log('  • Global: "globalVariableName"');
  console.log('  • Namespace: Set with machine.setDefaultNamespace("ns=5;s=")');
  console.log('');
}

// Run the demo
console.log('🔧 Starting demo...');
showConfigurationOptions();
console.log('▶️ Running demo...\n');
simpleDemo().catch((error) => {
  console.error('Demo error:', error);
  process.exit(1);
});