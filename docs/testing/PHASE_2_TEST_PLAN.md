# Phase 2 — Test Plan

**Status:** Phase 2.1 host runtime tests implemented and verified; Pawn/gameplay test layers remain planned.

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

## Verified runs

| Date | Commit | Command | Result | Evidence |
|---|---|---|---|---|
| 2026-11-12 | `62ee4748cd779f8468b67d6a6ce13468b518109c` | `npm run test:all` | Core 198/198 passed; host 6/6 passed; 0 failures | [GitHub Actions run 43198861177](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43198861177) |

The host suite is currently `tests/unit/host-runtime.test.js`; run it with `npm run test:host`. The full regression command is `npm run test:all`.

## Phase 2 gates

### 2.0 — Architecture
- No gameplay tests required yet.
- Verify all documented Core service IDs and contracts against the actual source.
- Verify no planned dependency requires changing Core.

### 2.1 — Host runtime

**Verified:** 6/6 automated host tests pass in the CI run above. These cover explicit adapter requirement, startup/shutdown, scheduler advancement, pause/resume, startup failure cleanup and lifecycle guards.
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


## Dev Lab viewport correction checks (2026-11-12)

- Verify startup registers 64, 128 and 256 square descriptors and activates 128 by default.
- Verify startup does not call createUnit and the initial Unit list is empty.
- Verify selecting a preset activates the descriptor with matching dimensions.
- Verify Quick Select INFO cannot open while running and is read-only while paused.
- Compare canvas bounding rectangle before selection, after selection and after clearing selection; dimensions must remain unchanged.
- Verify overlay controls do not leak pointer events to world selection, while clicks outside the overlay reach the canvas.
- Verify all three presets and empty-space selection clearing in a real browser. Record manual checks separately from automated results.
