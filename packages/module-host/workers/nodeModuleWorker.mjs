#!/usr/bin/env node
/**
 * Node module worker for the Pinout ModuleHost.
 *
 * Loads a module file and speaks ModuleIPC NDJSON over stdio. The module file
 * must default-export (or module.exports) either:
 *   - a PinoutModuleDefinition-compatible object (capabilities[], backend with
 *     invoke/subscribe/close), or
 *   - a factory function (config) => that object.
 *
 * Crash isolation contract: any throw during invoke becomes a structured
 * {kind:'error'} response; the worker process only dies if the module's code
 * kills the process — which is exactly what the host is designed to survive.
 */
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const MODULE_IPC_VERSION = 1;

let backend = null;
let capabilities = [];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function structuredError(error) {
  if (error && typeof error === 'object' && error.code) {
    return {
      code: String(error.code),
      category: String(error.category ?? 'MODULE'),
      message: String(error.message ?? error),
      retryable: error.retryable === true,
    };
  }
  return {
    code: 'MODULE_INVOKE_FAILED',
    category: 'MODULE',
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}

async function loadModule(modulePath, config) {
  const imported = await import(pathToFileURL(modulePath).href);
  const candidate =
    typeof imported.default === 'function'
      ? imported.default(config ?? {})
      : (imported.default ?? imported);

  if (candidate && typeof candidate.invoke === 'function') {
    backend = candidate;
  } else if (candidate && typeof candidate.createBackend === 'function') {
    backend = candidate.createBackend(config ?? {});
  } else {
    throw new Error(
      `Module at '${modulePath}' exposes no invokable backend (expected default export with invoke() or createBackend()).`,
    );
  }

  capabilities = Array.isArray(candidate.capabilities)
    ? candidate.capabilities.map((capability) =>
        typeof capability === 'string' ? capability : capability.name,
      )
    : (backend.capabilities ?? []);
}

function startHeartbeat(intervalMs) {
  const timer = setInterval(() => {
    send({ v: MODULE_IPC_VERSION, kind: 'heartbeat', payload: { at: Date.now() } });
  }, intervalMs);
  timer.unref();
}

async function main() {
  const modulePath = process.argv[2];
  if (!modulePath) {
    process.exit(2);
  }

  let initPayload = { config: {} };
  const readline = createInterface({ input: process.stdin });
  const initPromise = new Promise((resolve) => {
    readline.once('line', (line) => {
      try {
        const parsed = JSON.parse(line);
        if (parsed.kind === 'init') initPayload = parsed.payload ?? initPayload;
      } catch {
        // Host sent a malformed first line: proceed with defaults.
      }
      resolve();
    });
  });

  // Heartbeats begin immediately: the host's watchdog starts at spawn.
  startHeartbeat(1000);

  await initPromise;

  try {
    await loadModule(modulePath, initPayload.config);
    send({
      v: MODULE_IPC_VERSION,
      id: 'init',
      kind: 'ready',
      payload: { capabilities },
    });
  } catch (error) {
    send({
      v: MODULE_IPC_VERSION,
      id: 'init',
      kind: 'error',
      payload: structuredError(error),
    });
    process.exit(3);
  }

  // Forward backend events to the host.
  if (backend && typeof backend.subscribe === 'function') {
    backend.subscribe((event, payload) => {
      send({ v: MODULE_IPC_VERSION, kind: 'event', payload: { event, data: payload ?? {} } });
    });
  }

  // Invokes are processed concurrently: a stalled capability must not block
  // the protocol loop (heartbeats and other invokes keep flowing).
  for await (const line of readline) {
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      continue;
    }
    if (request.v !== MODULE_IPC_VERSION) continue;
    if (request.kind === 'shutdown') {
      if (backend && typeof backend.close === 'function') {
        await backend.close().catch(() => undefined);
      }
      process.exit(0);
    }
    if (request.kind !== 'invoke') continue;
    void backend
      .invoke(request.payload.capability, request.payload.args ?? {})
      .then((result) => {
        send({
          v: MODULE_IPC_VERSION,
          id: request.id,
          kind: 'result',
          payload: { result: result ?? {} },
        });
      })
      .catch((error) => {
        send({
          v: MODULE_IPC_VERSION,
          id: request.id,
          kind: 'error',
          payload: structuredError(error),
        });
      });
  }
}

main().catch((error) => {
  process.exitCode = 3;
  process.stderr.write(String(error?.stack ?? error));
});
