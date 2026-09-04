# MCP quickstart

`pinout-mcp` connects to the local `pinoutd` authority at
`PINOUT_DAEMON_URL` (default `http://127.0.0.1:8787`) and uses
`PINOUT_TOKEN`. Set `PINOUT_OWNER` to a stable agent principal. Embedded mode
is limited to hardware-free development and requires
`PINOUT_MCP_EMBEDDED=1`.

The executable transcript is
`packages/mcp/tests/daemonE2E.test.ts`. Against the simulated relay it proves
this ordered flow:

1. `pinout__read_state({deviceId:"relay-mcp"})`
2. `pinout__acquire_lease({deviceId:"relay-mcp"})`
3. `pinout__dry_run({deviceId:"relay-mcp", capability:"relay.set", args:{on:true}})`
4. `relay_mcp__relay_set({on:true, _pinout:{idempotencyKey:"mcp-e2e-once", waitFor:"accepted"}})`
5. `pinout__operation_status({operationId})`, including terminal progress
6. `pinout__cancel_operation({operationId})`, which is idempotent after completion
7. After `/v1/halt`, another `relay_mcp__relay_set` is denied with
   `SAFETY_HALTED`.

Capability descriptions explicitly label physical side effects,
reversibility, and lease requirements. `_pinout.idempotencyKey` is the retry
boundary; never retry a physical action under a new key unless a fresh action
is intended.
