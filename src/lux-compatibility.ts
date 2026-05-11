/**
 * LUX Compatibility Layer for lux-data-bind.js
 *
 * This module provides a minimal compatibility interface between the LuxConnect OPC UA library
 * and the existing lux-data-bind.js library. Since both have nearly identical APIs by design,
 * we just need to expose the library and machine the same way LUX does.
 */

import { OpcuaMachine } from './opcua-machine.js';
import { type Logger, consoleLogger } from './logger.js';

declare global {
    interface Window {
        LUX: Record<string, unknown>; // Will be populated by lux-data-bind.js
        machine?: LuxCompatibleMachine;
        [machineName: string]: unknown;
    }
}

export interface LuxCompatibleMachine {
    // Core methods that lux-data-bind expects
    writeVariable(variableName: string, value: unknown, callback?: () => void): void;
    readVariable(variableName: string, callback?: () => void): void;

    // Methods that lux-data-bind calls through getValue/getHideValue/getLockValue
    initCyclicReadGroup(readGroupName: string, variableName: string): void;
    value(variableName: string): unknown;

    // User level support (if your app uses it)
    getUserLevel?(): number;

    // Read group management (referenced in lux-data-bind)
    getReadGroupList?(): string[];
    readGroupShouldManage?(): void;
}

/**
 * Creates a LUX-compatible wrapper around an OpcuaMachine instance.
 * Diagnostics are routed through the machine's configured logger so they
 * can be silenced or redirected via the standard `ConnectionConfig.logger`
 * option.
 */
export function createLuxCompatibleMachine(opcuaMachine: OpcuaMachine): LuxCompatibleMachine {
    const variableCache = new Map<string, unknown>();
    const log: Logger = opcuaMachine.getLogger();

    return {
        writeVariable: async (variableName: string, value: unknown, callback?: () => void) => {
            try {
                await opcuaMachine.writeVariable(variableName, value);
                if (callback) callback();
            } catch (error) {
                log.error('LUX compatibility: writeVariable error:', error);
                if (callback) callback(); // Still call callback to prevent hanging
            }
        },

        readVariable: async (variableName: string, callback?: () => void) => {
            try {
                const value = await opcuaMachine.readVariable(variableName);
                variableCache.set(variableName, value);
                if (callback) callback();
            } catch (error) {
                log.error('LUX compatibility: readVariable error:', error);
                if (callback) callback(); // Still call callback to prevent hanging
            }
        },

        // Mock cyclic read group initialization - lux-data-bind expects this
        initCyclicReadGroup: (_readGroupName: string, variableName: string) => {
            // Subscribe to the variable for real-time updates
            opcuaMachine.subscribe(variableName, (value: unknown) => {
                variableCache.set(variableName, value);
            }).catch(error => {
                log.warn(`LUX compatibility: Failed to subscribe to ${variableName}:`, error);
            });
        },

        // Return cached value - this is called frequently by lux-data-bind
        value: (variableName: string): unknown => {
            return variableCache.get(variableName);
        },

        // Optional: User level support (return admin level if not implemented)
        getUserLevel: () => 100, // Admin level by default

        // Optional: Read group management (basic implementation)
        getReadGroupList: () => ['global'],
        readGroupShouldManage: () => {
            // No-op for now, could be enhanced if needed
        }
    };
}

/**
 * Minimal LUX setup - lux-data-bind.js provides most of what we need.
 *
 * @param logger Optional logger for setup diagnostics. Defaults to `consoleLogger`
 *               since this helper has no associated OpcuaMachine to pull from.
 */
export function setupMinimalLux(logger: Logger = consoleLogger): void {
    if (typeof window === 'undefined') {
        logger.warn('LUX compatibility: Not running in browser environment');
        return;
    }

    // lux-data-bind.js will create the LUX object and most methods
    // We just need to ensure it exists and add any missing pieces
    if (!window.LUX) {
        window.LUX = {
            version: '2.0.0-opcua-compatible'
        };
    }

    //@ts-ignore
    window.LUX.writeValueFromElement = function ($this, value) {
        //@ts-ignore
        const localMachine = window[LUX.getMachineName($this)];
        //@ts-ignore
        const VariableName = LUX.getVarName($this);
        //@ts-ignore
        localMachine.writeVariable(VariableName, value, ()=>{
            $this.removeAttr('data-machine-value');
        });
    };
    // Add any LUX methods that might be missing but are needed
    // (lux-data-bind.js should provide most of these)

    logger.info('Minimal LUX compatibility setup complete');
}

/**
 * Registers an OpcuaMachine instance as a global machine for use with lux-data-bind.
 * Diagnostics route through the machine's configured logger.
 */
export function registerMachine(opcuaMachine: OpcuaMachine, machineName: string = 'machine'): void {
    const log: Logger = opcuaMachine.getLogger();
    if (typeof window === 'undefined') {
        log.warn('LUX compatibility: Not running in browser environment');
        return;
    }

    const compatibleMachine = createLuxCompatibleMachine(opcuaMachine);
    window[machineName] = compatibleMachine;

    log.info(`Machine '${machineName}' registered for LUX data-bind compatibility`);
}

/**
 * Complete setup for LUX compatibility - call this once in your application.
 * Diagnostics route through the machine's configured logger.
 */
export function initializeLuxCompatibility(opcuaMachine: OpcuaMachine, machineName: string = 'machine'): void {
    const log: Logger = opcuaMachine.getLogger();
    setupMinimalLux(log);
    registerMachine(opcuaMachine, machineName);

    log.info('LUX compatibility initialized - lux-data-bind.js should work with OpcuaMachine');
}
