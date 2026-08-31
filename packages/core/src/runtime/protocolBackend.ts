import type { Device } from '../device.js';
import type { DeviceBackend } from './types.js';

export class ProtocolDeviceBackend implements DeviceBackend {
  readonly kind = 'protocol' as const;

  constructor(private readonly device: Device) {}

  subscribe(_handler: (event: string, payload: Record<string, unknown>) => void): () => void {
    return () => undefined;
  }

  async invoke(action: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.device.invoke(action, payload);
  }

  async close(): Promise<void> {
    await this.device.close();
  }

  getDevice(): Device {
    return this.device;
  }

  getOperationalState(): Record<string, unknown> {
    return {
      firmware: this.device.info.firmware,
      version: this.device.info.version,
      protocol: this.device.info.protocol,
    };
  }
}
