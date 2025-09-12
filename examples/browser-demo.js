import { OpcuaMachine } from '../dist/index.js';

let machine = null;

function log(message) {
    const logElement = document.getElementById('log');
    const timestamp = new Date().toLocaleTimeString();
    logElement.innerHTML += `[${timestamp}] ${message}\n`;
    logElement.scrollTop = logElement.scrollHeight;
}

function updateStatus(state) {
    const statusElement = document.getElementById('status');
    statusElement.textContent = state.charAt(0).toUpperCase() + state.slice(1);
    statusElement.className = `status ${state}`;
}

function updateButtons(connected) {
    document.getElementById('connectBtn').disabled = connected;
    document.getElementById('disconnectBtn').disabled = !connected;
    document.getElementById('addVariableBtn').disabled = !connected;
    document.getElementById('readBtn').disabled = !connected;
    document.getElementById('writeBtn').disabled = !connected;
}

window.testConnection = async function() {
    try {
        log('🔍 Testing connection accessibility...');
        
        const protocol = document.getElementById('protocol').value;
        const host = document.getElementById('host').value;
        const port = parseInt(document.getElementById('port').value);
        
        // Get API path
        let apiPath = document.getElementById('apiPath').value;
        if (apiPath === 'custom') {
            apiPath = document.getElementById('customApiPath').value || '/opcua';
        }
        
        log(`Testing: ${protocol.toUpperCase()}://${host}:${port}${apiPath}`);
        
        // Create a temporary connection config for testing
        const { OpcuaConnection } = await import('../dist/connection.js');
        
        const connection = new OpcuaConnection({
            host: host,
            port: port,
            protocol: protocol,
            apiBasePath: apiPath,
            enableWebSocket: false // Don't enable WebSocket for testing
        });
        
        // Test connection accessibility
        await connection.testConnection();
        
        log('✅ Connection test successful! Server is accessible.');
        log('💡 Ready to connect - click "Connect" to establish full session.');
        
    } catch (error) {
        log(`❌ Connection test failed: ${error.message}`);
        
        if (error.message.includes('Certificate') || error.message.includes('certificate')) {
            log('💡 SSL/Certificate Issue: For HTTPS connections, accept the certificate:');
            const protocol = document.getElementById('protocol').value;
            const host = document.getElementById('host').value;
            const port = parseInt(document.getElementById('port').value);
            const baseUrl = `${protocol}://${host}:${port}`;
            log(`   1. Open ${baseUrl} in a new browser tab`);
            log('   2. Accept the security warning (click "Advanced" then "Proceed"');
            log('   3. Come back here and test connection again');
        } else if (error.message.includes('Network') || error.message.includes('fetch')) {
            log('💡 Network Issue: Check that the server is running and accessible');
            log('   - Verify the host and port are correct');
            log('   - Ensure the mapp Connect server is running');
            log('   - Check firewall settings');
        } else if (error.message.includes('CORS')) {
            log('💡 CORS Issue: Server needs to allow cross-origin requests');
            log('   - Add CORS headers to server responses');
            log('   - Or use a local proxy/tunnel');
        }
    }
}

