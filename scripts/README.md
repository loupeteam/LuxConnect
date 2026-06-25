# Scripts Directory

This directory contains utility scripts for development, testing, and serving the LuxConnect library.

## Files Overview

### 🌐 **Server Scripts**

#### `serve-demo.js` - Main Demo Server
- **Purpose**: Full-featured development server for browser demos
- **Port**: 3000
- **Features**: 
  - CORS proxy for OPC UA requests (`/opcua/` → `localhost:8443`)
  - Static file serving from project root
  - Security checks against directory traversal
- **Usage**: 
  - `npm run demo` (if configured)
  - VS Code Task: "Start Demo Server"
  - Direct: `node scripts/serve-demo.js`
- **Default Route**: `/examples/browser-demo.html`

#### `serve-demo-simple.js` - Simplified Demo Server  
- **Purpose**: Basic static file server for browser demos
- **Port**: 3000
- **Features**:
  - Simple static file serving
  - Basic CORS headers
  - Minimal functionality
- **Usage**:
  - VS Code Task: "Start Simple Demo Server" 
  - Direct: `node scripts/serve-demo-simple.js`
- **Default Route**: `/examples/browser-demo.html`
- **Status**: ⚠️ Consider removing (redundant with main demo server)

#### `serve-browser-tests.js` - Browser Test Server
- **Purpose**: HTTP server for browser testing (solves CORS issues)
- **Port**: 8080
- **Features**:
  - Serves browser tests without file:// protocol restrictions
  - ES module support with proper MIME types
  - CORS headers for cross-origin requests
- **Usage**:
  - `npm run test:browser`
  - `npm run test:browser:open`
  - Direct: `node scripts/serve-browser-tests.js`
- **Default Route**: `/tests/browser/browser-standalone.html`

### 🩺 **Diagnostics Scripts**

#### `diagnose-connection.js` - Connection Diagnostics
- **Purpose**: Pinpoint LuxConnect ↔ mapp Connect ↔ OPC UA connection problems
- **Checks**:
  - **Live probes** (local ARsim or remote PLC): mapp Connect port listening,
    REST API reachable + `/api/1.0/*` authorized (the 403 gotcha), optional
    authenticated `/auth`, OPC UA C/S port listening
  - **Static scan** (`--project <path>`): `OpcUaCs=1`, the `/api/1.0/*` endpoint,
    SSL config references resolve, certificate linked, `mappConnect` registered in
    `Cpu.pkg`, variables/whitelist present
- **Usage**:
  - `npm run diagnose -- --project ../MyAsProject`
  - `npm run diagnose -- --host 192.168.1.100 --user admin --pass secret`
  - Direct: `node scripts/diagnose-connection.js --help`
- **Output**: PASS/WARN/FAIL per check, each FAIL citing the matching README step
- **Exit code**: non-zero if any check fails (CI-friendly)
- **Dependencies**: Node stdlib only

### 🧪 **Testing Scripts**

#### `validate-browser-tests.js` - Browser Test Validator
- **Purpose**: Automated validation that browser testing setup works
- **Features**:
  - Starts browser test server
  - Validates CORS resolution
  - Confirms ES module loading
  - Automatic cleanup after testing
- **Usage**:
  - `npm run test:validate`
  - Direct: `node scripts/validate-browser-tests.js`

## Architecture Notes

### Path Resolution
All scripts now properly handle being in the `scripts/` subdirectory:
- Use `path.resolve(__dirname, '..')` to find project root
- Serve files relative to project root, not script location
- Security checks prevent directory traversal

### CORS Handling
- **Demo servers**: Include CORS headers for development
- **Browser test server**: Specifically designed to solve file:// protocol CORS issues
- **OPC UA proxy**: Main demo server proxies OPC UA requests to avoid CORS

### Integration Points

#### Package.json Scripts
```json
{
  "test:browser": "node scripts/serve-browser-tests.js",
  "test:browser:open": "start http://localhost:8080 && node scripts/serve-browser-tests.js",
  "test:validate": "node scripts/validate-browser-tests.js"
}
```

#### VS Code Tasks  
- "Start Demo Server" → `scripts/serve-demo.js`
- "Start Simple Demo Server" → `scripts/serve-demo-simple.js`
- "Stop Demo Server" → Kills processes matching `*serve-demo*`

## Development Workflow

### For Library Development
1. Use main demo server: VS Code Task "Start Demo Server"
2. Navigate to: `http://localhost:3000/`
3. Test with real OPC UA server connections

### For Browser Testing
1. Build library: `npm run build`
2. Start test server: `npm run test:browser`
3. Navigate to: `http://localhost:8080/tests/browser/browser-standalone.html`
4. Or use automated validation: `npm run test:validate`

### For CI/CD
- All scripts designed to work in automated environments
- No external dependencies beyond Node.js standard library
- Proper error handling and exit codes

## File Organization Benefits

✅ **Clean Root Directory**: No clutter of serve/utility scripts  
✅ **Logical Grouping**: All scripts in dedicated folder  
✅ **Easy Discovery**: Clear naming convention  
✅ **Maintainability**: Related files grouped together  
✅ **Scalability**: Room for additional scripts as project grows
