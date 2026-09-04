# Pinout documentation

Pinout is an alpha hardware-control platform. Read the [README](../README.md) for the short, evidence-labelled overview.

- [Architecture](architecture.md) — the runtime and daemon boundaries.
- [Hardware support](hardware-support.md) — statuses generated from `hardware/catalog.json`.
- [Safety model](safety-model.md) and [security model](security-model.md).
- [Modules](modules.md) and [build a module](build-a-module.md).
- [CLI reference](cli.md), [Python quickstart](../sdk/python/README.md), and [troubleshooting](troubleshooting.md).
- [MCP integration](mcp.md) and [coffee machine example](coffee-machine.md).
- [Releasing](releasing.md) — dry-run release engineering and the alpha gate.
- [Maintainer guide](maintainers.md) — review, triage, and the intentionally gated CI workflow.

Simulation and compile tests are not hardware evidence. A catalog row may only claim hardware verification when it links to a dated record under `hardware/records/`.
