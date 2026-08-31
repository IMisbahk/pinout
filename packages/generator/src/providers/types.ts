import type { SourceDocument } from '../types/source.js';

export interface GenerationRequest<TResponse = unknown> {
  name: string;
  instructions: string;
  sources: SourceDocument[];
  schemaHint?: string;
  responseShape?: TResponse;
}

export interface GeneratorModel {
  readonly id: string;
  readonly provider: string;
  generateStructured<T>(request: GenerationRequest<T>): Promise<T>;
}

export interface GeneratorProvider {
  readonly name: string;
  createModel(modelId: string): GeneratorModel;
}
