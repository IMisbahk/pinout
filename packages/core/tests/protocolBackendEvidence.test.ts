import { describe, expect, it } from 'vitest';
import {
  connect,
  esp32Module,
  PinoutRuntime,
  ProtocolDeviceBackend,
  simulatedEsp32,
} from '@pinout/core';

describe('ProtocolDeviceBackend evidence hooks', () => {
  it('records commanded and acknowledged on write without inferring observed state', async () => {
    const transport = simulatedEsp32();
    const device = await connect({ transport });
    const backend = new ProtocolDeviceBackend(device);

    try {
      await backend.arm();

      // Write GPIO 2
      await backend.invoke('gpio.write', { pin: 2, value: true });

      const evidence = backend.getOperationalStateEvidence();
      expect(evidence['gpio.2']).toBeDefined();
      expect(evidence['gpio.2']?.commanded.value).toBe(true);
      expect(evidence['gpio.2']?.commanded.source).toBe('commanded');
      expect(evidence['gpio.2']?.acknowledged.value).toBe(true);
      expect(evidence['gpio.2']?.acknowledged.source).toBe('acknowledged');

      // Crucial: observed is NEVER updated by a write
      expect(evidence['gpio.2']?.observed.value).toBeNull();
      expect(evidence['gpio.2']?.observed.source).toBe('none');
      expect(evidence['gpio.2']?.freshnessMs).toBeNull();
      expect(evidence['gpio.2']?.provenance).toBe('simulated');
    } finally {
      await backend.close();
    }
  });

  it('records observed evidence on gpio.read and gpio.analogRead', async () => {
    const transport = simulatedEsp32();
    const device = await connect({ transport });
    const backend = new ProtocolDeviceBackend(device);

    try {
      await backend.arm();

      // Read GPIO 2
      await backend.invoke('gpio.read', { pin: 2 });

      const evidence = backend.getOperationalStateEvidence();
      expect(evidence['gpio.2']).toBeDefined();
      expect(evidence['gpio.2']?.observed.value).toBe(false);
      expect(evidence['gpio.2']?.observed.source).toBe('gpio-readback');
      expect(typeof evidence['gpio.2']?.observed.at).toBe('string');
      expect(typeof evidence['gpio.2']?.freshnessMs).toBe('number');
      expect(evidence['gpio.2']?.stale).toBe(false);

      // Analog read GPIO 32
      await backend.invoke('gpio.analogRead', { pin: 32 });
      const analogEvidence = backend.getOperationalStateEvidence();
      expect(analogEvidence['gpio.32']).toBeDefined();
      expect(analogEvidence['gpio.32']?.observed.source).toBe('gpio-readback');
      expect(typeof analogEvidence['gpio.32']?.observed.value).toBe('number');
    } finally {
      await backend.close();
    }
  });

  it('updates observed state on gpio.changed watch events with fresh timestamps', async () => {
    const transport = simulatedEsp32();
    const device = await connect({ transport });
    const backend = new ProtocolDeviceBackend(device);

    try {
      await backend.arm();
      await backend.invoke('gpio.watch', { pin: 2 });

      // Before event
      const initialEvidence = backend.getOperationalStateEvidence();
      expect(initialEvidence['gpio.2']?.observed.source ?? 'none').toBe('none');

      // Emit watch event from device
      (device as unknown as { emit(event: string, payload?: Record<string, unknown>): void }).emit(
        'gpio.changed',
        { pin: 2, value: true },
      );

      const updatedEvidence = backend.getOperationalStateEvidence();
      expect(updatedEvidence['gpio.2']?.observed.value).toBe(true);
      expect(updatedEvidence['gpio.2']?.observed.source).toBe('gpio-readback');
      expect(typeof updatedEvidence['gpio.2']?.observed.at).toBe('string');
    } finally {
      await backend.close();
    }
  });

  it('tracks arming state in evidence on arm, disarm, and watchdog trip', async () => {
    const transport = simulatedEsp32();
    const device = await connect({ transport });
    const backend = new ProtocolDeviceBackend(device);

    try {
      // Initially disarmed
      const initialEvidence = backend.getOperationalStateEvidence();
      expect(initialEvidence.armed?.acknowledged.value).toBe('disarmed');

      // Arming
      await backend.arm();
      const armedEvidence = backend.getOperationalStateEvidence();
      expect(armedEvidence.armed?.commanded.value).toBe('armed');
      expect(armedEvidence.armed?.acknowledged.value).toBe('armed');

      // Disarming
      await backend.disarm();
      const disarmedEvidence = backend.getOperationalStateEvidence();
      expect(disarmedEvidence.armed?.commanded.value).toBe('disarmed');
      expect(disarmedEvidence.armed?.acknowledged.value).toBe('disarmed');

      // Re-arm then trip
      await backend.arm();
      (device as unknown as { emit(event: string, payload?: Record<string, unknown>): void }).emit(
        'device.tripped',
        { reason: 'WATCHDOG_EXPIRED' },
      );
      const trippedEvidence = backend.getOperationalStateEvidence();
      expect(trippedEvidence.armed?.acknowledged.value).toBe('tripped');
    } finally {
      await backend.close();
    }
  });

  it('integrates seamlessly with DeviceInstance.getStateEvidence()', async () => {
    const runtime = new PinoutRuntime();
    try {
      const instance = await runtime.registerFromModule(esp32Module.id, {
        id: 'esp-evidence-instance',
        simulated: true,
        transport: simulatedEsp32(),
      });

      await runtime.invoke('esp-evidence-instance', 'sys.arm', {});
      await runtime.invoke('esp-evidence-instance', 'gpio.write', { pin: 4, value: true });

      const instanceEvidence = instance.getStateEvidence();
      expect(instanceEvidence['gpio.4']).toBeDefined();
      expect(instanceEvidence['gpio.4']?.commanded.value).toBe(true);
      expect(instanceEvidence['gpio.4']?.acknowledged.value).toBe(true);
      expect(instanceEvidence['gpio.4']?.observed.source).toBe('none');

      await runtime.invoke('esp-evidence-instance', 'gpio.read', { pin: 4 });
      const readEvidence = instance.getStateEvidence();
      expect(readEvidence['gpio.4']?.observed.value).toBe(true);
      expect(['gpio-readback', 'simulated']).toContain(readEvidence['gpio.4']?.observed.source);
    } finally {
      await runtime.close();
    }
  });
});
