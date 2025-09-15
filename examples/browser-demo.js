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
    document.getElementById('writeArrayBtn').disabled = !connected;
    document.getElementById('logicDemoBtn').disabled = !connected;
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
            log('Adding TestStruct variable...');
            machine.setDefaultNamespace('ns=5;s=');
            machine.initCyclicRead('::demo:test', (value) => {
                log(`📊 TestStruct changed: ${JSON.stringify(value, null, 2)}`);
                updateVariableDisplay('TestStruct', JSON.stringify(value, null, 2));
            });
            log('✅ TestStruct variable added to cyclic reading');
            
            // Update variables display
            const variablesDiv = document.getElementById('variables');
            variablesDiv.innerHTML = '<div class="variable">TestStruct: <span id="tempValue">-</span></div>';
            
        } catch (error) {
            log(`❌ Failed to add variable: ${error.message}`);
        }
    }
};

window.readVariable = async function() {
    if (machine) {
        try {
            // const value = await machine.readVariable('::demo:test_arrays.testArrayStruct[0]');
            // log(`📖 Read ::demo:test_arrays.testArrayStruct[0]: ${JSON.stringify(value)}`);
            const value1 = await machine.readVariable('::demo:test_arrays.New_Member1.ints[0]');
            const value0 = await machine.writeVariable('::demo:test_arrays.New_Member1.ints[0]', value1 + 10);
            const value2 = await machine.readVariable('::demo:test_arrays.New_Member1.ints[0]');
            log(`📖 Read ::demo:test_arrays.New_Member1.ints[0]: ${JSON.stringify(value2)}`);
        } catch (error) {
            log(`❌ Read failed: ${error.message}`);
        }
    }
};

window.writeVariable = async function() {
    if (machine) {
        try {
            log('📝 Complex Object Writing Demo');
            log('==============================');
            
            // Example of complex object that should be decomposed into individual writes
            // Using actual TestStruct structure from the Automation Studio project
            const complexValue = {
                command: 42,
                slider: 75.5,
                random: true,
                myvalue: { x: 100 }
            };
            
            log('Complex TestStruct object to write:');
            log(`${JSON.stringify(complexValue, null, 2)}`);
            log('');
            log('This will be automatically decomposed into individual variable writes:');
            log('  - ::demo:test.command = 42');
            log('  - ::demo:test.slider = 75.5');
            log('  - ::demo:test.random = true');
            log('  - ::demo:test.struct1.member1 = 100');
            log('  - ::demo:test.struct1.member2 = "Hello World"');
            log('  - ::demo:test.struct2.member1 = 200');
            log('  - ::demo:test.struct2.member2 = "Complex Test"');
            log('  - ::demo:test.struct3.member1 = 300');
            log('  - ::demo:test.struct3.member2 = "Third Struct"');
            log('  - ::demo:test.myvalue = 999.99');
            log('');
            
            await machine.writeVariable('::demo:test', complexValue);
            log('✅ Complex TestStruct written successfully using batch write');
            log('');
            
            // Also test simple value write to a global variable
            log('📊 Simple Value Writing Demo');
            log('============================');
            log('Writing simple value to global gtest.myvalue = 25.5...');
            await machine.writeVariable('gtest.myvalue.x', 25.5);
            log('✅ Global variable written successfully');
            log('');
            
            // Test different primitive types using actual TestStruct fields
            log('🔢 Primitive Types Demo');
            log('======================');
            
            log('Writing boolean: ::demo:test.command = true');
            await machine.writeVariable('::demo:test.command', true);
            log('✅ Boolean written');
            
            log('Writing string: ::demo:test.struct1.struct1.member3 = "Demo System"');
            await machine.writeVariable('::demo:test.struct1.struct1.member3', 'Demo System');
            log('✅ String written');
                        
            log('Writing float: ::demo:test.slider = 88.8');
            await machine.writeVariable('::demo:test.slider', 88.8);
            log('✅ Float written');
            
            log('🎯 All write demos completed successfully!');
            
        } catch (error) {
            log(`❌ Write failed: ${error.message}`);
            console.error('Detailed error:', error);
        }
    }
};

