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
    statusElement        // Summary after a delay to let all operations complete
    setTimeout(() => {
        log('');
        log('📊 Write Demo Summary');
        log('====================');
    }, 2000); // Wait 2 seconds for all async operations to completee.charAt(0).toUpperCase() + state.slice(1);
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

    // Error policy testing buttons
    document.getElementById('setErrorPolicyBtn').disabled = !connected;
    document.getElementById('testErrorHandlingBtn').disabled = !connected;
    document.getElementById('testWithUserCatchBtn').disabled = !connected;

    // User management buttons
    document.getElementById('refreshSessionBtn').disabled = !connected;
    document.getElementById('switchToOperatorBtn').disabled = !connected;
    document.getElementById('switchToAnonymousBtn').disabled = !connected;
    document.getElementById('switchBackToAdminBtn').disabled = !connected;

    // Hide retry button when connected
    if (connected) {
        hideCertificateInfo();
    }
}

function showCertificateInfo() {
    const certInfo = document.getElementById('cert-info');
    const retryBtn = document.getElementById('retryBtn');

    if (certInfo) {
        certInfo.classList.add('show');
    }
    if (retryBtn) {
        retryBtn.classList.add('show');
    }
}

function hideCertificateInfo() {
    const certInfo = document.getElementById('cert-info');
    const retryBtn = document.getElementById('retryBtn');

    if (certInfo) {
        certInfo.classList.remove('show');
    }
    if (retryBtn) {
        retryBtn.classList.remove('show');
    }
}

window.retryAfterCert = function () {
    log('🔄 Retrying connection after certificate acceptance...');
    hideCertificateInfo();

    // Try testing the connection first
    testConnection().then(() => {
        // If test succeeds, try to connect
        log('💡 Test successful! Attempting full connection...');
        setTimeout(() => connect(), 1000);
    }).catch(() => {
        log('⚠️ Test still failing. Make sure you accepted the certificate in the other tab.');
    });
};

