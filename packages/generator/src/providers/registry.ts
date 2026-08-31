import type { GeneratorConfig } from '../config.js';
import { createHttpProvider } from './httpProvider.js';
import { createMockProvider } from './mockProvider.js';
import type { GeneratorProvider } from './types.js';

export function createGeneratorProvider(config: GeneratorConfig): GeneratorProvider {
  if (config.provider === 'mock') {
    return createMockProvider();
  }
  if (config.provider === 'http' || config.provider === 'openai') {
    if (!config.apiUrl) {
      throw new Error('PINOUT_GENERATOR_API_URL is required for HTTP generator provider.');
    }
    return createHttpProvider({
      apiUrl: config.apiUrl,
      ...(config.apiKey ? { apiKey: config.apiKey } : {}),
      providerName: config.provider,
    });
  }
  throw new Error(`Unknown generator provider '${config.provider}'.`);
}
