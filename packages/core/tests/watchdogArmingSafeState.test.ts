import { describe, expect, it } from 'vitest';
import {
  connect,
  DeviceError,
  encodeRequest,
  esp32Module,
  parseDeviceInfo,
  parseLine,
  PinoutRuntime,
  ProtocolDeviceBackend,
  simulatedEsp32,
  type DeviceInfo,
  type Transport,
} from '@pinout/core';
import { ByteQueue } from '../src/transports/byteQueue.js';
import { createGpioState, handleBridgeAction } from '../src/drivers/esp32/bridge.js';

describe('Phase 2 Item A: Protocol encode/decode for watchdog, arming, and safe-state', () => {
  it('encodes and decodes sys.arm, sys.disarm, watchdog.configure, watchdog.kick, and gpio.configSafeState', () => {
    const armLine = encodeRequest('req-arm', 'sys.arm', { timeoutMs: 2000 });
    const decodedArm = parseLine(armLine);
    expect(decodedArm).toEqual({
      v: 1,
      id: 'req-arm',
      action: 'sys.arm',
      payload: { timeoutMs: 2000 },
    });

    const disarmLine = encodeRequest('req-disarm', 'sys.disarm', {});
    expect(parseLine(disarmLine)).toEqual({
      v: 1,
      id: 'req-disarm',
      action: 'sys.disarm',
      payload: {},
    });

    const wdConfigLine = encodeRequest('req-wd', 'watchdog.configure', { timeoutMs: 500 });
    expect(parseLine(wdConfigLine)).toEqual({
      v: 1,
      id: 'req-wd',
      action: 'watchdog.configure',
      payload: { timeoutMs: 500 },
    });

    const kickLine = encodeRequest('req-kick', 'watchdog.kick', { validityMs: 100 });
    expect(parseLine(kickLine)).toEqual({
      v: 1,
      id: 'req-kick',
      action: 'watchdog.kick',
      payload: { validityMs: 100 },
    });

    const safeStateLine = encodeRequest('req-ss', 'gpio.configSafeState', {
      pin: 2,
      safeLevel: 'high',
      polarity: 'active-low',
    });
    expect(parseLine(safeStateLine)).toEqual({
      v: 1,
      id: 'req-ss',
      action: 'gpio.configSafeState',
      payload: { pin: 2, safeLevel: 'high', polarity: 'active-low' },
    });
  });

  it('parses identity features array from ready event and sys.hello', () => {
    const identityPayload = {
      firmware: 'esp32-bridge',
      version: '0.3.0',
      protocol: 1,
      capabilities: ['sys.hello', 'sys.arm', 'watchdog.kick', 'gpio.write'],
      features: ['watchdog', 'arming', 'safe-state', 'command-validity'],
    };
    const info = parseDeviceInfo(identityPayload);
    expect(info.features).toEqual(['watchdog', 'arming', 'safe-state', 'command-validity']);

    const legacyPayload = {
      firmware: 'esp32-legacy',
      version: '0.1.0',
      protocol: 1,
      capabilities: ['sys.hello', 'gpio.write'],
    };
    const legacyInfo = parseDeviceInfo(legacyPayload);
    expect(legacyInfo.features).toEqual([]);
  });
});

