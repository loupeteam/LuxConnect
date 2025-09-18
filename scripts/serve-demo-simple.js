#!/usr/bin/env node

/**
 * Simple HTTP server for testing the browser demo
 * Run with: node scripts/serve-demo-simple.js
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

server.listen(PORT, () => {
    console.log('🚀 Simple Development server started!');
    console.log(`📂 Serving files from: ${projectRoot}`);
    console.log(`🌐 Browser demo: http://localhost:${PORT}/`);
    console.log(`📖 Or directly: http://localhost:${PORT}/examples/browser-demo.html`);
    console.log('');
    console.log('📋 Usage:');
    console.log('  1. Make sure your mapp Connect OPC UA server is running on localhost:80');
    console.log('  2. Open the browser demo URL above');
    console.log('  3. Configure connection settings and click Connect');
    console.log('');
    console.log('💡 CORS Solutions:');
    console.log('   Option 1: Configure your mapp Connect server to allow CORS');
    console.log('   Option 2: Start Chrome with --disable-web-security --disable-features=VizDisplayCompositor');
    console.log('   Option 3: Use a browser extension to disable CORS (for development only)');
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
