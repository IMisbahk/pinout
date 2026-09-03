# Production architecture (design boundary)

The repository demonstrates a local control plane. A production deployment should preserve its interfaces while adding operational controls around them.

```text
Operator / agent application
          │ authenticated, scoped API
          ▼
Policy + approval boundary
          │ capability invocation + audit event
          ▼
Pinout runtime (isolated process)
     ┌────┴───────────┐
     │                │
 module backends   state/event store
     │
 transport gateway → device / controller → physical system
```

## Required controls outside this repository

- Authenticate callers and authorize per device, capability, and environment.
- Separate development, staging, and physical production networks.
- Put an independent emergency stop and hardware interlock in the safety circuit.
- Store secrets in an OS or deployment secret manager, not module source or logs.
- Record who/what invoked a capability, policy result, device identity, and outcome without logging sensitive payloads by default.
- Pin and review module artifacts; test upgrades and provide rollback.
- Monitor device health, transport timeouts, stale state, and repeated policy denials.

## Failure behavior

The runtime should fail closed on malformed input, unsupported capabilities, stale/disconnected sessions, policy violations, and transport timeouts. A deployment must additionally define safe actuator state, retry limits, manual takeover, and recovery after process or network failure.

## Current evidence and limits

This repository provides local TypeScript runtime components, serial ESP32 firmware, in-process simulated modules, and an MCP stdio adapter. It does not provide hosted identity, fleet management, a durable audit service, a safety-rated controller, high-availability guarantees, or certification. Those are design targets requiring separate engineering and validation.
