# Errors

Applications must never parse English prose to branch on failures. Errors
crossing a boundary (daemon API, SDK, journal, agent tools) are structured:

```jsonc
{
  "code": "SAFETY_HALTED",
  "category": "SAFETY",
  "message": "Runtime is halted.",
  "retryable": false,
  "device": "arm-01",
  "capability": "motion.move_to",
  "operation": "op_3_ab12cd34"
}
```

## Categories

`CONFIG | VALIDATION | TRANSPORT | PROTOCOL | DEVICE | CAPABILITY | POLICY |
SAFETY | LEASE | OPERATION | TIMEOUT | AUTH | MODULE | GENERATOR |
UNSUPPORTED`

## Stable codes (non-exhaustive)

| Code | Category | Retryable |
| --- | --- | --- |
| `VALIDATION_ERROR` | VALIDATION | no |
| `UNSUPPORTED_CAPABILITY` | UNSUPPORTED | no |
| `DEVICE_NOT_FOUND` | DEVICE | no |
| `TRANSPORT_TIMEOUT` | TRANSPORT | yes |
| `DISCONNECTED` | TRANSPORT | yes |
| `PROTOCOL_ERROR` | PROTOCOL | no |
| `POLICY_CONSTRAINT_VIOLATION` | POLICY | no |
| `POLICY_PRECONDITION_FAILED` | POLICY | no |
| `SAFETY_HALTED` | SAFETY | no |
| `SAFETY_ESTOP_REQUESTED` | SAFETY | no |
| `SAFETY_RATE_LIMIT` | SAFETY | later |
| `SAFETY_APPROVAL_REQUIRED` | SAFETY | no |
| `SAFETY_LEASE_REQUIRED` | SAFETY | after acquiring |
| `LEASE_CONFLICT` | LEASE | no |
| `LEASE_EXPIRED` | LEASE | yes |
| `OPERATION_TIMEOUT` | TIMEOUT | yes |
| `AUTH_REQUIRED` | AUTH | no |

Implementation: `packages/core/src/errors.ts`
(`PinoutStructuredError`, `toStructuredError`). HTTP mapping in `pinoutd`:
`400 VALIDATION/UNSUPPORTED`, `401 AUTH`, `404 NOT_FOUND`,
`409 LEASE/SAFETY/POLICY`, `500 otherwise`.
