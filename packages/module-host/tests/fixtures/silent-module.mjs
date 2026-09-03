// Overrides the heartbeat contract: never heartbeats after init (the worker
// runtime heartbeats automatically, so this fixture reimplements the loop).
import { createInterface } from 'node:readline';
let alive = true;
const readline = createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
readline.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.kind === 'init') {
    send({ v: 1, id: 'init', kind: 'ready', payload: { capabilities: ['ping'] } });
  } else if (request.kind === 'invoke') {
    send({ v: 1, id: request.id, kind: 'result', payload: { result: { pong: true } } });
  } else if (request.kind === 'shutdown') {
    process.exit(0);
  }
});
// No heartbeat at all: the host must declare it crashed after 3 intervals.
setTimeout(() => {
  alive = false;
}, 0);
void alive;
