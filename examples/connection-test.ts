#!/usr/bin/env node
/**
 * Connection Testing Example
 * 
 * This example demonstrates the enhanced connection checking functionality
 * that mirrors the pattern used in api-test.js. It shows how to:
 * 
 * 1. Test connection accessibility before attempting full connection
 * 2. Handle different types of connection errors with helpful messages
 * 3. Try multiple authentication endpoints automatically
 * 4. Provide detailed diagnostics for troubleshooting
 */

import { OpcuaConnection, ConnectionConfig } from '../dist/index.js';

async function testConnectionExample() {
    console.log('🚀 Connection Testing Example\n');
    
    // Example configurations for different scenarios
    const configs: Array<{ name: string, config: ConnectionConfig }> = [
        {
            name: 'mapp Connect HTTPS (port 8443)',
            config: {
                host: 'localhost',
                port: 8443,
                protocol: 'https',
                wsProtocol: 'wss',
                apiBasePath: '/api/1.0'
            }
        },
        {
            name: 'mapp Connect HTTP (port 80)',
            config: {
                host: 'localhost',
                port: 80,
                protocol: 'http',
                wsProtocol: 'ws',
                apiBasePath: '/opcua'
            }
        },
        {
            name: 'Standard OPC UA Server',
            config: {
                host: 'localhost',
                port: 4840,
                protocol: 'http',
                wsProtocol: 'ws',
                apiBasePath: '/opcua'
            }
        }
    ];
    
    for (const { name, config } of configs) {
        console.log(`\n📡 Testing: ${name}`);
        console.log(`   URL: ${config.protocol}://${config.host}:${config.port}${config.apiBasePath}`);
        
        try {
            // Create connection
            const connection = new OpcuaConnection({
                ...config,
                enableWebSocket: false, // Disable WebSocket for testing
                username: 'testuser',
                password: 'testpass'
            });
            
            // Test connection accessibility
            console.log('   🔍 Testing accessibility...');
            await connection.testConnection();
            console.log('   ✅ Server is accessible!');
            
            // Optionally test full connection
            console.log('   🔌 Testing full connection...');
            await connection.connect();
            console.log('   ✅ Full connection successful!');
            
            // Clean up
            await connection.disconnect();
            console.log('   🔌 Disconnected cleanly');
            
        } catch (error) {
            console.log(`   ❌ Failed: ${error.message}`);
            
            // Provide helpful guidance based on error type
            if (error.message.includes('Certificate') || error.message.includes('certificate')) {
                console.log('   💡 Solution: Accept the SSL certificate in your browser:');
                console.log(`      Open ${config.protocol}://${config.host}:${config.port} and accept security warning`);
            } else if (error.message.includes('Network') || error.message.includes('fetch')) {
                console.log('   💡 Solution: Check server status and connectivity:');
                console.log('      - Ensure the server is running');
                console.log('      - Verify host and port are correct');
                console.log('      - Check firewall settings');
            } else if (error.message.includes('Authentication failed')) {
                console.log('   💡 Solution: Check authentication settings:');
                console.log('      - Verify username and password');
                console.log('      - Try anonymous access (remove credentials)');
                console.log('      - Check server authentication requirements');
            }
        }
    }
    
    console.log('\n🏁 Connection testing complete!');
    console.log('\n📚 Key Features Demonstrated:');
    console.log('  • Multiple endpoint testing (/session, /auth, /api/1.0/auth)');
    console.log('  • Certificate error detection and guidance');
    console.log('  • Network error categorization');
    console.log('  • mapp Connect authentication patterns');
    console.log('  • Helpful troubleshooting messages');
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
    testConnectionExample().catch(error => {
        console.error('Example failed:', error);
        process.exit(1);
    });
}

export { testConnectionExample };