describe('Phase 2 Item A: Explicit Arming State Machine', () => {
  it('rejects physical actuation when disarmed at boot', async () => {
    const device = await connect({ transport: simulatedEsp32() });
    try {
      expect(device.hasFeature('arming')).toBe(true);
      expect(device.hasFeature('watchdog')).toBe(true);

      // Read-only actions and configuration are allowed while disarmed
      await expect(device.gpio.read(2)).resolves.toBe(false);
      await expect(device.gpio.mode(4, 'pullup')).resolves.toBeUndefined();
      await expect(device.invoke('sys.ping', {})).resolves.toEqual({ pong: true });

      // Actuation actions are rejected with NOT_ARMED
      await expect(device.gpio.write(2, true)).rejects.toThrowError(
        /Device is disarmed\. Explicit arming/i,
      );
      await expect(device.invoke('gpio.batchWrite', { writes: [{ pin: 2, value: true }] })).rejects.toThrowError(
        /NOT_ARMED|Device is disarmed/i,
      );
      await expect(device.invoke('gpio.toggle', { pin: 2 })).rejects.toThrowError(
        /NOT_ARMED|Device is disarmed/i,
      );
      await expect(
        device.invoke('gpio.pulse', { pin: 2, value: true, durationMs: 50 }),
      ).rejects.toThrowError(/NOT_ARMED|Device is disarmed/i);
      await expect(
        device.invoke('gpio.pwm', { pin: 2, duty: 0.5, frequency: 1000, channel: 0 }),
      ).rejects.toThrowError(/NOT_ARMED|Device is disarmed/i);
      await expect(device.invoke('gpio.servo', { pin: 13, angle: 90 })).rejects.toThrowError(
        /NOT_ARMED|Device is disarmed/i,
      );
      await expect(
        device.invoke('gpio.motor', { pwmPin: 25, speed: 0.5 }),
      ).rejects.toThrowError(/NOT_ARMED|Device is disarmed/i);
      await expect(
        device.invoke('i2c.write', { address: 0x3c, data: [1, 2] }),
      ).rejects.toThrowError(/NOT_ARMED|Device is disarmed/i);
      await expect(
        device.invoke('spi.transfer', { data: [1, 2] }),
      ).rejects.toThrowError(/NOT_ARMED|Device is disarmed/i);
    } finally {
      await device.close();
    }
  });

  it('allows actuation after sys.arm and disarms upon sys.disarm', async () => {
    const device = await connect({ transport: simulatedEsp32() });
    try {
      const armResult = await device.arm({ timeoutMs: 5000 });
      expect(armResult).toMatchObject({ armed: true, state: 'armed' });

      await device.gpio.write(2, true);
      expect(await device.gpio.read(2)).toBe(true);

      const disarmResult = await device.disarm();
      expect(disarmResult).toMatchObject({ armed: false, state: 'disarmed' });

      // Outputs are put into safe state and new actuations are rejected
      expect(await device.gpio.read(2)).toBe(false);
      await expect(device.gpio.write(2, true)).rejects.toThrowError(/NOT_ARMED|Device is disarmed/i);
    } finally {
      await device.close();
    }
  });
});

describe('Phase 2 Item A: Watchdog expiry and per-output safe state', () => {
  it('trips watchdog and applies declared active-low safe state (driving HIGH)', async () => {
    const transport = simulatedEsp32();
    const device = await connect({ transport });
    const trippedEvents: Array<Record<string, unknown>> = [];
    device.on('device.tripped', (payload) => {
      trippedEvents.push(payload);
    });

    try {
      // Configure GPIO 2 as an active-low output (e.g. relay energized on LOW)
      // Safe state must be HIGH to de-energize the load!
      await device.configSafeState(2, 'high', 'active-low');

      // Configure GPIO 4 as standard active-high output (safe level LOW)
      await device.configSafeState(4, 'low', 'active-high');

      // Configure GPIO 5 as high-z (floating/input)
      await device.configSafeState(5, 'high-z', 'active-high');

      // Arm with a fast 100ms watchdog
      await device.arm({ timeoutMs: 100 });

      // Energize active-low load on pin 2 (driven LOW) and active-high on pin 4 (driven HIGH)
      await device.gpio.write(2, false);
      await device.gpio.write(4, true);
      await device.gpio.write(5, true);

      expect(await device.gpio.read(2)).toBe(false);
      expect(await device.gpio.read(4)).toBe(true);

      // Wait for watchdog to expire
      await new Promise((resolve) => setTimeout(resolve, 180));

      // Device must have emitted device.tripped event
      expect(trippedEvents.length).toBeGreaterThan(0);
      expect(trippedEvents[0]).toMatchObject({
        reason: 'WATCHDOG_EXPIRED',
      });

      // Assert per-pin safe levels:
      // Active-low pin 2 was driven HIGH!
      expect(await device.gpio.read(2)).toBe(true);
      // Active-high pin 4 was driven LOW!
      expect(await device.gpio.read(4)).toBe(false);
      // Pin 5 was set to input mode
      expect(transport.state.modes.get(5)).toBe('input');

      // In tripped state, subsequent actuation commands are REJECTED with WATCHDOG_TRIPPED
      await expect(device.gpio.write(4, true)).rejects.toThrowError(
        /WATCHDOG_TRIPPED|WATCHDOG_EXPIRED|Watchdog tripped/i,
      );

      // No automatic resumption: re-arming explicitly is required
      await device.arm({ timeoutMs: 5000 });
      await device.gpio.write(4, true);
      expect(await device.gpio.read(4)).toBe(true);
    } finally {
      await device.close();
    }
  });

  it('rejects invalid safeLevel or polarity configurations', async () => {
    const device = await connect({ transport: simulatedEsp32() });
    try {
      await expect(
        device.invoke('gpio.configSafeState', { pin: 2, safeLevel: 'invalid-level' }),
      ).rejects.toThrow();

      await expect(
        device.invoke('gpio.configSafeState', { pin: 2, safeLevel: 'low', polarity: 'invalid-pol' }),
      ).rejects.toThrow();
    } finally {
      await device.close();
    }
  });
});

