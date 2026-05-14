import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpcuaMachine } from '../../src/opcua-machine.js';
import { mockConnectionConfig } from '../fixtures/test-data.js';

// Global state shared across proxy-write tests:
//   globalState[application][task][variable]
//
// This mirrors the structure populated by VariableHierarchy.updateVariable
// when the server sends values.  We mock getGlobalState so we can test the
// proxy write paths without a real OPC UA connection.
const mockGlobalState = {
  AppModule: {
    TaskMain: {
      Speed:   100,
      Torque:  50,
    },
    AsGlobalPV: {
      GlobalTemp: 25,
    },
  },
  OtherApp: {
    TaskB: {
      Pressure: 5,
    },
  },
};

describe('proxy write', () => {
  let machine: OpcuaMachine;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    machine = new OpcuaMachine(mockConnectionConfig);
    vi.spyOn(machine['variableManager'], 'getGlobalState').mockReturnValue(mockGlobalState);
    writeSpy = vi.spyOn(machine, 'writeVariable').mockResolvedValue(undefined);
  });

  // ---------------------------------------------------------------------------
  // machine.MyVar = x  (top-level, uses configured defaults)
  // ---------------------------------------------------------------------------
  describe('machine.Var = x', () => {
    it('calls writeVariable with the bare variable name', () => {
      (machine as any).Speed = 200;
      expect(writeSpy).toHaveBeenCalledWith('Speed', 200);
    });

    it('does not write when value is a function', () => {
      (machine as any).Speed = () => {};
      expect(writeSpy).not.toHaveBeenCalled();
    });

    it('does not write known own properties', () => {
      // Setting a real writable property on the machine should not call writeVariable.
      // We use a known internal field (readGroups is a regular writable Map property).
      (machine as any).readGroups = new Map();
      expect(writeSpy).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // machine[task].Var = x  (task resolved through any app module)
  // ---------------------------------------------------------------------------
  describe('machine[task].Var = x', () => {
    it('writes appModule::task:Var when task is found in one app module', () => {
      const taskProxy = (machine as any).TaskMain;
      expect(taskProxy).toBeDefined();

      taskProxy.Speed = 999;
      expect(writeSpy).toHaveBeenCalledWith('AppModule::TaskMain:Speed', 999);
    });

    it('works for a second task in the same app module', () => {
      const taskProxy = (machine as any).AsGlobalPV;
      taskProxy.GlobalTemp = 30;
      expect(writeSpy).toHaveBeenCalledWith('AppModule::AsGlobalPV:GlobalTemp', 30);
    });

    it('works for a task in a different app module', () => {
      const taskProxy = (machine as any).TaskB;
      taskProxy.Pressure = 10;
      expect(writeSpy).toHaveBeenCalledWith('OtherApp::TaskB:Pressure', 10);
    });

    it('can write a variable that does not yet exist in global state', () => {
      // The setter should forward even unknown variable names — the server decides if valid
      const taskProxy = (machine as any).TaskMain;
      taskProxy.NewVar = 42;
      expect(writeSpy).toHaveBeenCalledWith('AppModule::TaskMain:NewVar', 42);
    });

    it('does not write when value is a function', () => {
      const taskProxy = (machine as any).TaskMain;
      taskProxy.Speed = () => {};
      expect(writeSpy).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // machine[appModule][task].Var = x  (two-level scope access)
  // ---------------------------------------------------------------------------
  describe('machine[appModule][task].Var = x', () => {
    it('writes appModule::task:Var via two-level access', () => {
      const taskProxy = (machine as any).AppModule.TaskMain;
      expect(taskProxy).toBeDefined();

      taskProxy.Speed = 777;
      expect(writeSpy).toHaveBeenCalledWith('AppModule::TaskMain:Speed', 777);
    });

    it('works for OtherApp::TaskB', () => {
      const taskProxy = (machine as any).OtherApp.TaskB;
      taskProxy.Pressure = 20;
      expect(writeSpy).toHaveBeenCalledWith('OtherApp::TaskB:Pressure', 20);
    });

    it('does not write when value is a function', () => {
      const taskProxy = (machine as any).AppModule.TaskMain;
      taskProxy.Speed = () => {};
      expect(writeSpy).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Path consistency: all three access forms produce the same writeVariable call
  // ---------------------------------------------------------------------------
  describe('path consistency across access forms', () => {
    it('machine.Var, machine[task].Var, machine[app][task].Var all agree on path', () => {
      // Top-level uses raw name (defaults applied by buildNodeId server-side)
      (machine as any).Speed = 1;
      expect(writeSpy).toHaveBeenLastCalledWith('Speed', 1);

      // Task-level access produces full qualified path
      (machine as any).TaskMain.Speed = 2;
      expect(writeSpy).toHaveBeenLastCalledWith('AppModule::TaskMain:Speed', 2);

      // App+task access produces the same full qualified path
      (machine as any).AppModule.TaskMain.Speed = 3;
      expect(writeSpy).toHaveBeenLastCalledWith('AppModule::TaskMain:Speed', 3);

      expect(writeSpy).toHaveBeenCalledTimes(3);
    });
  });
});