window.writeArrayVariable = async function() {
    if (machine) {
        try {
            log('🔢 Array Element Writing Demo');
            log('============================');
            
            // Demo 1: Write primitive values to array elements using actual TestArrays structure
            log('1️⃣ Writing primitive values to array elements:');
            
            log('   Writing ::demo:test_arrays.testArrayStruct[0].member1 = 100');
            await machine.writeVariable('::demo:test_arrays.testArrayStruct[0].member1', 100);
            log('   ✅ Primitive array element written (read-modify-write approach)');
            
            log('   Writing ::demo:test_arrays.testArrayStruct[1].member1 = 200');
            await machine.writeVariable('::demo:test_arrays.testArrayStruct[1].member1', 200);
            log('   ✅ Another primitive array element written');
            
            // Demo 2: Write complex objects to array elements
            log('2️⃣ Writing complex objects to array elements:');
            
            const complexObject = {
                member1: 999,
                member2: 100,
            };
            
            log('   Complex object to write:');
            log(`   ${JSON.stringify(complexObject, null, 6)}`);
            log('   Writing ::demo:test_arrays.testArrayStruct[0] = complexObject');
            
            await machine.writeVariable('::demo:test_arrays.testArrayStruct[0]', complexObject);
            log('   ✅ Complex object written (property decomposition approach)');
            log('     This was decomposed into individual property writes:');
            log('     - ::demo:test_arrays.testArrayStruct[0].member1 = 999');
            log('     - ::demo:test_arrays.testArrayStruct[0].member2 = "Complex Array Element"');
            
            // Demo 3: Write to 2D array of complex structures (TestArrays.doubleArray is ARRAY[0..3,0..3] OF TestStruct2)
            log('3️⃣ Writing to 2D array of complex structures:');
            
            log('   Writing ::demo:test_arrays.doubleArray[0,0] = {member1: 100, member2: "Complex [0,0]"}');
            await machine.writeVariable('::demo:test_arrays.doubleArray[0,0]', {
                member1: 100,
                member2: 0,
                member3: 'First element'
            });
            log('   ✅ Complex structure written to 2D array element (property decomposition)');
            
            log('   Writing ::demo:test_arrays.doubleArray[1,2] = {member1: 120, member2: "Complex [1,2]"}');
            await machine.writeVariable('::demo:test_arrays.doubleArray[1,2]', {
                member1: 120,
                member2: 0,
                member3: 'Second element'
            });
            log('   ✅ Another complex structure written to 2D array element');
            
            // Demo 4: Mixed operations with 2D complex array
            log('4️⃣ Mixed operations demo:');
                        
            // Then modify individual elements within the row
            log('   Modifying individual elements within the row:');
            await machine.writeVariable('::demo:test_arrays.doubleArray[0,0]', {
                member1: 999,
                member2: 101,
                member3: 'Updated'
            });
            log('   ✅ doubleArray[0,0] = {member1: 999, ...}');
            
            await machine.writeVariable('::demo:test_arrays.doubleArray[0,3]', {
                member1: 777,
                member2: -1,
                member3: 'Final'
            });
            log('   ✅ doubleArray[0,3] = {member1: 777, ...}');
            
            // Demo 5: Global 2D array operations
            log('5️⃣ Global 2D array operations:');
            
            log('   Writing to global testarray.doubleArray[2,1] = {member1: 777, member2: "Global 2D"}');
            await machine.writeVariable('testarray.doubleArray[2,1]', {
                member1: 777,
                member2: 984,
                member3: 'Global structure'
            });
            log('   ✅ Global 2D array element written');
            
            log('   Writing to global testarray.testArrayStruct[1].member2 = "Global Test"');
            await machine.writeVariable('testarray.testArrayStruct[1].member2', 200);
            log('   ✅ Global struct array member written');
            
            log('🎉 Array element writing demo completed!');
            log('');
            log('📋 Summary of approaches used:');
            log('   • Direct array element write → Tries direct write first (if server supports)');
            log('   • Read-modify-write fallback → Used when direct write fails');
            log('   • Complex objects → Property decomposition (consistent with OPC UA)');
            log('   • 2D arrays → Multi-dimensional indexing with complex structures');
            log('   • Library automatically chooses the best approach and falls back gracefully');
            log('   • Works with both task-local (::demo:) and global variables');
            
        } catch (error) {
            log(`❌ Array write demo failed: ${error.message}`);
            console.error('Detailed error:', error);
        }
    }
};