describe('Phase 2 Item A: Bounded command validity (validityMs)', () => {
  it('rejects commands whose validity window has expired', async () => {
    const device = await connect({ transport: simulatedEsp32() });
    try {
      await device.arm({ timeoutMs: 5000 });

      // Valid validityMs succeeds
      await expect(
        device.invoke('gpio.write', { pin: 2, value: true, validityMs: 500 }),
      ).resolves.toEqual({ pin: 2, value: true });

      // Expired validityMs (<= 0 or expired: true) is rejected with COMMAND_EXPIRED
      await expect(
        device.invoke('gpio.write', { pin: 2, value: true, validityMs: 0 }),
      ).rejects.toThrowError(/VALIDATION_ERROR|positive integer|validityMs must be/i);

      // Simulator directly rejects expired validity payload with COMMAND_EXPIRED
      const state = createGpioState();
      state.deviceState = 'armed';
      try {
        handleBridgeAction('gpio.write', { pin: 2, value: true, validityMs: -1 }, state);
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(DeviceError);
        expect((error as DeviceError).code).toBe('COMMAND_EXPIRED');
      }
    } finally {
      await device.close();
    }
  });
});

describe('Phase 2 Item A: ProtocolDeviceBackend & Legacy Firmware Guarantee', () => {
  it('refuses watchdog-dependent actuation when firmware lacks watchdog/arming flags', async () => {
    class LegacyTransport implements Transport {
      readonly kind = 'legacy-serial';
      private readonly inbound = new ByteQueue();

      get readable(): AsyncIterable<Uint8Array> {
        return this.inbound;
      }

      async open(): Promise<void> {
        const legacyIdentity: DeviceInfo = {
          firmware: 'esp32-legacy-bridge',
          version: '0.1.0',
          protocol: 1,
          capabilities: ['sys.hello', 'gpio.write', 'gpio.read', 'gpio.stopAll'],
        };
        this.inbound.push(
          new TextEncoder().encode(`${JSON.stringify({ v: 1, event: 'ready', payload: legacyIdentity })}\n`),
        );
      }

      async write(data: Uint8Array): Promise<void> {
        const text = new TextDecoder().decode(data);
        const req = JSON.parse(text);
        if (req.action === 'sys.hello') {
          const resp = {
            v: 1,
            id: req.id,
            ok: true,
            result: {
              firmware: 'esp32-legacy-bridge',
              version: '0.1.0',
              protocol: 1,
              capabilities: ['sys.hello', 'gpio.write', 'gpio.read', 'gpio.stopAll'],
            },
          };
          this.inbound.push(new TextEncoder().encode(`${JSON.stringify(resp)}\n`));
        }
      }

      async close(): Promise<void> {
        this.inbound.close();
      }
    }

    const device = await connect({ transport: new LegacyTransport() });
    const backend = new ProtocolDeviceBackend(device, { requireWatchdog: true });
    try {
      expect(device.hasFeature('watchdog')).toBe(false);
      expect(device.hasFeature('arming')).toBe(false);

      // Refuses arming/actuation when watchdog is required
      await expect(backend.arm()).rejects.toThrowError(
        /WATCHDOG_NOT_SUPPORTED|does not advertise watchdog/i,
      );
    } finally {
      await backend.close();
    }
  });

  it('automatically sends heartbeats while armed to keep device from tripping', async () => {
    const transport = simulatedEsp32();
    const device = await connect({ transport });
    const backend = new ProtocolDeviceBackend(device, {
      autoHeartbeat: true,
      heartbeatIntervalMs: 40,
    });
    try {
      // Arm with 150ms timeout
      await backend.arm({ timeoutMs: 150 });
      expect(backend.getOperationalState()).toMatchObject({
        state: 'armed',
        armed: true,
        tripped: false,
      });

      // Wait 350ms (longer than 150ms watchdog deadline)
      await new Promise((resolve) => setTimeout(resolve, 350));

      // Device remains armed because backend kicked it periodically
      expect(backend.getOperationalState()).toMatchObject({
        state: 'armed',
        armed: true,
        tripped: false,
      });

      // Disarming stops heartbeat
      await backend.disarm();
      expect(backend.getOperationalState()).toMatchObject({
        state: 'disarmed',
        armed: false,
      });
    } finally {
      await backend.close();
    }
  });

  it('initializes output safe states via esp32Module and arms through runtime invocation', async () => {
    const runtime = new PinoutRuntime();
    try {
      const instance = await runtime.registerFromModule(esp32Module.id, {
        id: 'esp-safety-test',
        label: 'ESP32 Safe State Test',
        simulated: true,
        transport: simulatedEsp32(),
        outputs: [
          { pin: 2, safeLevel: 'high', polarity: 'active-low' },
          { pin: 4, safeLevel: 'low', polarity: 'active-high' },
        ],
      });

      expect(instance).toBeDefined();

      // Governed capability exposure
      const capabilities = instance.capabilities.map((c) => c.name);
      expect(capabilities).toContain('sys.arm');
      expect(capabilities).toContain('sys.disarm');
      expect(capabilities).toContain('watchdog.configure');
      expect(capabilities).toContain('watchdog.kick');
      expect(capabilities).toContain('gpio.configSafeState');

      // Defaults to disarmed at bind
      const opState = instance.getOperationalStateSnapshot();
      expect(opState).toMatchObject({
        disarmed: true,
        armed: false,
        state: 'disarmed',
      });

      // Actuation before arming is rejected
      await expect(
        runtime.invoke('esp-safety-test', 'gpio.write', { pin: 2, value: false }),
      ).rejects.toThrow(/NOT_ARMED|disarmed/i);

      // Arm through the runtime path
      const armResult = await runtime.invoke('esp-safety-test', 'sys.arm', { timeoutMs: 2000 });
      expect(armResult).toMatchObject({
        state: 'armed',
        armed: true,
      });

      // Actuation after arming succeeds
      const writeResult = await runtime.invoke('esp-safety-test', 'gpio.write', { pin: 2, value: false });
      expect(writeResult).toEqual({ pin: 2, value: false });

      // Halt the runtime
      runtime.halt.halt('test safe-state');
      await runtime.waitForSafeState();

      // Safe state applied: pin 2 is HIGH, state is disarmed
      const finalOpState = instance.getOperationalStateSnapshot();
      expect(finalOpState).toMatchObject({
        disarmed: true,
        armed: false,
      });
    } finally {
      await runtime.close();
    }
  });
});
