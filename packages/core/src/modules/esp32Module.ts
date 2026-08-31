import { describeCapabilities, firstPartyCapabilities } from '../capabilities.js';
import { connect } from '../connect.js';
import { simulatedEsp32 } from '../drivers/esp32/simulatedTransport.js';
import type { ConnectOptions, Transport } from '../types.js';
import type { DeviceBackend, PinoutModuleDefinition } from '../runtime/types.js';
import { ProtocolDeviceBackend } from '../runtime/protocolBackend.js';

export const esp32ModuleId = 'pinout/esp32';

export const esp32Module: PinoutModuleDefinition = {
  id: esp32ModuleId,
  version: '0.1.0',
  deviceClass: 'microcontroller',
  vendor: 'Espressif',
  model: 'ESP32',
  capabilities: describeCapabilities([...firstPartyCapabilities]),
  capabilityNames: [...firstPartyCapabilities],
  policies: [],
  supportedTransportKinds: ['serial', 'simulated-esp32', 'tcp', 'loopback'],
  createSimulatedBackend(): DeviceBackend {
    throw new Error('Use createProtocolBackend with simulatedEsp32() transport for ESP32.');
  },
  async createProtocolBackend(options: Record<string, unknown>): Promise<DeviceBackend> {
    const transport = options.transport as Transport | undefined;
    if (!transport) {
      throw new Error('ESP32 protocol backend requires a transport.');
    }
    const connectOptions: ConnectOptions = { transport };
    if (typeof options.timeoutMs === 'number') {
      connectOptions.timeoutMs = options.timeoutMs;
    }
    if (options.signal instanceof AbortSignal) {
      connectOptions.signal = options.signal;
    }
    const device = await connect(connectOptions);
    return new ProtocolDeviceBackend(device);
  },
};

export function createEsp32SimulatedTransport(): Transport {
  return simulatedEsp32();
}
