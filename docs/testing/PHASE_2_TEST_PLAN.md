# Phase 2 — Test Plan

**Status:** Phase 2 implementation and user acceptance complete on 2026-11-13. Historical checklists below record the original test procedures; final user-confirmed results and final CI evidence are recorded in the acceptance section at the end.

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


## Dev Lab Database and placement checks (2026-11-12)

- Open DATABASE from the viewport and verify it is the same canonical catalog/detail view used by the main menu, not a second registry.
- Verify selecting a definition without `spawnableAs: ["unit"]` does not expose SELECT.
- Verify SELECT is at the lower-left of the inspector and closes the Database overlay.
- Verify the blueprint follows the pointer and snaps to one world tile.
- Verify clicking an in-bounds tile creates exactly one Unit through `game.unit-api`, with matching definition and Core World Context placement.
- Verify a click outside the world bounds creates nothing and leaves placement active.
- Verify Escape cancels placement and creates nothing.
- Verify the world-size selector cannot switch worlds during placement.
- Verify the Database overlay and blueprint do not change the canvas bounding rectangle.
- User confirms the Database and placement workflow works in the current development build. The checklist above remains the required repeatable browser verification; do not mark it PASS until the checks are actually performed and recorded.


## Live Unit profile card
- Select a placed Unit while paused; Quick Select remains visible on the left.
- Press INFO and verify a large profile card opens on the right without resizing or shifting the world canvas.
- Verify the card shows the canonical portrait when available, description, personal attributes, and the selected live instance's world position.
- Verify missing artwork produces a deliberate portrait placeholder rather than a broken image.
- Close the card with CLOSE or Escape; verify the selected Unit remains selected.
- Select another Unit while the profile is open; verify the profile closes and Quick Select updates to the new Unit.
- Verify profile inspection is unavailable while simulation is running.\n- User confirms Quick Select and the INFO card currently work; browser evidence for the listed edge cases is still pending.


## Shared Database selection action
- Open the Database from the Dev Lab viewport and select a spawnable Unit definition.
- Verify SELECT appears in the Database header beside CLOSE DATABASE, not inside the definition inspector.
- Change selection to a non-spawnable definition; verify SELECT is hidden and cannot be activated.
- Change back to a spawnable Unit; verify the shared SELECT action becomes available again.
- Activate SELECT and verify the Database closes and the existing paused world-placement flow begins.
- Open the Database in main-menu browse mode; verify the selection action remains hidden.\n- User confirms the shared Database/SELECT/placement flow currently works in Dev Lab; automated/browser evidence is still pending.


## Colony Leader Draft and locomotion checks (2026-11-12)

Automated evidence at commit `793a47c89aba826e1b3945047995310e0b0bac68`:
- Core regression: 198/198 passed.
- Host/unit suite: 38/38 passed.
- Browser entry-point syntax checks passed.
- CI: [GitHub Actions run 43313238282](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43313238282).

Automated coverage now includes:
- Current leader is resolved by stable Unit ID, independently of viewport selection.
- Drafted leader moves at 4 world tiles per game-time second.
- Diagonal movement is normalized.
- No movement occurs while Draft is inactive.
- Fractional Unit positions survive persistence restore.
- Movement clamps at world boundaries.
- Colony Leader ID and Draft state survive persistence restore.

Manual browser checks still required:
- Place Johny through Dev Lab Database and verify the first placed Johny becomes leader; verify no Unit exists before placement.
- Press F while paused; verify Draft toggles and status updates.
- Resume and move with WASD; verify only Johny moves smoothly at the intended speed.
- Verify diagonal movement does not exceed cardinal speed.
- Pause and resume while Draft is active; verify Draft remains active and movement resumes.
- Pan the camera while paused, resume, then issue WASD; verify camera reacquires and follows the leader without selecting the marker.
- Verify no camera movement occurs from Draft alone when no movement key is held.
- Move against all four world edges; verify the Pawn stops at the boundary without faulting the scheduler.
- Verify selection/INFO remains inspection-only and never changes the Draft target.

Do not mark Phase 2.3 or 2.4 complete until these browser checks and the full integration/persistence acceptance path are recorded.


## Unified pointer, inspection and Draft checks (2026-11-13)

Implementation contract:
- Pause controls simulation time only; it does not switch the world viewport to a separate mouse/camera interaction layer.
- Wheel zoom and middle-button camera drag work while paused and running.
- The pointer is free over the viewport and HUD. No pointer lock or confinement is used.
- While running over the world, a crosshair follows the actual pointer position. Over HUD controls, the native system cursor remains visible.
- Left-click can inspect/select Units while running when Draft is OFF. Quick Select remains available; the larger INFO profile remains pause-only.
- F toggles Draft both paused and running.
- Draft ON forces Quick Select to the Colony Leader and blocks switching inspection to another Pawn. If the Leader is in the active world, the camera immediately centers on it.
- With Draft ON, wheel zoom/free look can move the view away. The next WASD movement tick reacquires and follows the Leader.
- Draft OFF clears the forced Quick Select target without restoring a previously inspected Unit and without moving the camera.

Manual browser checks required:
- Verify pointer visibly tracks the actual mouse on the world canvas while running.
- Move the pointer over HUD controls; verify the native cursor appears and HUD controls remain clickable.
- Verify no pointer lock or pointer confinement occurs.
- Verify wheel zoom and middle-button drag behave identically paused/running.
- While running with Draft OFF, click several Pawns and verify Quick Select switches to each.
- Verify INFO is disabled while running and becomes available after pausing; verify the profile displays current Unit data when opened.
- Press F while running; verify Draft turns ON, Quick Select switches to Colony Leader and the camera jumps to the leader if it is in the active world.
- While Draft is ON, click another Pawn; verify Quick Select remains on the Colony Leader.
- With Draft ON, use wheel zoom to look elsewhere; verify the camera stays there until WASD is pressed, then reacquires the leader.
- Press F again; verify Draft turns OFF at the current camera position, Quick Select clears, and no previous inspection selection is restored.
- Repeat Draft toggles while paused and verify behavior is the same except simulation time is stopped.
- Verify pause/resume retains existing `resumeSnapshot` semantics for held gameplay inputs.

Do not mark browser acceptance complete based only on automated CI.


## Final Phase 2 acceptance evidence — 2026-11-13

The user manually confirmed the complete current browser workflow:

- Dev Lab Database selection and Unit placement work.
- Johny locomotion, Draft/No Draft, pause/resume and camera reacquisition work.
- Save/Save As/Load work across multiple named files and different saved states.
- Stable Unit identity and position are restored without duplicates.
- Draft state is restored; a save made while running loads paused.
- Camera resets to the restored world's center on Load.
- Corrupted JSON is rejected with a visible error in the Pause Menu; the existing session remains navigable.
- Reset Lab clears the current session and does not delete or overwrite saved files; the user reloaded an existing save after reset.

Final implementation commit: `e700d22968b1978d9b5e07d7343c8d3439bc26ae`.

- Core and host tests: [GitHub Actions run 43426757709](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43426757709) — success.
- Pages deployment: [GitHub Actions run 43426757277](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43426757277) — success.

The user chose not to require a separate restore fault-injection/rollback test for Phase 2 acceptance. This is a deliberate deferral, not a passing test. The older manual checklists above remain useful regression procedures, but their historical “pending” wording is superseded by this final acceptance record.
