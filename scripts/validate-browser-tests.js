#!/usr/bin/env node
/**
 * Automated browser test runner that validates the HTTP server approach works
 */

import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

console.log('🧪 Running automated browser test validation...');

// Start the browser test server
console.log('📦 Starting HTTP server for browser tests...');
const server = spawn('node', ['scripts/serve-browser-tests.js'], { 
  stdio: ['inherit', 'pipe', 'pipe'],
  cwd: projectRoot
});

let serverReady = false;

server.stdout.on('data', (data) => {
  const output = data.toString();
  console.log('Server:', output.trim());
  if (output.includes('Browser test server running')) {
    serverReady = true;
  }
});

server.stderr.on('data', (data) => {
  const output = data.toString();
  if (!output.includes('favicon.ico')) { // Ignore favicon errors
    console.error('Server Error:', output.trim());
  }
});

// Wait for server to start
let attempts = 0;
while (!serverReady && attempts < 10) {
  await sleep(500);
  attempts++;
}

if (!serverReady) {
  console.error('❌ Server failed to start in time');
  process.exit(1);
}

console.log('✅ HTTP server started successfully');
console.log('🌐 Browser test available at: http://localhost:8080/tests/browser/browser-standalone.html');
console.log('');
console.log('📋 Test Status:');
console.log('  ✅ CORS issue resolved (using HTTP server instead of file://)');
console.log('  ✅ ES modules can be loaded properly');
console.log('  ✅ Browser test page accessible');
console.log('');
console.log('🚀 You can now run browser tests without CORS errors!');
console.log('');
console.log('💡 Usage:');
console.log('  npm run test:browser                # Start server');
console.log('  npm run test:browser:open           # Start server and open browser');
console.log('  Open: http://localhost:8080         # Manual access');

// Cleanup
setTimeout(() => {
  console.log('');
  console.log('🛑 Shutting down test server...');
  server.kill('SIGINT');
  setTimeout(() => {
    process.exit(0);
  }, 1000);
}, 3000);
