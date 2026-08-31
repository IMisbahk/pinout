import { extractHardwareIr } from '../extract/heuristicExtractor.js';
import type { GeneratorModel, GenerationRequest, GeneratorProvider } from './types.js';

class MockGeneratorModel implements GeneratorModel {
  readonly id: string;
  readonly provider = 'mock';

  constructor(id: string) {
    this.id = id;
  }

  async generateStructured<T>(request: GenerationRequest<T>): Promise<T> {
    if (request.name !== 'hardware-interface-ir') {
      throw new Error(`Mock provider does not support request '${request.name}'.`);
    }
    const ir = extractHardwareIr(request.sources);
    return ir as T;
  }
}

export class MockGeneratorProvider implements GeneratorProvider {
  readonly name = 'mock';

  createModel(modelId: string): GeneratorModel {
    return new MockGeneratorModel(modelId);
  }
}

export function createMockProvider(): GeneratorProvider {
  return new MockGeneratorProvider();
}

export { extractHardwareIr };
