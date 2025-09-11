# Testing Framework for LuxConnect

This directory contains comprehensive tests for the LuxConnect OPC UA library, designed to work in both Node.js and browser environments.

## Test Structure

```
tests/
├── shared/               # Cross-platform tests (Node.js and browser compatible)
│   ├── opcua-machine.test.ts      # Core OpcuaMachine functionality
│   ├── variable-manager.test.ts   # Variable registration and management
│   ├── variable-parsing.test.ts   # Variable name parsing logic
│   └── platform-detection.test.ts # Environment detection
├── node/                # Node.js specific tests
│   └── node-specific.node.test.ts # Node.js WebSocket and filesystem features
├── browser/             # Browser specific tests
│   ├── browser-specific.browser.test.ts # Browser WebSocket and DOM features
│   └── browser-standalone.html    # Standalone browser test runner
└── fixtures/            # Test data and utilities
    └── test-data.ts     # Mock variables and test configurations
```

## Running Tests

### All Tests (Node.js environment)
```bash
npm test
# or
npm run test:run
```

### Watch Mode
```bash
npm run test:watch
```

### Node.js Only
```bash
npm run test:node
```

### Browser Tests
```bash
# Start HTTP server for browser testing (avoids CORS issues)
npm run test:browser

# Or start server and open browser automatically  
npm run test:browser:open

# Then navigate to: http://localhost:8080/tests/browser/browser-standalone.html
# Server scripts located in: scripts/serve-browser-tests.js
```

## Test Categories

### Cross-Platform Tests (`shared/`)
These tests validate core functionality that works identically in both Node.js and browser:
- Variable name parsing and validation
- OpcuaMachine initialization and configuration
- Variable registration without connection
- Proxy behavior for property access
- Read group management
- Platform detection

### Node.js Specific Tests (`node/`)
Tests for Node.js-only features:
- File system operations
- Node.js WebSocket implementation
- Server-side specific functionality

### Browser Tests (`browser/`)
Tests for browser-specific features:
- Browser WebSocket API
- DOM integration
- Client-side specific functionality

## Test Data

Test fixtures are stored in `fixtures/test-data.ts` and include:
- Mock variable configurations
- Sample hierarchical variable structures
- Test connection configurations

## Framework Details

### Node.js Testing
- **Framework**: Vitest
- **Environment**: Node.js
- **Features**: Full API testing, mocking, coverage reporting

### Browser Testing
- **Framework**: Custom lightweight test runner with HTTP server
- **Environment**: Browser (Chrome, Firefox, Safari, Edge) via http://localhost:8080
- **Features**: DOM-based test results, WebSocket compatibility checks, CORS-free module loading

## Test Validation

The tests validate:
1. **Architecture Consistency**: Subscription manager refactoring using VariablePathParser
2. **API Correctness**: Proper variable registration and retrieval
3. **Error Handling**: Graceful handling of invalid inputs
4. **Cross-Platform Compatibility**: Same behavior in Node.js and browser
5. **Connection Management**: Proper state management without active connections

## CI/CD Integration

Tests are designed to run in continuous integration environments:
- No external dependencies required for basic tests
- Mock WebSocket connections for offline testing
- Deterministic test results

## Adding New Tests

1. **Cross-platform tests**: Add to `shared/` directory
2. **Platform-specific tests**: Add to appropriate `node/` or `browser/` directory
3. **Test data**: Update `fixtures/test-data.ts` as needed
4. **Follow naming conventions**: `*.test.ts` for Vitest, `*.browser.test.ts` for browser-specific

## Troubleshooting

### Common Issues
1. **Import errors**: Ensure TypeScript compilation is up to date (`npm run build`)
2. **WebSocket errors**: Tests use mock connections, actual server connection not required
3. **Browser compatibility**: Use `npm run test:browser` for browser-specific issues

### Debug Mode
Run tests with verbose output:
```bash
npx vitest run --reporter=verbose
```
