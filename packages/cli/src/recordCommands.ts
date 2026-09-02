/**
 * Record / replay CLI (spec v1).
 *
 * `pinout record start` spawns a journaling pinoutd and remembers its PID;
 * `pinout record stop` shuts it down; `pinout replay <file>` prints the
 * session timeline from a recorded journal. Recordings are redacted at
 * journal time — secrets never enter the file.
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { Command } from 'commander';
import { buildReplaySession, formatReplaySession, loadJournalEntries } from '@pinout/core';
import type { CliOutput } from './output.js';

const RECORD_PID_FILE = '.pinout-record.pid';

export function registerRecordCommands(program: Command, outputFor: () => CliOutput): void {
  const record = program.command('record').description('Record and replay control sessions.');

  record
    .command('start')
    .description('Start a journaling pinoutd daemon (records all control activity).')
    .option('--out <file>', 'journal output path', 'session.pinout-journal')
    .option('--demo', 'include demo devices', false)
    .action(async (options: { out: string; demo: boolean }) => {
      const output = outputFor();
      if (existsSync(RECORD_PID_FILE)) {
        const existing = Number.parseInt(readFileSync(RECORD_PID_FILE, 'utf8').trim(), 10);
        output.error(`A recording daemon is already running (pid ${existing}). Stop it first: pinout record stop`);
        process.exitCode = 1;
        return;
      }
      const journalPath = resolve(options.out);
      const args = ['packages/daemon/dist/main.js', '--journal', journalPath, '--port', '8787'];
      if (options.demo) args.push('--demo');
      const child = spawn(process.execPath, args, {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      writeFileSync(RECORD_PID_FILE, String(child.pid));
      output.log(`Recording to ${journalPath} (pid ${child.pid}). Stop with: pinout record stop`);
    });

  record
    .command('stop')
    .description('Stop the recording daemon started by `record start`.')
    .action(async () => {
      const output = outputFor();
      if (!existsSync(RECORD_PID_FILE)) {
        output.error('No recording daemon is running.');
        process.exitCode = 1;
        return;
      }
      const pid = Number.parseInt(readFileSync(RECORD_PID_FILE, 'utf8').trim(), 10);
      try {
        process.kill(pid, 'SIGTERM');
        output.log(`Recording stopped (pid ${pid}). Journal is ready for: pinout replay`);
      } catch (error) {
        output.log(`Daemon ${pid} is not running (${error instanceof Error ? error.message : String(error)}); cleaning up.`);
      }
      unlinkSync(RECORD_PID_FILE);
    });

  program
    .command('replay <file>')
    .description('Print the timeline of a recorded session journal.')
    .action(async (file: string) => {
      const output = outputFor();
      const entries = await loadJournalEntries(resolve(file));
      if (entries.length === 0) {
        output.error(`No journal entries found in '${file}'.`);
        process.exitCode = 1;
        return;
      }
      const session = buildReplaySession(entries);
      if (output.json) {
        output.log(session);
      } else {
        for (const line of formatReplaySession(session)) {
          output.log(line);
        }
      }
    });
}