window.testConnection = async function () {
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

        if (error.message.includes('Certificate') || error.message.includes('certificate') ||
            error.message.includes('authority') || error.message.includes('net::err_cert') ||
            error.message.includes('sec_error') || error.message.includes('insecure') ||
            error.message.includes('SSL') || error.message.includes('TLS')) {

            log('� SSL/Certificate Issue: Opening certificate acceptance page...');
            const protocol = document.getElementById('protocol').value;
            const host = document.getElementById('host').value;
            const port = parseInt(document.getElementById('port').value);
            const baseUrl = `${protocol}://${host}:${port}`;

            // Automatically open the certificate acceptance page in a new tab
            const certWindow = window.open(baseUrl, '_blank');

            if (certWindow) {
                log(`✅ Opened certificate page in new tab: ${baseUrl}`);
                showCertificateInfo();
                log('📋 Please follow the instructions above to accept the certificate');

                // Add a visual indicator
                const statusElement = document.getElementById('status');
                statusElement.textContent = '🔐 Certificate acceptance required - check new tab';
                statusElement.className = 'status connecting';
            } else {
                log('⚠️ Popup blocked! Please allow popups for this site or manually open:');
                showCertificateInfo();

                // Create a clickable link in the log for manual opening
                const logElement = document.getElementById('log');
                const linkElement = document.createElement('a');
                linkElement.href = baseUrl;
                linkElement.target = '_blank';
                linkElement.textContent = `🔗 Click here to open certificate page: ${baseUrl}`;
                linkElement.style.color = '#007bff';
                linkElement.style.textDecoration = 'underline';
                linkElement.style.cursor = 'pointer';

                const timestamp = new Date().toLocaleTimeString();
                logElement.innerHTML += `[${timestamp}] `;
                logElement.appendChild(linkElement);
                logElement.innerHTML += '\n';
                logElement.scrollTop = logElement.scrollHeight;
            }
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

window.connect = async function () {
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
        // machine.setErrorPolicy('strict'); // Using default error policy to test smart error handling
        
        // Set up event handlers
        machine.onConnectionStateChanged((state) => {
            log(`Connection state: ${state}`);
            updateStatus(state);
            updateButtons(state === 'connected');

            // Update session info when connected
            if (state === 'connected') {
                updateSessionDisplay();
            } else {
                // Clear session info when disconnected
                document.getElementById('currentUser').textContent = 'Not logged in';
                document.getElementById('currentRoles').textContent = '-';
            }
        });

        machine.onError((error) => {
            log(`Error: ${error.message}`);
        });

        machine.configureReadGroup("default", { publishingInterval: 50, samplingInterval: 50, maxNotificationsPerPublish: 1000, priority: 1 });

        log('Connecting to OPC UA server...');
        await machine.connect();

        log('✅ Connected successfully!');
        updateSessionDisplay(); // Update session info after successful connection
        window.machine = machine; // Expose for debugging in browser console

    } catch (error) {
        log(`❌ Connection failed: ${error.message}`);

        if (error.message.includes('Certificate') || error.message.includes('certificate') ||
            error.message.includes('authority') || error.message.includes('net::err_cert') ||
            error.message.includes('sec_error') || error.message.includes('insecure') ||
            error.message.includes('SSL') || error.message.includes('TLS') ||
            error.message.includes('Certificate/SSL Error') || error.message.includes('Certificate/Authority Error')) {

            log('🔐 SSL/Certificate Issue: Opening certificate acceptance page...');
            const protocol = document.getElementById('protocol').value;
            const host = document.getElementById('host').value;
            const port = parseInt(document.getElementById('port').value);
            const baseUrl = `${protocol}://${host}:${port}`;

            // Automatically open the certificate acceptance page in a new tab
            const certWindow = window.open(baseUrl, '_blank');

            if (certWindow) {
                log(`✅ Opened certificate page in new tab: ${baseUrl}`);
                showCertificateInfo();
                log('📋 Please follow the instructions above to accept the certificate');
            } else {
                log('⚠️ Popup blocked! Manually open this URL to accept the certificate:');
                showCertificateInfo();

                const logElement = document.getElementById('log');
                const linkElement = document.createElement('a');
                linkElement.href = baseUrl;
                linkElement.target = '_blank';
                linkElement.textContent = `🔗 ${baseUrl}`;
                linkElement.style.color = '#007bff';
                linkElement.style.textDecoration = 'underline';

                const timestamp = new Date().toLocaleTimeString();
                logElement.innerHTML += `[${timestamp}] `;
                logElement.appendChild(linkElement);
                logElement.innerHTML += '\n';
                logElement.scrollTop = logElement.scrollHeight;
            }
        } else if (error.message.includes('fetch')) {
            log('💡 CORS Issue: Your mapp Connect server needs CORS headers');
            log('💡 Add these headers to your OPC UA server responses:');
            log('   Access-Control-Allow-Origin: *');
            log('   Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
            log('   Access-Control-Allow-Headers: Content-Type, Authorization');
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

window.disconnect = async function () {
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

window.addVariable = function () {
    if (machine) {
        try {
            log('Adding TestStruct variable...');
            machine.setDefaultNamespace('ns=5;s=');
            machine.initCyclicRead('::demo:test', (value) => {
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

window.readVariable = async function () {
    if (machine) {
        log('📖 Read Variable Demo');
        log('===================');

        // Read and increment demo
        log('🔍 Reading current value...');

        machine.readVariable('::demo:test_arrays.New_Member1.ints[0]')
            .then(value1 => {
                log(`✅ Successfully read ::demo:test_arrays.New_Member1.ints[0] = ${value1}`);

                const newValue = value1 + 10;
                log(`📝 Writing incremented value: ${newValue}`);

                return machine.writeVariable('::demo:test_arrays.New_Member1.ints[0]', newValue)
                    .then(() => {
                        log(`✅ Successfully wrote new value: ${newValue}`);

                        log('🔍 Reading back to verify...');
                        return machine.readVariable('::demo:test_arrays.New_Member1.ints[0]');
                    })
                    .then(value2 => {
                        log(`✅ Successfully read back: ${value2}`);

                        if (value2 === newValue) {
                            log(`🎉 Read/Write/Verify cycle completed successfully! ${value1} → ${newValue} → ${value2}`);
                        } else {
                            log(`⚠️ Value mismatch after write: Expected ${newValue}, got ${value2}`);
                        }
                    })
                    .catch(error => {
                        log(`❌ Write or verify failed: ${error.message}`);
                    });
            })
            .catch(error => {
                log(`❌ Initial read failed for ::demo:test_arrays.New_Member1.ints[0]: ${error.message}`);
            });
    }
};

// Test function to demonstrate smart error handling
// Error Policy Testing Functions
window.setErrorPolicy = function() {
    if (!machine) {
        log('❌ Not connected to machine');
        return;
    }
    
    const errorPolicy = document.getElementById('errorPolicy').value;
    machine.setErrorPolicy(errorPolicy);
    log(`✅ Error policy set to: ${errorPolicy}`);
    
    // Clear previous results
    document.getElementById('errorTestResults').innerHTML = '';
};

window.testErrorHandling = async function() {
    if (!machine) {
        log('❌ Not connected to machine');
        return;
    }
    
    const resultsDiv = document.getElementById('errorTestResults');
    resultsDiv.innerHTML = '<h4>Error Handling Test Results:</h4>';
    
    const currentPolicy = document.getElementById('errorPolicy').value;
    
    resultsDiv.innerHTML += `<p><strong>Testing with policy:</strong> ${currentPolicy}</p>`;
    
    try {
        log(`🧪 Testing error handling with policy: ${currentPolicy}`);
        
        // Test 1: Try to write to a nonexistent variable
        resultsDiv.innerHTML += '<p><strong>Test 1:</strong> Writing to nonexistent variable...</p>';
        const result1 = await machine.writeVariable('nonexistent.test.variable', 123);
        resultsDiv.innerHTML += `<p>✅ Test 1 Result: ${result1} (no error thrown)</p>`;
        
        // Test 2: Try to read a nonexistent variable  
        resultsDiv.innerHTML += '<p><strong>Test 2:</strong> Reading nonexistent variable...</p>';
        const result2 = await machine.readVariable('another.nonexistent.variable');
        resultsDiv.innerHTML += `<p>✅ Test 2 Result: ${result2} (no error thrown)</p>`;
        
        resultsDiv.innerHTML += '<p><strong>Summary:</strong> All operations completed gracefully. Check console for warning messages.</p>';
        
    } catch (error) {
        resultsDiv.innerHTML += `<p>❌ Error caught: ${error.message}</p>`;
        resultsDiv.innerHTML += '<p><strong>Note:</strong> This indicates strict mode or an unexpected error.</p>';
    }
};

window.testWithUserCatch = function() {
    if (!machine) {
        log('❌ Not connected to machine');
        return;
    }
    
    const resultsDiv = document.getElementById('errorTestResults');
    resultsDiv.innerHTML = '<h4>User .catch() Handler Test:</h4>';
    
    const currentPolicy = document.getElementById('errorPolicy').value;
    resultsDiv.innerHTML += `<p><strong>Testing with policy:</strong> ${currentPolicy}</p>`;
    
    log(`🧪 Testing user .catch() handlers with policy: ${currentPolicy}`);
    
    // In the new simplified approach, .catch() handlers will always get the cached value
    // because we always resolve with cached values instead of rejecting
    resultsDiv.innerHTML += '<p><strong>Test:</strong> Writing with user .catch() handler...</p>';
    
    machine.writeVariable('test.nonexistent.variable', 999)
        .then((result) => {
            resultsDiv.innerHTML += `<p>✅ .then() called with result: ${result}</p>`;
            resultsDiv.innerHTML += '<p><strong>Note:</strong> In the simplified approach, promises always resolve with cached values instead of rejecting.</p>';
            log('✅ User .then() called - operation resolved with cached value');
        })
        .catch((error) => {
            resultsDiv.innerHTML += `<p>❌ .catch() called with error: ${error.message}</p>`;
            resultsDiv.innerHTML += '<p><strong>Note:</strong> This should only happen in strict mode.</p>';
            log(`❌ User .catch() called - ${error.message}`);
        });
};

window.writeVariable = async function () {
    if (machine) {
        const operationTracker = { successCount: 0, completedOperations: 0 };
        const totalOperations = 5;

        log('📝 Complex Object Writing Demo');
        log('==============================');
        log('Note: Using smart error handling - user .catch() handlers work, graceful fallback when none provided');
        log('');

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
        log('This will be automatically decomposed into individual variable writes...');

        // Operation 1: Complex object write
        machine.writeVariable('::demo:test', complexValue)
            .then(() => {
                log('✅ Complex TestStruct written successfully using batch write');
            })
            .catch(error => {
                log(`❌ Failed to write complex TestStruct (::demo:test): ${error.message}`);
            })

        log('');
        log('📊 Simple Value Writing Demo');
        log('============================');

        // Operation 2: Global variable write
        log('Writing simple value to global gtest.myvalue.x = 25.5...');
        machine.writeVariable('gtest.myvalue.x', 25.5)
            .catch(error => {
                log(`❌ Failed to write global variable (gtest.myvalue.x): ${error.message}`);
            })
            .then((x,y,z) => {
                log('✅ Global variable (gtest.myvalue.x) written successfully');
            })

        log('');
        log('🔢 Primitive Types Demo');
        log('======================');

        // Operation 3: Boolean write
        log('Writing boolean: ::demo:test.command = true');
        machine.writeVariable('::demo:test.command', true)
            .then(() => {
                log('✅ Boolean (::demo:test.command) written successfully');
            })
            .catch(error => {
                log(`❌ Failed to write boolean (::demo:test.command): ${error.message}`);
            })

        // Operation 4: String write
        log('Writing string: ::demo:test.struct1.struct1.member3 = "Demo System"');
        machine.writeVariable('::demo:test.struct1.struct1.member3', 'Demo System')
            .then(() => {
                log('✅ String (::demo:test.struct1.struct1.member3) written successfully');
            })
            .catch(error => {
                log(`❌ Failed to write string (::demo:test.struct1.struct1.member3): ${error.message}`);
            })

        // Operation 5: Float write
        log('Writing float: ::demo:test.slider = 88.8');
        machine.writeVariable('::demo:test.slider', 88.8)
            .then(() => {
                log('✅ Float (::demo:test.slider) written successfully');
            })
            .catch(error => {
                log(`❌ Failed to write float (::demo:test.slider): ${error.message}`);
            })

        // Summary
        log('');
        log('📊 Write Demo Summary');
        log('====================');


    }
};

window.writeArrayVariable = async function () {
    if (machine) {
        log('🔢 Array Element Writing Demo');
        log('============================');

        // Demo 1: Write primitive values to array elements using actual TestArrays structure
        log('1️⃣ Writing primitive values to array elements:');

        // Operation 1: First array element write
        log('   Writing ::demo:test_arrays.testArrayStruct[0].member1 = 100');
        machine.writeVariable('::demo:test_arrays.testArrayStruct[0].member1', 100)
            .then(() => {
                log('   ✅ Primitive array element (testArrayStruct[0].member1) written successfully');
            })
            .catch(error => {
                log(`   ❌ Failed to write primitive array element (testArrayStruct[0].member1): ${error.message}`);
            })

        // Operation 2: Second array element write
        log('   Writing ::demo:test_arrays.testArrayStruct[1].member1 = 200');
        machine.writeVariable('::demo:test_arrays.testArrayStruct[1].member1', 200)
            .then(() => {
                log('   ✅ Second primitive array element (testArrayStruct[1].member1) written successfully');
            })
            .catch(error => {
                log(`   ❌ Failed to write second primitive array element (testArrayStruct[1].member1): ${error.message}`);
            })

        // Demo 2: Write complex objects to array elements
        log('2️⃣ Writing complex objects to array elements:');

        const complexObject = {
            member1: 999,
            member2: 100,
        };

        log('   Complex object to write:');
        log(`   ${JSON.stringify(complexObject, null, 6)}`);

        // Operation 3: Complex object write
        log('   Writing ::demo:test_arrays.testArrayStruct[0] = complexObject');
        machine.writeVariable('::demo:test_arrays.testArrayStruct[0]', complexObject)
            .then(() => {
                log('   ✅ Complex object (testArrayStruct[0]) written successfully');
                log('     This was decomposed into individual property writes:');
                log('     - ::demo:test_arrays.testArrayStruct[0].member1 = 999');
                log('     - ::demo:test_arrays.testArrayStruct[0].member2 = 100');
            })
            .catch(error => {
                log(`   ❌ Failed to write complex object to array (testArrayStruct[0]): ${error.message}`);
            });

        // Demo 3: Write to 2D array of complex structures
        log('3️⃣ Writing to 2D array of complex structures:');

        // Operation 4: First 2D array write
        log('   Writing ::demo:test_arrays.doubleArray[0,0] = {member1: 100, member2: 0, member3: "First element"}');
        machine.writeVariable('::demo:test_arrays.doubleArray[0,0]', {
            member1: 100,
            member2: 0,
            member3: 'First element'
        })
            .then(() => {
                log('   ✅ Complex structure (doubleArray[0,0]) written to 2D array successfully');
            })
            .catch(error => {
                log(`   ❌ Failed to write to 2D array (doubleArray[0,0]): ${error.message}`);
            });

        // Operation 5: Second 2D array write
        log('   Writing ::demo:test_arrays.doubleArray[1,2] = {member1: 120, member2: 0, member3: "Second element"}');
        machine.writeVariable('::demo:test_arrays.doubleArray[1,2]', {
            member1: 120,
            member2: 0,
            member3: 'Second element'
        })
            .then(() => {
                log('   ✅ Another complex structure (doubleArray[1,2]) written to 2D array successfully');
            })
            .catch(error => {
                log(`   ❌ Failed to write to 2D array (doubleArray[1,2]): ${error.message}`);
            });

        // Demo 4: Mixed operations with 2D complex array
        log('4️⃣ Mixed operations demo:');
        log('   Modifying individual elements within the row:');

        // Operation 6: First mixed operation
        machine.writeVariable('::demo:test_arrays.doubleArray[0,0]', {
            member1: 999,
            member2: 101,
            member3: 'Updated'
        })
            .then(() => {
                log('   ✅ doubleArray[0,0] = {member1: 999, ...} written successfully');
            })
            .catch(error => {
                log(`   ❌ Failed to update doubleArray[0,0]: ${error.message}`);
            });

        // Operation 7: Second mixed operation  
        machine.writeVariable('::demo:test_arrays.doubleArray[0,3]', {
            member1: 777,
            member2: -1,
            member3: 'Final'
        })
            .then(() => {
                log('   ✅ doubleArray[0,3] = {member1: 777, ...} written successfully');
            })
            .catch(error => {
                log(`   ❌ Failed to update doubleArray[0,3]: ${error.message}`);
            });

        // Demo 5: Global 2D array operations
        log('5️⃣ Global 2D array operations:');

        // Operation 8: First global operation
        log('   Writing to global testarray.doubleArray[2,1] = {member1: 777, member2: 984, member3: "Global structure"}');
        machine.writeVariable('testarray.doubleArray[2,1]', {
            member1: 777,
            member2: 984,
            member3: 'Global structure'
        })
            .then(() => {
                log('   ✅ Global 2D array element (testarray.doubleArray[2,1]) written successfully');
            })
            .catch(error => {
                log(`   ❌ Failed to write global 2D array element (testarray.doubleArray[2,1]): ${error.message}`);
            });

        // Operation 9: Second global operation
        log('   Writing to global testarray.testArrayStruct[1].member2 = 200');
        machine.writeVariable('testarray.testArrayStruct[1].member2', 200)
            .then(() => {
                log('   ✅ Global struct array member (testarray.testArrayStruct[1].member2) written successfully');
            })
            .catch(error => {
                log(`   ❌ Failed to write global struct array member (testarray.testArrayStruct[1].member2): ${error.message}`);
            });
    }
};

window.runLogicDemo = async function () {
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

function updateSessionDisplay() {
    if (machine) {
        const sessionInfo = machine.getSessionInfo();
        const currentUserEl = document.getElementById('currentUser');
        const currentRolesEl = document.getElementById('currentRoles');

        if (sessionInfo) {
            currentUserEl.textContent = sessionInfo.username || 'anonymous';
            currentRolesEl.textContent = sessionInfo.roles ? sessionInfo.roles.join(', ') : 'No roles';
        } else {
            currentUserEl.textContent = 'Not logged in';
            currentRolesEl.textContent = '-';
        }
    }
}

// User switching functions
window.refreshSessionInfo = function () {
    if (machine) {
        log('🔍 Refreshing session information...');
        updateSessionDisplay();
        const sessionInfo = machine.getSessionInfo();
        if (sessionInfo) {
            log(`Current user: ${sessionInfo.username || 'anonymous'}`);
            log(`User roles: ${sessionInfo.roles ? sessionInfo.roles.join(', ') : 'No roles'}`);
            log(`Session ID: ${sessionInfo.sessionId}`);
            log(`Session timeout: ${sessionInfo.sessionTimeout}ms`);
        } else {
            log('❌ No session information available');
        }
    }
};

window.switchToOperator = async function () {
    if (machine) {
        try {
            log('👤 Switching to operator user...');
            await machine.changeUser('operator', 'operator123');
            updateSessionDisplay();
            log('✅ Successfully switched to operator user');
        } catch (error) {
            log(`❌ Failed to switch to operator: ${error.message}`);
        }
    }
};

window.switchToAnonymous = async function () {
    if (machine) {
        try {
            log('🕶️ Switching to anonymous user...');
            await machine.changeUser(); // No parameters = anonymous
            updateSessionDisplay();
            log('✅ Successfully switched to anonymous user');
        } catch (error) {
            log(`❌ Failed to switch to anonymous: ${error.message}`);
        }
    }
};

window.switchBackToAdmin = async function () {
    if (machine) {
        try {
            log('👑 Switching back to admin user...');
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            await machine.changeUser(username, password);
            updateSessionDisplay();
            log('✅ Successfully switched back to admin user');
        } catch (error) {
            log(`❌ Failed to switch back to admin: ${error.message}`);
        }
    }
};

// Initialize the demo
function initializeDemo() {
    // Initial setup
    log('🌐 lux-opcua Browser Demo loaded');
    log('💡 This demonstrates cross-platform compatibility!');
    updateButtons(false);
    updateStatus('disconnected');
    hideCertificateInfo(); // Hide certificate info initially

    // Set default preset to mapp Connect 8443
    document.getElementById('preset').value = 'mappConnect8443';
    document.getElementById('preset').dispatchEvent(new Event('change'));

    // Add preset change handler
    document.getElementById('preset').addEventListener('change', function () {
        const preset = this.value;
        const protocolSelect = document.getElementById('protocol');
        const hostInput = document.getElementById('host');
        const portInput = document.getElementById('port');
        const wsProtocolSelect = document.getElementById('wsProtocol');
        const apiPathSelect = document.getElementById('apiPath');
        const usernameInput = document.getElementById('username');
        const passwordInput = document.getElementById('password');

        switch (preset) {
            case 'mappConnect8443':
                protocolSelect.value = 'https';
                hostInput.value = '127.0.0.1';
                portInput.value = '8443';
                wsProtocolSelect.value = 'wss';
                apiPathSelect.value = '/api/1.0';
                usernameInput.value = 'dev';
                passwordInput.value = 'dev';
                log('🔧 Preset: mapp Connect HTTPS (8443) with /api/1.0');
                break;
            case 'mappConnect80':
                protocolSelect.value = 'http';
                hostInput.value = '127.0.0.1';
                portInput.value = '80';
                wsProtocolSelect.value = 'ws';
                apiPathSelect.value = '/opcua';
                log('🔧 Preset: mapp Connect HTTP (80) with /opcua');
                break;
            case '127.0.0.1443':
                protocolSelect.value = 'https';
                hostInput.value = '127.0.0.1';
                portInput.value = '443';
                wsProtocolSelect.value = 'wss';
                apiPathSelect.value = '/api/1.0';
                log('🔧 Preset: Local HTTPS (443) with /api/1.0');
                break;
            case '127.0.0.180':
                protocolSelect.value = 'http';
                hostInput.value = '127.0.0.1';
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
    document.getElementById('protocol').addEventListener('change', function () {
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

    document.getElementById('wsProtocol').addEventListener('change', function () {
        const wsProtocol = this.value;
        log(`🔌 WebSocket protocol changed to: ${wsProtocol.toUpperCase()}`);
    });

    document.getElementById('apiPath').addEventListener('change', function () {
        const apiPath = this.value;
        const customGroup = document.getElementById('customApiPathGroup');

        if (apiPath === 'custom') {
            customGroup.classList.add('show');
            log('📝 Custom API path selected - enter your path below');
        } else {
            customGroup.classList.remove('show');
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
                // log(`  └─1 demo:test = ${JSON.stringify(value)}`);
            });

            // Explicit task local format
            log('📍 Explicit task local: ::demo:test');
            machine.initCyclicRead('::demo:test', (value) => {
                // log(`  └─2 ::demo:test = ${JSON.stringify(value)}`);
            });

            // Array Types
            log('📍 Arrays in task ::demo:test_arrays');
            machine.initCyclicRead('::demo:test_arrays', (value) => {
                // log(`  └─2 ::demo:test_arrays = ${JSON.stringify(value)}`);
            });

            // Global variables (no colons)
            log('🌍 Global: gtest');
            machine.initCyclicRead('gtest', (value) => {
                // log(`  └─ gtest = ${JSON.stringify(value)}`);
            });

            // Global with structure
            log('🌍 Global structure: gtest.struct1');
            machine.initCyclicRead('gtest.struct1', (value) => {
                // log(`  └─ gtest.struct1 = ${JSON.stringify(value)}`);
            });

            // Explicit global format
            log('🌍 Explicit global: ::gtest.struct2');
            machine.initCyclicRead('::gtest.struct2', (value) => {
                // log(`  └─ ::gtest.struct2 = ${JSON.stringify(value)}`);
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
