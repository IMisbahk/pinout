# Safety

Safety is enforced by deterministic runtime logic. A prompt — however
persuasive — cannot override these rules.

## Policy engine v2

`packages/core/src/policy/safety.ts` evaluates rules of kinds:

| Kind | Enforces |
| --- | --- |
| `numericRange` | Argument bounds (e.g. `temperature <= 80 C`) |
| `stateEquals` | State preconditions (e.g. `door == 'closed'`) |
| `workspaceBounds` | TCP stays inside a permitted box |
| `rate` | Maximum invocations per sliding window |
| `interlock` | External interlock holds (e.g. `door.closed == true`) |
| `sequence` | A sequence has reached a minimum step |
| `approval` | A fresh, unused operator approval exists |
| `lease` | Caller holds an active lease |
| `deadman` | Deadman heartbeat is fresh |
| `resource` | Budget not exhausted (e.g. motion-seconds) |

The legacy engine (`numericRange` / `stateEquals` / `workspaceBounds` /
`custom`) keeps its exact previous semantics; v2 kinds throw structured
`SAFETY_*` errors with machine-readable codes.

Rejections surface as `PolicyDecision { allowed: false, code, message,
ruleId }` — applications branch on codes, never prose.

## Provenance and strictness

Constraints carry provenance: `DOCUMENTED` (vendor manual), `CONFIGURED`
(deployment), `INFERRED` (tooling), `UNKNOWN`, `CONFLICTED`.

- Module policies establish the **baseline** limits.
- Deployment policies may only make them **stricter**.
- A deployment that would widen a module range or contradict a module
  precondition produces a `ConstraintConflict` for human review — it is never
  silently applied.
- `INFERRED` constraints are not automatically hard rules without sufficient
  evidence.

## Halt / E-Stop semantics

The `HaltCoordinator` (`packages/core/src/halt/haltCoordinator.ts`) tracks:
`NORMAL | RESTRICTED | HALTED | ESTOP_REQUESTED | FAULTED`.

- While `HALTED`/`ESTOP_REQUESTED`/`FAULTED`, physical side-effect invocations
  are rejected with `SAFETY_*` errors.
- E-stop is **sticky**: `clearEstop()` leaves the runtime `HALTED`; an
  explicit `resume()` is still required.
- `resume()` is refused while an estop or fault is uncleared.
- Every transition is an auditable `safety.*` event.

> **This is not a certified emergency-stop system.** A software API cannot
> replace hardware e-stop circuits, safety relays, or interlocks. Pinout
> coordinates software-side response only; deployments that move machinery
> must have independent hardware safeguards.

## Danger classification

Capabilities carry descriptive danger levels
(`READ_ONLY | LOW_RISK | PHYSICAL_SIDE_EFFECT | HIGH_RISK`). Tool exports and
permission systems use them to decide what to guard; enforcement remains
policy-based. A language model must never be the arbiter of whether a call is
safe.
