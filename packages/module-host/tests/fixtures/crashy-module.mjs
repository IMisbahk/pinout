// Dies shortly after ready — exercises host crash detection + restart policy.
export default {
  capabilities: ['ping'],
  invoke(capability) {
    if (capability === 'ping') return Promise.resolve({ pong: true });
    return Promise.reject(new Error('unknown'));
  },
};
const die = setTimeout(() => process.exit(1), 150);
die.unref();
