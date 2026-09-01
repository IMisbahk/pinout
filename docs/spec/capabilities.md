# Capabilities

A capability is the unit of interaction with a device. Capabilities carry
enough metadata for both programs and AI systems to use them correctly.

## Kinds

| Kind | Meaning | Example |
| --- | --- | --- |
| `action` | Performs something | `motion.move_to`, `gpio.write` |
| `sensor` | Reads a quantity | `temperature.read` |
| `stream` | High-rate data | `camera.rgb` |
| `state` | Reads/writes state | `power.output` |
| `event` | Emits events | `motion.completed` |

## Metadata

Every capability declares:

- `id`, `name`, `description`
- JSON-schema `arguments` (with canonical `unit` for physical quantities) and
  `result`
- `danger`: `READ_ONLY | LOW_RISK | PHYSICAL_SIDE_EFFECT | HIGH_RISK`
- `idempotent`, `duration` (`immediate | short | long_running`),
  `cancellable`
- `realTimeClass`: `realtime` capabilities run on-device or in firmware —
  never by a language model
- `requiredPermissions`, `requiredState`, `producesState`
- `rateLimitPerSecond`, `streaming` behavior

Danger is descriptive metadata for permission systems and UIs. It is never
the enforcement mechanism — policies are.

## Simple devices stay simple

A GPIO write needs a pin and a value, not a legal contract. Modules should
provide rich metadata where it matters (motion, industrial, lab instruments)
and keep basic I/O lean.

## Units

Physical quantities carry explicit units (`m`, `rad`, `N`, `C`, …).
Conversions are deterministic (`packages/core/src/spec/units.ts`); ambiguous
conversions (e.g. raw `percent` without a range) throw instead of guessing.
Native units are preserved alongside canonical ones when conversion is
uncertain.

## Frames

Poses are always `FrameReference { frame, pose }`. Coordinates in different
frames (`world`, `base`, `tool0`, `tcp`, `camera`) are never silently
interchangeable.