window.connect = async function() {
    try {
        log('Creating OPC UA machine...');
        
        const protocol = document.getElementById('protocol').value;
        const host = document.getElementById('host').value;
        const port = parseInt(document.getElementById('port').value);
        const wsProtocol = document.getElementById('wsProtocol').value;
        
        // Get API path
        let apiPath = document.getElementById('apiPath').value;
        if (apiPath === 'custom') {
            apiPath = document.getElementById('customApiPath').value || '/opcua';
        }
        
        log(`Using ${protocol.toUpperCase()}://${host}:${port}${apiPath} for HTTP requests`);
        log(`Using ${wsProtocol.toUpperCase()}://${host}:${port}${apiPath}/pushchannel for WebSocket`);
        
        machine = new OpcuaMachine({
            host: host,
            port: port,
            protocol: protocol, // http or https
            wsProtocol: wsProtocol, // ws or wss
            apiBasePath: apiPath, // API base path
            username: document.getElementById('username').value,
            password: document.getElementById('password').value
        });
        machine.setDefaultNamespace('ns=5;s=');
        machine.setReadGroupP
        // Set up event handlers
        machine.onConnectionStateChanged((state) => {
            log(`Connection state: ${state}`);
            updateStatus(state);
            updateButtons(state === 'connected');
        });

        machine.onError((error) => {
            log(`Error: ${error.message}`);
        });

        log('Connecting to OPC UA server...');
        await machine.connect();
        
        log('✅ Connected successfully!');
        window.machine = machine; // Expose for debugging in browser console

    } catch (error) {
        log(`❌ Connection failed: ${error.message}`);
        if (error.message.includes('fetch')) {
            log('💡 CORS Issue: Your mapp Connect server needs CORS headers');
            log('💡 Add these headers to your OPC UA server responses:');
            log('   Access-Control-Allow-Origin: *');
            log('   Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
            log('   Access-Control-Allow-Headers: Content-Type, Authorization');
        } else if (error.message.includes('certificate') || error.message.includes('SSL')) {
            log('💡 SSL/TLS Issue: For HTTPS/WSS, ensure valid certificates');
            log('💡 For development, you may need to accept self-signed certificates');
        } else if (error.message.includes('404')) {
            log('💡 API Path Issue: The API endpoints were not found');
            log('💡 Try different API paths from the dropdown:');
            log('   - /opcua (standard mapp Connect)');
            log('   - /opc (alternative)');
            log('   - /api/opcua (REST API style)');
            log('   - / (root path)');
        }
    }
};

window.disconnect = async function() {
    if (machine) {
        try {
            log('Disconnecting...');
            await machine.disconnect();
            log('✅ Disconnected successfully');
            machine = null;
        } catch (error) {
            log(`❌ Disconnect error: ${error.message}`);
        }
    }
};

window.addVariable = function() {
    if (machine) {
        try {
            log('Adding Temperature variable...');
            machine.setDefaultNamespace('ns=5;s=');
            machine.initCyclicRead('::Demo:test', (value) => {
                log(`🌡️ Temperature changed: ${value}°C`);
                updateVariableDisplay('Temperature', value);
            });
            log('✅ Temperature variable added to cyclic reading');
            
            // Update variables display
            const variablesDiv = document.getElementById('variables');
            variablesDiv.innerHTML = '<div class="variable">Temperature: <span id="tempValue">-</span>°C</div>';
            
        } catch (error) {
            log(`❌ Failed to add variable: ${error.message}`);
        }
    }
};

window.readVariable = async function() {
    if (machine) {
        try {
            log('Reading Temperature variable...');
            const value = await machine.readVariable('Temperature');
            log(`📖 Temperature (explicit read): ${value}°C`);
            updateVariableDisplay('Temperature', value);
        } catch (error) {
            log(`❌ Read failed: ${error.message}`);
        }
    }
};

window.writeVariable = async function() {
    if (machine) {
        try {
            log('Writing Temperature = 25.5...');
            await machine.writeVariable('Temperature', 25.5);
            log('✅ Temperature written successfully');
            
            // Also try direct property access
            log('Setting Temperature via direct property access...');
            machine.Temperature = 26.0;
            log('✅ Temperature set via property access');
            
        } catch (error) {
            log(`❌ Write failed: ${error.message}`);
        }
    }
};

function updateVariableDisplay(name, value) {
    const tempValueElement = document.getElementById('tempValue');
    if (tempValueElement) {
        tempValueElement.textContent = value;
    }
}

// Initialize the demo
function initializeDemo() {
    // Initial setup
    log('🌐 lux-opcua Browser Demo loaded');
    log('💡 This demonstrates cross-platform compatibility!');
    updateButtons(false);
    updateStatus('disconnected');

    // Set default preset to mapp Connect 8443
    document.getElementById('preset').value = 'mappConnect8443';
    document.getElementById('preset').dispatchEvent(new Event('change'));

    // Add preset change handler
    document.getElementById('preset').addEventListener('change', function() {
        const preset = this.value;
        const protocolSelect = document.getElementById('protocol');
        const hostInput = document.getElementById('host');
        const portInput = document.getElementById('port');
        const wsProtocolSelect = document.getElementById('wsProtocol');
        const apiPathSelect = document.getElementById('apiPath');
        const usernameInput = document.getElementById('username');
        const passwordInput = document.getElementById('password');
        
        switch(preset) {
            case 'mappConnect8443':
                protocolSelect.value = 'https';
                hostInput.value = 'localhost';
                portInput.value = '8443';
                wsProtocolSelect.value = 'wss';
                apiPathSelect.value = '/api/1.0';
                usernameInput.value = 'dev';
                passwordInput.value = 'dev';
                log('🔧 Preset: mapp Connect HTTPS (8443) with /api/1.0');
                break;
            case 'mappConnect80':
                protocolSelect.value = 'http';
                hostInput.value = 'localhost';
                portInput.value = '80';
                wsProtocolSelect.value = 'ws';
                apiPathSelect.value = '/opcua';
                log('🔧 Preset: mapp Connect HTTP (80) with /opcua');
                break;
            case 'localhost443':
                protocolSelect.value = 'https';
                hostInput.value = 'localhost';
                portInput.value = '443';
                wsProtocolSelect.value = 'wss';
                apiPathSelect.value = '/api/1.0';
                log('🔧 Preset: Local HTTPS (443) with /api/1.0');
                break;
            case 'localhost80':
                protocolSelect.value = 'http';
                hostInput.value = 'localhost';
                portInput.value = '80';
                wsProtocolSelect.value = 'ws';
                apiPathSelect.value = '/opcua';
                log('🔧 Preset: Local HTTP (80) with /opcua');
                break;
            case 'custom':
                log('🔧 Preset: Custom - configure manually');
                break;
        }
    });

    // Add protocol change handlers for smart defaults
    document.getElementById('protocol').addEventListener('change', function() {
        const protocol = this.value;
        const portInput = document.getElementById('port');
        const wsProtocolSelect = document.getElementById('wsProtocol');
        
        if (protocol === 'https') {
            portInput.value = '443';
            wsProtocolSelect.value = 'wss';
            log('📡 Switched to HTTPS - Updated port to 443 and WebSocket to WSS');
        } else {
            portInput.value = '80';
            wsProtocolSelect.value = 'ws';
            log('📡 Switched to HTTP - Updated port to 80 and WebSocket to WS');
        }
    });

    document.getElementById('wsProtocol').addEventListener('change', function() {
        const wsProtocol = this.value;
        log(`🔌 WebSocket protocol changed to: ${wsProtocol.toUpperCase()}`);
    });

    document.getElementById('apiPath').addEventListener('change', function() {
        const apiPath = this.value;
        const customGroup = document.getElementById('customApiPathGroup');
        
        if (apiPath === 'custom') {
            customGroup.style.display = 'block';
            log('📝 Custom API path selected - enter your path below');
        } else {
            customGroup.style.display = 'none';
            log(`📡 API path changed to: ${apiPath || '/ (root)'}`);
        }
    });

    // Auto-connect
    connect();

    // Test different variable name formats after connection
    setTimeout(() => {
        if (machine) {
            log('🧪 Testing different variable name formats:');
            
            // Task local variables (single colon)
            log('📍 Task local: demo:test');
            machine.initCyclicRead('demo:test', (value) => {
                log(`  └─1 demo:test = ${JSON.stringify(value)}`);
            });
            
            // Explicit task local format
            log('📍 Explicit task local: ::demo:test');
            machine.initCyclicRead('::demo:test', (value) => {
                log(`  └─2 ::demo:test = ${JSON.stringify(value)}`);
            });

            // Array Types
            log('📍 Arrays in task ::demo:test_array');
            machine.initCyclicRead('::demo:test_array', (value) => {
                log(`  └─2 ::demo:test_array = ${JSON.stringify(value)}`);
            });

            // Global variables (no colons)
            log('🌍 Global: gtest');
            machine.initCyclicRead('gtest', (value) => {
                log(`  └─ gtest = ${JSON.stringify(value)}`);
            });
            
            // Global with structure
            log('🌍 Global structure: gtest.struct1');
            machine.initCyclicRead('gtest.struct1', (value) => {
                log(`  └─ gtest.struct1 = ${JSON.stringify(value)}`);
            });
            
            // Explicit global format
            log('🌍 Explicit global: ::gtest.struct2');
            machine.initCyclicRead('::gtest.struct2', (value) => {
                log(`  └─ ::gtest.struct2 = ${JSON.stringify(value)}`);
            });
            
            log('✅ All variable formats registered for cyclic reading');
            
            // Enable subscriptions to start receiving data
            machine.setReadGroupEnable('default', true);
        }
    }, 2000); // Wait 2 seconds after connection
}

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDemo);
} else {
    initializeDemo();
}