import type { Command } from 'commander';
import { generateCandidateModule } from '@pinout/generator';
import { loadGeneratorConfig } from '@pinout/generator';
import type { CliIo } from './runCli.js';
import type { CliOutput } from './output.js';

export function registerGenerateCommands(
  program: Command,
  outputFor: (program: Command, io: CliIo) => CliOutput,
  io: CliIo,
): void {
  program
    .command('generate')
    .description('Generate a candidate Pinout module from hardware documentation or SDK sources.')
    .argument('<source>', 'path to file or directory')
    .option('--plan', 'show generation plan only')
    .option('--output <path>', 'output directory for generated module')
    .option('--provider <name>', 'generator provider (mock, http, openai)')
    .option('--model <name>', 'model identifier')
    .option('--device-class <class>', 'hint for device class')
    .option('--test', 'run module conformance after generation')
    .action(
      async (
        source: string,
        options: {
          plan?: boolean;
          output?: string;
          provider?: string;
          model?: string;
          deviceClass?: string;
          test?: boolean;
        },
      ) => {
        const output = outputFor(program, io);
        const config = loadGeneratorConfig();
        if (options.provider) {
          config.provider = options.provider;
        }
        if (options.model) {
          config.model = options.model;
        }

        const generateOptions: Parameters<typeof generateCandidateModule>[0] = {
          sourcePath: source,
        };
        if (options.plan) {
          generateOptions.planOnly = true;
        }
        if (options.output) {
          generateOptions.outputPath = options.output;
        }
        if (options.provider) {
          generateOptions.provider = options.provider;
        }
        if (options.model) {
          generateOptions.model = options.model;
        }
        if (options.deviceClass) {
          generateOptions.deviceClass = options.deviceClass;
        }
        if (options.test) {
          generateOptions.runConformance = true;
        }

        const result = await generateCandidateModule(generateOptions);

        if (output.json) {
          output.log({
            plan: result.planJson,
            outputPath: result.outputPath,
            moduleId: result.moduleId,
            conformancePassed: result.conformancePassed,
            message: result.message,
          });
          return;
        }

        if (options.plan) {
          output.log(result.plan);
          return;
        }

        output.log(result.plan);
        output.log('');
        output.log(result.message);
        if (result.conformancePassed === false) {
          process.exitCode = 1;
        }
      },
    );
}
