import { describe, it, expect, vi } from 'vitest';
import { OpcuaMachine } from '../../src/opcua-machine.js';
import { mockConnectionConfig } from '../fixtures/test-data.js';

/**
 * Regression test for the PLC-reboot stale-subscription bug.
 *
 * mapp Connect session ids are small integers that reset on a PLC reboot, so a
 * fresh session frequently reuses the dead session's id (e.g. `1`). The machine
 * must therefore decide "did the session change?" from the connection's session
 * *generation count*, not the session id — otherwise a reboot is misread as the
 * same session, subscriptions are never rebuilt, and monitored values freeze.
 */
describe('OpcuaMachine reconnection — session change detection', () => {
  function setup() {
    const machine = new OpcuaMachine(mockConnectionConfig);
    const connection = machine['connection'] as any;
    const sm = machine['subscriptionManager'] as any;

    // One active read group so there is something to (re)build on connect.
    machine.initCyclicRead('Temperature');

    let generationCount = 1;
    // The server reuses the SAME session id across the reboot.
    vi.spyOn(connection, 'getSessionGenerationCount').mockImplementation(() => generationCount);
    vi.spyOn(connection, 'getSessionInfo').mockReturnValue({ sessionId: 1 } as any);
    vi.spyOn(connection, 'getPlcNamespaceIndex').mockReturnValue(5);

    const clearSpy = vi.spyOn(sm, 'clearAllSubscriptions').mockImplementation(() => {});
    vi.spyOn(sm, 'getAllSubscriptions').mockReturnValue(new Map([['default', {} as any]]));
    const buildSpy = vi
      .spyOn(machine as any, 'doCreateOrUpdateSubscription')
      .mockResolvedValue(undefined);

    // The connection state handler the machine registered in its constructor.
    const handlers = connection['connectionStateHandlers'] as Array<(s: string) => unknown>;
    const fire = async (state: string) => {
      for (const h of handlers) await h(state);
    };

    return {
      fire,
      clearSpy,
      buildSpy,
      setGenerationCount: (n: number) => {
        generationCount = n;
      },
    };
  }

  it('rebuilds on first connect', async () => {
    const { fire, clearSpy, buildSpy } = setup();
    await fire('connected');
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(buildSpy).toHaveBeenCalled();
  });

  it('does NOT wipe state on a transient drop that keeps the same session', async () => {
    const { fire, clearSpy, buildSpy } = setup();
    await fire('connected');
    clearSpy.mockClear();
    buildSpy.mockClear();

    // Same generation count (session survived the WS blip) → reconcile, never wipe.
    await fire('reconnecting');
    await fire('connected');
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it('rebuilds after a PLC reboot even when the new session reuses the same id', async () => {
    const { fire, clearSpy, buildSpy, setGenerationCount } = setup();
    await fire('connected');
    clearSpy.mockClear();
    buildSpy.mockClear();

    // PLC reboot: brand-new server-side session, but it got the same id (1).
    // Only the generation count tells us it changed.
    setGenerationCount(2);
    await fire('reconnecting');
    await fire('connected');

    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(buildSpy).toHaveBeenCalled();
  });
});
