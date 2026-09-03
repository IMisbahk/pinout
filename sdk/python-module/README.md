# Pinout Python module SDK

Write a hardware module in Python and host it in a separate process using
`@pinout/module-host`. The SDK uses the standard library at runtime.

```sh
pip install -e 'sdk/python-module[dev]'
pytest sdk/python-module/tests -q
```

The `examples/heatlamp` directory contains a simulated module with capability
declarations, invocation results, and events. Run it from the repository with:

```sh
PYTHONPATH=sdk/python-module/src python3 -m pinout_module sdk/python-module/examples/heatlamp/heatlamp.py
```

The worker reads ModuleIPC JSON lines from stdin and writes responses to stdout.
Keep diagnostics on stderr. See `packages/module-host/README.md` for the host
configuration, protocol, restart policy, and permissions model. Process isolation
contains crashes; declared permissions are advisory and are not an OS sandbox.
