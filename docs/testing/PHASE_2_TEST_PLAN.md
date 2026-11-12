# Phase 2 — Test Plan

**Status:** planned; no Phase 2 gameplay tests exist yet.

## Test layers

| Layer | Location | Purpose |
|---|---|---|
| Core regression | Existing `tests/` and `npm run test:core` | Protect the frozen Core baseline |
| Unit | `tests/unit/` | Test local system rules and state transitions |
| Contract | `tests/contract/` | Verify public services, validation and stable errors |
| Integration | `tests/integration/` | Verify real interaction with Core services |
| End-to-end | `tests/e2e/` | Exercise host → world → Pawn → movement |

## Required evidence per substep

For every substep, record:
- exact test command;
- runtime/toolchain version;
- number of tests executed, passed and failed;
- CI run link or other reproducible evidence;
- manual browser checks separately from automated results;
- known limitations and tests deliberately deferred.

## Phase 2 gates

### 2.0 — Architecture
- No gameplay tests required yet.
- Verify all documented Core service IDs and contracts against the actual source.
- Verify no planned dependency requires changing Core.

### 2.1 — Host runtime
- Valid composition starts and destroys cleanly.
- Invalid composition fails before partial gameplay startup.
- Failure during startup cleans up already initialized systems.
- Core regression suite remains green.

### 2.2 — World and Pawn
- Stable identity is created and retained.
- Exactly one active placement exists.
- Invalid placement and duplicate ownership are rejected.
- Pawn domain data remains owned by its system.
- Snapshot/restore and rollback preserve identity and placement.

### 2.3 — Locomotion and control
- Input adapter does not mutate domain state directly.
- Movement is applied through the declared simulation update path.
- Same fixed-step inputs produce the same result under the same runtime conditions.
- Pause prevents simulation movement.
- World boundary/collision rules are covered.

### 2.4 — Integration
- Full host → world → Pawn → movement path works.
- Save/restore preserves identity, domain state and placement.
- Start/stop, failure cleanup and pause/resume work together.
- All Core and Phase 2 automated suites pass.
- Required manual runtime checks are recorded.

## Evidence discipline

A test marked PASS must have actually run. Source inspection, a prepared test file or a successful build is not a substitute for a test result. A CI job that runs only Core tests does not prove Phase 2 gameplay behavior.
