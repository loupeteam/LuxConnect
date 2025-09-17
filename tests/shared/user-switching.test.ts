import { describe, it, expect, beforeEach } from 'vitest';
import { OpcuaConnection } from '../../src/connection.js';
import { ConnectionConfig } from '../../src/types.js';

describe('User Switching', () => {
  let connection: OpcuaConnection;
  
  const mockConfig: ConnectionConfig = {
    host: 'localhost',
    port: 8443,
    protocol: 'https',
    username: 'admin',
    password: 'admin123'
  };

  beforeEach(() => {
    connection = new OpcuaConnection(mockConfig);
  });

  it('should have changeUser method available', () => {
    expect(typeof connection.changeUser).toBe('function');
  });

  it('should reject changeUser when not connected', async () => {
    await expect(connection.changeUser('operator', 'operator123'))
      .rejects
      .toThrow('Not connected to OPC UA server');
  });

  it('should have getSessionInfo method available', () => {
    expect(typeof connection.getSessionInfo).toBe('function');
  });

  it('should return null for session info when not connected', () => {
    expect(connection.getSessionInfo()).toBeNull();
  });
});