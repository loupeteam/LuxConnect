# Mapp Connect REST API Tester

This is a simple webpage that allows you to test the mapp Connect REST API for reading and writing OPC UA variables.

## Files

- `api-test.html` - The main testing webpage
- `documentation/` - Contains the API documentation and OpenAPI specification

## Features

The API tester provides the following functionality:

### 1. Server Configuration
- Configure the mapp Connect server host, port, and protocol
- Set the OPC UA server URL

### 2. Authentication
- Authenticate with the mapp Connect server
- Support for both anonymous and user/password authentication
- Displays authentication status and user roles

### 3. OPC UA Session Management
- Create OPC UA sessions to the server
- Get session information
- Delete sessions when done

### 4. Variable Operations
- **Read Variables**: Read any OPC UA node attribute (Value, DisplayName, Description, etc.)
- **Write Variables**: Write values to OPC UA variables with support for different data types
- Support for string, number, and boolean values

### 5. Node Browsing
- Browse the OPC UA address space
- Navigate through the server's node hierarchy
- View node references and properties

### 6. Quick Test Nodes
- Predefined common node IDs for quick testing
- Server status and time nodes
- Application and simulation nodes

## How to Use

1. **Open the HTML file** in a web browser (preferably Chrome/Firefox)

2. **Configure Server Settings**:
   - Set the correct host and port for your mapp Connect server
   - Choose HTTP or HTTPS protocol
   - Update the OPC UA server URL if needed

3. **Authenticate**:
   - Click "Authenticate" for anonymous access
   - Or enter username/password for authenticated access

4. **Create OPC UA Session**:
   - Click "Create OPC UA Session" to establish connection
   - Wait for successful session creation

5. **Test Variable Operations**:
   - Enter a valid Node ID (e.g., `ns=6;s=::AsGlobalPV:Variable`)
   - Use "Read Variable" to get current value
   - Use "Write Variable" to set new values

6. **Browse Nodes**:
   - Start with root nodes like `ns=0;i=85` (Objects folder)
   - Browse to find available variables and their node IDs

## Common Node ID Examples

- `ns=0;i=2258` - Server Status
- `ns=0;i=2259` - Server Current Time
- `ns=6;s=::AsGlobalPV:Application` - Application global variables
- `ns=6;s=::Simulation` - Simulation variables
- `ns=0;i=85` - Objects folder (good starting point for browsing)

## Node ID Format

Node IDs follow the OPC UA standard format:
- `ns=X` - Namespace index (0 for OPC UA standard, 6 typically for B&R)
- `i=Y` - Integer identifier
- `s=name` - String identifier

## Troubleshooting

### CORS Issues
If you encounter CORS errors when running from a local file:
1. Use a local web server (e.g., `python -m http.server` or Live Server extension in VS Code)
2. Or configure your browser to allow local file access

### SSL Certificate Issues
For HTTPS connections with self-signed certificates:
1. Navigate to the API URL directly in your browser first
2. Accept the security warning/certificate
3. Then use the API tester

### Common Error Codes
- **401 Unauthorized**: Check authentication credentials
- **404 Not Found**: Verify the node ID exists and is accessible
- **403 Forbidden**: User lacks permission to access the resource
- **400 Bad Request**: Check the request format and parameters

## API Documentation

For complete API documentation, see the files in the `documentation/` folder:
- `openapi.json` - Complete OpenAPI 3.0 specification
- `mappConnectDocu.html` - Interactive API documentation

## Security Notes

- Use HTTPS in production environments
- Implement proper authentication and authorization
- Be cautious when writing to production variables
- Test with simulation variables first

## Browser Compatibility

This tool works best with modern browsers:
- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

Older browsers may have issues with async/await syntax and fetch API.