window.runLogicDemo = async function() {
    if (machine) {
        try {
            log('🧠 Simplified Array Element Logic Demo');
            log('=====================================');
            log('This demo shows how the library automatically chooses the right approach');
            log('based on BOTH the variable name pattern AND the value type.');
            log('');
            
            // Case 1: Array element + primitive value → Try direct write, fallback to read-modify-write
            log('1️⃣ CASE: Array Element + Primitive Value');
            log('   Operation: machine.writeVariable("::demo:test_arrays.testArrayStruct[0].member1", 123)');
            log('   Decision:  Array pattern detected + primitive value → Try direct write first');
            log('   Method:    Direct write with read-modify-write fallback');
            log('   Steps:     1. Try writing directly to array element');
            log('              2. If that fails, fall back to read-modify-write approach');
            
            await machine.writeVariable('::demo:test_arrays.testArrayStruct[0].member1', 123);
            log('   ✅ Completed (check console for which method was used)');
            log('');
            
            // Case 2: Array element + complex value → writeComplexValue (property decomposition)
            log('2️⃣ CASE: 2D Array Element + Complex Object');
            log('   Operation: machine.writeVariable("::demo:test_arrays.doubleArray[0,1]", {member1: 1, member2: "test"})');
            log('   Decision:  Array pattern detected + complex value → writeComplexValue()');
            log('   Method:    Property decomposition approach');
            log('   Steps:     1. Flatten object into individual properties');
            log('              2. Write each property individually:');
            log('                 - ::demo:test_arrays.doubleArray[0,1].member1 = 1');
            log('                 - ::demo:test_arrays.doubleArray[0,1].member2 = "test"');
            
            const complexObject = { member1: 777, member2: 20, member3: 'complex 2D' };
            await machine.writeVariable('::demo:test_arrays.doubleArray[0,1]', complexObject);
            log('   ✅ Completed using property decomposition');
            log('');
            
            // Case 3: No array pattern + complex value → writeComplexValue
            log('3️⃣ CASE: Regular Variable + Complex Object');
            log('   Operation: machine.writeVariable("::demo:test", {command: 123, slider: 45.6})');
            log('   Decision:  No array pattern + complex value → writeComplexValue()');
            log('   Method:    Property decomposition approach');
            log('   Steps:     Same as case 2, but for regular variable');
            
            const configObject = { command: 555, slider: 88.8, random: false };
            await machine.writeVariable('::demo:test', configObject);
            log('   ✅ Completed using property decomposition');
            log('');
            
            // Case 4: No array pattern + primitive → writeSingleValue
            log('4️⃣ CASE: Regular Variable + Primitive Value');
            log('   Operation: machine.writeVariable("::demo:test.myvalue", 25.5)');
            log('   Decision:  No array pattern + primitive value → writeSingleValue()');
            log('   Method:    Direct write approach');
            log('   Steps:     1. Write value directly to OPC UA node');
            
            await machine.writeVariable('::demo:test.myvalue.x', 25.5);
            log('   ✅ Completed using direct write');
            log('');
            
            // Case 5: Global variable examples
            log('5️⃣ CASE: Global Variables');
            log('   Operation: machine.writeVariable("gtest.struct1.member1", 999)');
            log('   Decision:  No array pattern + primitive value → writeSingleValue()');
            log('   Method:    Direct write approach');
            
            await machine.writeVariable('gtest.struct1.struct1.member1', 999);
            log('   ✅ Global variable written directly');
            
            log('   Operation: machine.writeVariable("testarray.doubleArray[2,1]", {member1: 88, member2: "test"})');
            log('   Decision:  Array pattern + complex value → writeComplexValue()');
            log('   Method:    Property decomposition approach');
            
            await machine.writeVariable('testarray.doubleArray[2,1]', {
                member1: 888,
                member2: 99,
                member3: 'Multi-dimensional'
            });
            log('   ✅ Global 2D array element written using property decomposition');
            log('');
            
            log('🎯 SUMMARY: Simplified Decision Logic');
            log('=====================================');
            log('The writeValue() method uses this simple decision tree:');
            log('');
            log('1. Is it an array element pattern (name[index]) AND primitive value?');
            log('   YES → writeArrayElement() → read-modify-write');
            log('   NO  → Continue to step 2');
            log('');
            log('2. Is the value complex (object/array with objects)?');
            log('   YES → writeComplexValue() → property decomposition');
            log('   NO  → writeSingleValue() → direct write');
            log('');
            log('✅ Benefits:');
            log('   • Intelligent fallback strategy for array element writes');
            log('   • Always tries the most efficient method first (direct write)');
            log('   • Gracefully falls back to read-modify-write when needed');
            log('   • Complex objects always use consistent decomposition');
            log('   • Single decision point in writeValue() with automatic method selection');
            log('   • Works seamlessly with different server configurations');
            log('   • Supports multi-dimensional arrays with complex structures');
            log('   • Comprehensive error handling and logging for troubleshooting');
            
        } catch (error) {
            log(`❌ Logic demo failed: ${error.message}`);
            console.error('Detailed error:', error);
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
            log('📍 Arrays in task ::demo:test_arrays');
            machine.initCyclicRead('::demo:test_arrays', (value) => {
                log(`  └─2 ::demo:test_arrays = ${JSON.stringify(value)}`);
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