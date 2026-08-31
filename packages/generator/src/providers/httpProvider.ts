import type { HardwareInterfaceIR } from '../types/ir.js';
import type { GeneratorModel, GenerationRequest, GeneratorProvider } from './types.js';

export interface HttpProviderOptions {
  apiUrl: string;
  apiKey?: string;
  providerName?: string;
}

export class HttpGeneratorProvider implements GeneratorProvider {
  readonly name: string;
  private readonly apiUrl: string;
  private readonly apiKey?: string;

  constructor(options: HttpProviderOptions) {
    this.name = options.providerName ?? 'http';
    this.apiUrl = options.apiUrl;
    if (options.apiKey !== undefined) {
      this.apiKey = options.apiKey;
    }
  }

  createModel(modelId: string): GeneratorModel {
    return new HttpGeneratorModel(this.name, modelId, this.apiUrl, this.apiKey);
  }
}

class HttpGeneratorModel implements GeneratorModel {
  readonly provider: string;
  readonly id: string;
  private readonly apiUrl: string;
  private readonly apiKey?: string;

  constructor(provider: string, id: string, apiUrl: string, apiKey?: string) {
    this.provider = provider;
    this.id = id;
    this.apiUrl = apiUrl;
    if (apiKey !== undefined) {
      this.apiKey = apiKey;
    }
  }

  async generateStructured<T>(request: GenerationRequest<T>): Promise<T> {
    const body = {
      model: this.id,
      messages: [
        {
          role: 'system',
          content:
            'Extract hardware interface structure as JSON matching HardwareInterfaceIR. Include evidence, confidence, and uncertainties. Never invent safety limits without evidence.',
        },
        {
          role: 'user',
          content: `${request.instructions}\n\nSources:\n${request.sources.map((s) => s.content).join('\n---\n')}`,
        },
      ],
      response_format: { type: 'json_object' },
    };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.apiUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Generator HTTP provider failed: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Generator HTTP provider returned empty content.');
    }
    return JSON.parse(content) as T;
  }
}

export function createHttpProvider(options: HttpProviderOptions): GeneratorProvider {
  return new HttpGeneratorProvider(options);
}

export type { HardwareInterfaceIR };
