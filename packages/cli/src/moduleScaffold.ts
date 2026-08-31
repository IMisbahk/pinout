import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ScaffoldOptions {
  name: string;
  outputDir?: string;
}

export function scaffoldModule(options: ScaffoldOptions): string {
  const slug = options.name.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const moduleId = `${slug}/device`;
  const root = join(options.outputDir ?? process.cwd(), slug);

  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'test'), { recursive: true });

  writeFileSync(
    join(root, 'pinout.module.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        id: moduleId,
        version: '0.1.0',
        deviceClass: 'sensor.custom',
        entrypoint: './dist/index.js',
        name: `${slug} device`,
        pinout: { minimumVersion: '0.2.0' },
      },
      null,
      2,
    )}\n`,
  );

  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify(
      {
        name: slug,
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: { build: 'tsc', test: 'vitest run' },
        dependencies: { '@pinout/core': '*' },
        devDependencies: { typescript: '^5.7.2', vitest: '^2.1.8' },
      },
      null,
      2,
    )}\n`,
  );

  writeFileSync(
    join(root, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          outDir: 'dist',
          rootDir: 'src',
          strict: true,
          skipLibCheck: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    )}\n`,
  );

  writeFileSync(
    join(root, 'src', 'backend.ts'),
    `import type { DeviceBackend } from '@pinout/core';

export class ${toClassName(slug)}Backend implements DeviceBackend {
  readonly kind = 'simulated' as const;
  private closed = false;

  constructor(private readonly config: Record<string, unknown> = {}) {}

  async invoke(action: string, _payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.closed) {
      throw new Error('Backend is closed.');
    }
    if (action === 'status.read') {
      return { status: 'ready', simulated: true };
    }
    throw new Error(\`Unsupported capability '\${action}'.\`);
  }

  subscribe(_handler: (event: string, payload: Record<string, unknown>) => void): () => void {
    return () => undefined;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
`,
  );

  writeFileSync(
    join(root, 'src', 'index.ts'),
    `import { defineModule, action } from '@pinout/core';
import { ${toClassName(slug)}Backend } from './backend.js';

export default defineModule({
  id: '${moduleId}',
  version: '0.1.0',
  device: {
    class: 'sensor.custom',
    vendor: 'Example',
    model: '${slug}',
  },
  capabilities: [
    action({
      id: 'status.read',
      description: 'Read device status.',
      output: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          simulated: { type: 'boolean' },
        },
        required: ['status', 'simulated'],
      },
    }),
  ],
  createBackend(config) {
    return new ${toClassName(slug)}Backend(config);
  },
});
`,
  );

  writeFileSync(
    join(root, 'test', 'module.test.ts'),
    `import { describe, expect, it } from 'vitest';
import moduleDefinition from '../src/index.js';

describe('${slug} module', () => {
  it('loads module definition', () => {
    expect(moduleDefinition.id).toBe('${moduleId}');
  });
});
`,
  );

  writeFileSync(
    join(root, 'README.md'),
    `# ${slug}

Pinout external module scaffold. Build, test, and install:

\`\`\`bash
npm install && npm run build
pinout module test .
pinout module install .
\`\`\`
`,
  );

  return root;
}

function toClassName(slug: string): string {
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}
