#!/usr/bin/env node

/**
 * Simple HTTP server for testing the browser demo
 * Run with: node scripts/serve-demo.js
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules - adjust for scripts folder
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const PORT = 3000;

// MIME types for different file extensions
const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
};

function serveFile(filePath, response) {
    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                response.writeHead(404);
                response.end('File not found');
            } else {
                response.writeHead(500);
                response.end('Server error: ' + error.code);
            }
        } else {
            const ext = path.extname(filePath).toLowerCase();
            const contentType = mimeTypes[ext] || 'application/octet-stream';
            
            response.writeHead(200, { 
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            });
            response.end(content);
        }
    });
}

const server = http.createServer((request, response) => {
    let filePath = path.join(projectRoot, request.url);
    
    // Serve node_modules files for dependencies
    if (request.url.startsWith('/node_modules/')) {
        // Allow serving specific packages from node_modules
        filePath = path.join(projectRoot, request.url);
    }
    
    // Proxy OPC UA requests to avoid CORS issues
    if (request.url.startsWith('/opcua/')) {
        proxyToOpcuaServer(request, response);
        return;
    }
    
    // Default to browser demo
    if (request.url === '/' || request.url === '') {
        filePath = path.join(projectRoot, 'examples', 'browser-demo.html');
    }
    
    // Handle directory requests
    if (filePath.endsWith('/')) {
        filePath = path.join(filePath, 'index.html');
    }
    
    // Security check - prevent directory traversal
    const resolvedPath = path.resolve(filePath);
    
    if (!resolvedPath.startsWith(projectRoot)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
    }
    
    console.log(`${new Date().toISOString()} - ${request.method} ${request.url} -> ${path.relative(projectRoot, filePath)}`);
    
    serveFile(filePath, response);
});

function proxyToOpcuaServer(request, response) {
    const opcuaHost = 'localhost';
    const opcuaPort = 8443;
    
    // Parse the URL and create proxy request
    const proxyOptions = {
        hostname: opcuaHost,
        port: opcuaPort,
        path: request.url,
        method: request.method,
        headers: {
            ...request.headers,
            'host': `${opcuaHost}:${opcuaPort}` // Override host header
        }
    };
    
    console.log(`${new Date().toISOString()} - PROXY ${request.method} ${request.url} -> http://${opcuaHost}:${opcuaPort}${request.url}`);
    
    const proxyReq = http.request(proxyOptions, (proxyRes) => {
        // Copy response headers and add CORS headers
        response.writeHead(proxyRes.statusCode, {
            ...proxyRes.headers,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Expose-Headers': 'Authorization'
        });
        
        // Pipe the response
        proxyRes.pipe(response);
    });
    
    proxyReq.on('error', (error) => {
        console.error(`Proxy error: ${error.message}`);
        response.writeHead(500, {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
        });
        response.end(JSON.stringify({ 
            error: 'OPC UA Server connection failed', 
            details: error.message,
            suggestion: 'Make sure your mapp Connect OPC UA server is running on localhost:80'
        }));
    });
    
    // Handle request body for POST/PUT requests
    if (request.method === 'POST' || request.method === 'PUT') {
        request.pipe(proxyReq);
    } else {
        proxyReq.end();
    }
}

server.listen(PORT, () => {
    console.log('🚀 Development server started!');
    console.log(`📂 Serving files from: ${projectRoot}`);
    console.log(`🌐 Browser demo: http://localhost:${PORT}/`);
    console.log(`📖 Or directly: http://localhost:${PORT}/examples/browser-demo.html`);
    console.log('');
    console.log('📋 Usage:');
    console.log('  1. Make sure your mapp Connect OPC UA server is running on localhost:80');
    console.log('  2. Open the browser demo URL above');
    console.log('  3. Configure connection settings and click Connect');
    console.log('');
    console.log('✅ CORS Proxy: Enabled for /opcua/ requests');
    console.log('💡 WebSocket: Will connect directly to localhost:80 (may need CORS config)');
    console.log('');
    console.log('Press Ctrl+C to stop the server');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down server...');
    server.close(() => {
        console.log('✅ Server stopped');
        process.exit(0);
    });
});
