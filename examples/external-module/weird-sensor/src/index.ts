import { defineModule, action, sensorRead } from '@pinout/core';
import { WeirdSensorBackend } from './backend.js';

export default defineModule({
  id: 'weird-sensor/thermometer',
  version: '0.1.0',
  device: {
    class: 'sensor.temperature',
    vendor: 'Weird Labs',
    model: 'WS-100',
    name: 'Weird Network Sensor',
    description: 'Generic network temperature and humidity sensor.',
  },
  capabilities: [
    sensorRead('temperature.read', 'Read current temperature in °C.', {
      type: 'object',
      additionalProperties: false,
      properties: {
        temperature: { type: 'number', description: 'Temperature in °C.' },
        unit: { type: 'string', enum: ['C'] },
      },
      required: ['temperature', 'unit'],
    }),
    sensorRead('humidity.read', 'Read current relative humidity.', {
      type: 'object',
      additionalProperties: false,
      properties: {
        humidity: { type: 'number', description: 'Relative humidity percentage.' },
        unit: { type: 'string', enum: ['percent'] },
      },
      required: ['humidity', 'unit'],
    }),
    action({
      id: 'status.read',
      description: 'Read sensor connectivity and health status.',
      output: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['ready', 'faulted'] },
          host: { type: 'string' },
          port: { type: 'number' },
          simulated: { type: 'boolean' },
        },
        required: ['status', 'simulated'],
      },
    }),
  ],
  supportedTransportKinds: ['simulated', 'tcp'],
  createBackend(config) {
    return new WeirdSensorBackend(config);
  },
});
