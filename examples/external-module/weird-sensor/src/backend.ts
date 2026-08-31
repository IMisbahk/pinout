import type { DeviceBackend } from '@pinout/core';

export class WeirdSensorBackend implements DeviceBackend {
  readonly kind: 'simulated' | 'protocol';
  private readonly host: string;
  private readonly port: number;
  private readonly simulated: boolean;
  private temperature = 21.5;
  private humidity = 48;
  private closed = false;
  private readonly handlers = new Set<(event: string, payload: Record<string, unknown>) => void>();

  constructor(config: Record<string, unknown> = {}) {
    this.simulated = config.simulated !== false;
    this.kind = this.simulated ? 'simulated' : 'protocol';
    this.host = typeof config.host === 'string' ? config.host : 'localhost';
    this.port = typeof config.port === 'number' ? config.port : 8765;
  }

  async invoke(
    action: string,
    _payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (this.closed) {
      throw new Error('Sensor backend is closed.');
    }
    switch (action) {
      case 'temperature.read':
        return { temperature: this.temperature, unit: 'C' };
      case 'humidity.read':
        return { humidity: this.humidity, unit: 'percent' };
      case 'status.read':
        return {
          status: 'ready',
          host: this.host,
          port: this.port,
          simulated: this.simulated,
        };
      default:
        throw new Error(`Unsupported capability '${action}'.`);
    }
  }

  subscribe(handler: (event: string, payload: Record<string, unknown>) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  getOperationalState(): Record<string, unknown> {
    return {
      status: 'ready',
      temperature: this.temperature,
      humidity: this.humidity,
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.handlers.clear();
  }
}
