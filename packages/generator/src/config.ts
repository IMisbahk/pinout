export interface GeneratorConfig {
  provider: string;
  model: string;
  apiUrl?: string;
  apiKey?: string;
}

export function loadGeneratorConfig(env: NodeJS.ProcessEnv = process.env): GeneratorConfig {
  const config: GeneratorConfig = {
    provider: env.PINOUT_GENERATOR_PROVIDER ?? 'mock',
    model: env.PINOUT_GENERATOR_MODEL ?? 'pinout-heuristic-v1',
  };
  if (env.PINOUT_GENERATOR_API_URL) {
    config.apiUrl = env.PINOUT_GENERATOR_API_URL;
  }
  if (env.PINOUT_GENERATOR_API_KEY) {
    config.apiKey = env.PINOUT_GENERATOR_API_KEY;
  }
  return config;
}

export function redactSecrets(text: string, apiKey?: string): string {
  if (!apiKey || apiKey.length < 8) {
    return text;
  }
  return text.replaceAll(apiKey, '[REDACTED]');
}
