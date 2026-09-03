// Echo fixture: answers invokes, can be told to crash or stall.
const state = { echoes: 0 };
const backend = {
  capabilities: ['echo', 'crash', 'stall', 'emit'],
  invoke(capability, args) {
    if (capability === 'echo') {
      state.echoes += 1;
      return Promise.resolve({ echoed: args.message ?? null, echoes: state.echoes });
    }
    if (capability === 'crash') {
      process.exit(1);
    }
    if (capability === 'stall') {
      return new Promise(() => undefined); // never resolves
    }
    if (capability === 'emit') {
      // Events flow through the worker's subscribe shim below.
      handler('fixture.event', { from: 'fixture' });
      return Promise.resolve({ emitted: true });
    }
    return Promise.reject(new Error(`Unknown capability '${capability}'.`));
  },
  close() {
    return Promise.resolve();
  },
};

let handler = () => undefined;
backend.subscribe = (fn) => {
  handler = fn;
  return () => undefined;
};

export default backend;
