import { OpcuaMachine } from '../dist/index.js';
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

const readVariable = "demo:test.slider"

async function testReconnection() {
  console.log('Testing WebSocket reconnection with manual server restarts...\n');

  const lux = new OpcuaMachine({
    host: '127.0.0.1',
    port: 8443,
    protocol: 'https',
    username: 'dev',
    password: 'dev',
    reconnectConfig: {
      maxAttempts: 10,  // More attempts for manual testing
      intervalMs: 2000  // Longer interval for manual testing
    }
  });

  // Set to default error policy for crash-resistant behavior
  lux.setErrorPolicy('default');
  // Set up variable
//   lux.initCyclicRead('demo:test.slider');

  console.log('1. Establishing initial connection...');
  await lux.connect();
  
  let readValue = await lux.readVariable(readVariable);
  console.log(`   ✅ Connected! Initial value: ${readValue}`);

  console.log('\n2. Testing quick programmatic reconnection...');
  
  // Just one quick test to verify basic functionality
  await lux.disconnect();
  readValue = await lux.readVariable(readVariable);
  console.log(`   Value during disconnect: ${readValue} (cached)`);
  
  await lux.connect();
  readValue = await lux.readVariable(readVariable);
  console.log(`   ✅ Reconnected! Value: ${readValue}`);

  console.log('\n3. Ready for manual server restart testing!');

  console.log('\n4. Testing manual server restart...');
  console.log('   The library will now continuously monitor the connection.');
  console.log('   You can manually restart the server to test reconnection behavior.');
  console.log('   Press Ctrl+C to stop the test.\n');
  
  let monitorCount = 0;
  const monitorInterval = setInterval(async () => {
    monitorCount++;
    try {
      const value = await lux.readVariable(readVariable);
      console.log(`   Monitor ${monitorCount}: ${readVariable} = ${value} (${new Date().toLocaleTimeString()})`);
    } catch (error) {
      console.log(`   Monitor ${monitorCount}: Read failed, using cached value (${new Date().toLocaleTimeString()})`);
    }
  }, 2000);

  // Set up connection state monitoring
  lux.onConnectionStateChanged((state) => {
    console.log(`   🔄 Connection state changed to: ${state} (${new Date().toLocaleTimeString()})`);
  });

  // Keep the test running until manually stopped
  process.on('SIGINT', async () => {
    console.log('\n\n5. Cleaning up...');
    clearInterval(monitorInterval);
    await lux.disconnect();
    console.log('✅ Manual reconnection test completed!');
    process.exit(0);
  });

  // Prevent the function from ending
  return new Promise(() => {}); // This keeps the function running indefinitely
}

async function runAutomatedTest() {
  console.log('🤖 Running automated reconnection tests...\n');

  const lux = new OpcuaMachine({
    host: '127.0.0.1',
    port: 8443,
    protocol: 'https',
    username: 'dev',
    password: 'dev',
    reconnectConfig: {
      maxAttempts: 3,
      intervalMs: 1000
    }
  });

  lux.setErrorPolicy('default');
  lux.initCyclicRead(readVariable);

  console.log('1. Testing initial connection...');
  await lux.connect();
  
  let readValue = await lux.readVariable(readVariable);
  console.log(`   Initial value: ${readValue}`);

  console.log('\n2. Testing disconnect/reconnect cycles...');
  
  for (let i = 0; i < 3; i++) {
    console.log(`   Cycle ${i + 1}...`);
    
    try {
      await lux.disconnect();
      readValue = await lux.readVariable(readVariable);
      console.log(`   Value during disconnect: ${readValue} (cached)`);
      
      await lux.connect();
      console.log(`   Reconnected successfully`);
      
      readValue = await lux.readVariable(readVariable);
      console.log(`   Value after reconnect: ${readValue}`);
      
    } catch (error) {
      console.error(`   ❌ Cycle ${i + 1} failed:`, error.message);
      break;
    }
  }

  await lux.disconnect();
  console.log('✅ Automated tests completed!\n');
}

// Check command line arguments
const args = process.argv.slice(2);
const testType = args[0] || 'manual';

if (testType === 'auto' || testType === 'automated') {
  runAutomatedTest().catch(error => {
    console.error('\n❌ Automated test failed:', error);
    process.exit(1);
  });
} else {
  console.log('🔧 Manual Server Restart Test');
  console.log('Usage: node reconnection-test.js [auto|manual]');
  console.log('Default: manual (allows server restart testing)\n');
  
  testReconnection().catch(error => {
    console.error('\n❌ Manual reconnection test failed:', error);
    process.exit(1);
  });
}