import { describe, it, expect, beforeEach } from 'vitest';
import { OpcuaMachine } from '../../src/opcua-machine.js';

describe('OpcuaMachine Variable Name Formatting', () => {
  let machine: OpcuaMachine;

  beforeEach(() => {
    machine = new OpcuaMachine({
      host: 'localhost',
      port: 4840,
    });
  });

  describe('buildNodeId with default settings', () => {
    it('should preserve existing OPC UA nodeIds', () => {
      // Test direct access to private method for unit testing
      const result = (machine as any).buildNodeId('ns=5;s=Temperature', {});
      expect(result).toBe('ns=5;s=Temperature');
    });

    it('should preserve existing nodeIds with different formats', () => {
      const testCases = [
        'ns=1;i=1234',
        'ns=2;s=MyVar',
        'ns=0;i=85' // Standard OPC UA node
      ];

      testCases.forEach(nodeId => {
        const result = (machine as any).buildNodeId(nodeId, {});
        expect(result).toBe(nodeId);
      });
    });

    it('should add default namespace to simple variable names', () => {
      const result = (machine as any).buildNodeId('Temperature', {});
      expect(result).toBe('ns=5;s=::AsGlobalPV:Temperature');
    });

    it('should normalize task-local variables', () => {
      const result = (machine as any).buildNodeId('TaskMain:Speed', {});
      expect(result).toBe('ns=5;s=::TaskMain:Speed');
    });

    it('should handle structured variables', () => {
      const result = (machine as any).buildNodeId('Motor.Status.Running', {});
      expect(result).toBe('ns=5;s=::AsGlobalPV:Motor.Status.Running');
    });

    it('should handle array variables', () => {
      const result = (machine as any).buildNodeId('DataArray[0].Value', {});
      expect(result).toBe('ns=5;s=::AsGlobalPV:DataArray[0].Value');
    });

    it('should use custom namespace from options', () => {
      const result = (machine as any).buildNodeId('Temperature', {
        namespace: 'ns=6;s='
      });
      expect(result).toBe('ns=6;s=::AsGlobalPV:Temperature');
    });

    it('should use explicit nodeId from options', () => {
      const result = (machine as any).buildNodeId('Temperature', {
        nodeId: 'ns=7;s=CustomNodeId'
      });
      expect(result).toBe('ns=7;s=CustomNodeId');
    });

    it('should handle global variable with :: prefix', () => {
      const result = (machine as any).buildNodeId('::gtest.struct2', {});
      expect(result).toBe('ns=5;s=::AsGlobalPV:gtest.struct2');
    });
  });

  describe('buildNodeId with custom defaults', () => {
    beforeEach(() => {
      machine.setDefaultApplication('MyApp');
      machine.setDefaultTask('MainTask');
      machine.setDefaultNamespace('ns=6;s=');
    });

    it('should apply default application to simple variables', () => {
      const result = (machine as any).buildNodeId('Temperature', {});
      // Since Temperature parses as global (AsGlobalPV), and we override default task,
      // it should become MainTask with MyApp application
      expect(result).toBe('ns=6;s=MyApp::MainTask:Temperature');
    });

    it('should apply default application to task variables', () => {
      const result = (machine as any).buildNodeId('ControlTask:Speed', {});
      expect(result).toBe('ns=6;s=MyApp::ControlTask:Speed');
    });

    it('should not modify fully qualified variables', () => {
      const result = (machine as any).buildNodeId('ExistingApp::ExistingTask:Pressure', {});
      expect(result).toBe('ns=6;s=ExistingApp::ExistingTask:Pressure');
    });

    it('should preserve structures with custom defaults', () => {
      const result = (machine as any).buildNodeId('Motor.Status.Running', {});
      expect(result).toBe('ns=6;s=MyApp::MainTask:Motor.Status.Running');
    });

    it('should preserve arrays with custom defaults', () => {
      const result = (machine as any).buildNodeId('DataArray[1,2].Value', {});
      expect(result).toBe('ns=6;s=MyApp::MainTask:DataArray[1,2].Value');
    });
  });

  describe('configuration methods', () => {
    it('should configure default namespace', () => {
      machine.setDefaultNamespace('ns=10;s=');
      const result = (machine as any).buildNodeId('Test', {});
      expect(result).toBe('ns=10;s=::AsGlobalPV:Test');
    });

    it('should auto-append ;s= to namespace if missing', () => {
      machine.setDefaultNamespace('ns=10');
      const result = (machine as any).buildNodeId('Test', {});
      expect(result).toBe('ns=10;s=::AsGlobalPV:Test');
    });

    it('should configure default application', () => {
      machine.setDefaultApplication('CustomApp');
      machine.setDefaultTask('CustomTask');
      
      const result = (machine as any).buildNodeId('Variable', {});
      expect(result).toBe('ns=5;s=CustomApp::CustomTask:Variable');
    });

    it('should configure default task', () => {
      machine.setDefaultTask('BackgroundTask');
      
      const result = (machine as any).buildNodeId('Variable', {});
      expect(result).toBe('ns=5;s=::BackgroundTask:Variable');
    });
  });

  describe('error handling', () => {
    it('should fallback to original name on parse errors', () => {
      // Test with an invalid variable name that might cause parsing to fail
      const result = (machine as any).buildNodeId(':::invalid:::format', {});
      expect(result).toBe('ns=5;s=:::invalid:::format');
    });

    it('should handle empty variable names gracefully', () => {
      const result = (machine as any).buildNodeId('', {});
      // Should either work with parser or fallback to empty string
      expect(result).toMatch(/^ns=5;s=/);
    });
  });
});