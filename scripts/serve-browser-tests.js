#!/usr/bin/env node
/**
 * Simple HTTP server for serving browser tests
 * Avoids CORS issues with file:// protocol
 */

import { createServer } from 'http';
import { readFile, stat } from 'fs/promises';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
const PORT = 8080;

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.ts': 'text/typescript'
};

async function serveFile(filePath, res) {
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      res.writeHead(404);
      res.end('File not found');
      return;
    }

    const ext = extname(filePath);
    const mimeType = mimeTypes[ext] || 'text/plain';
    
    const content = await readFile(filePath);
    
    res.writeHead(200, {
      'Content-Type': mimeType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    
    res.end(content);
  } catch (error) {
    console.error('Error serving file:', filePath, error.message);
    res.writeHead(500);
    res.end('Server error');
  }
}

const server = createServer(async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  let requestPath = req.url;
  
  // Default to browser test HTML
  if (requestPath === '/' || requestPath === '') {
    requestPath = '/tests/browser/browser-standalone.html';
  }
  
  // Remove query parameters
  requestPath = requestPath.split('?')[0];
  
  // Security: prevent directory traversal
  if (requestPath.includes('..')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  
  const filePath = join(projectRoot, requestPath);
  await serveFile(filePath, res);
});

server.listen(PORT, () => {
  console.log(`🚀 Browser test server running at http://localhost:${PORT}`);
  console.log(`📋 Test page: http://localhost:${PORT}/tests/browser/browser-standalone.html`);
  console.log(`🛑 Press Ctrl+C to stop`);
});

process.on('SIGINT', () => {
  console.log('\n👋 Shutting down browser test server...');
  server.close(() => {
    process.exit(0);
  });
});
