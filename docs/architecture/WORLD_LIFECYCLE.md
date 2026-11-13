# World Lifecycle — Persistent and Temporary Worlds

**Status:** Approved architecture; implementation pending.  
**Decision record:** `/WHATANDWHY.md` — “One persistent world and at most one active temporary world”.

## 1. Purpose

This document defines how Cassandra treats a long-lived persistent world and temporary worlds. It separates three concepts that must not be conflated:

1. **Existence:** a world's data and identity are retained.
2. **Registry activation:** Core World Registry identifies the one currently active map world.
3. **Simulation execution:** Cassandra advances world-scoped rules for the currently selected world.

A world can continue to exist while inactive, and an inactive world must not receive world-scoped simulation updates.

## 2. Accepted game rule

- Cassandra has exactly one persistent world for the ongoing game state.
- Cassandra permits at most one active temporary world at a time.
- At any point, exactly one world context is eligible for world-scoped simulation: the persistent world or the current temporary world.
- Entering a temporary world suspends simulation of the persistent world without deleting, closing or resetting its state.
- Returning from a temporary world reactivates the persistent world and resumes its simulation from the preserved state.
- The temporary world's end/retention policy depends on its purpose and remains to be specified by the relevant gameplay feature.

This does not yet decide whether multiple inactive temporary-world records may be retained, or whether a given temporary world is discarded, saved or reusable.

## 3. Fit with Core

Core World Registry already supports the required registry behavior:

- It can retain multiple registered world descriptors.
- It exposes one `activeWorldId`.
- `activateWorld(id)` atomically marks the selected world active and the previously active world inactive.
- `deactivateWorld(id)` clears the active-world pointer.
- Its persistence participant saves all registered world descriptors and their lifecycle status.

Therefore Cassandra does not need to change Core to represent one persistent world and one active temporary world. The persistent world remains registered with inactive status while a temporary world is active.

Core World Context can retain placements in registered worlds independently of which world is active. This lets inactive-world entities keep their positions without running that world's simulation.

## 4. Important scheduler boundary

Core's World Registry activation does **not** automatically pause or filter Scheduler tasks. The Core Scheduler executes registered simulation tasks globally according to its fixed-step contract.

Cassandra must therefore own the world-scoped simulation gate in the gameplay/host layer. World-scoped systems must only update the currently selected world. They must not keep advancing the persistent world's data while a temporary world is active.

This gate must be centralized and testable; individual systems must not invent separate interpretations of which world is active. A future world-session/coordinator service may expose the active world context and control world-scoped update eligibility.

Global runtime services that are not world-scoped (for example diagnostics or application-level orchestration) are not automatically frozen by this rule. Their exact time behavior is outside this decision.

## 5. Intended transition sequence

### Persistent world → temporary world

1. Validate that no temporary world is already active.
2. Reach a safe simulation boundary so a world transition cannot split a simulation step.
3. Stop world-scoped updates for the persistent world.
4. Register the temporary world if it does not already exist.
5. Activate it through Core World Registry; the persistent world becomes inactive.
6. Set the Cassandra world-session context to the temporary world.
7. Permit world-scoped updates only for that temporary world.

### Temporary world → persistent world

1. Reach a safe simulation boundary.
2. Stop world-scoped updates for the temporary world.
3. Apply that temporary world's explicitly defined exit policy (retain, save, close or discard); this policy is not globally decided yet.
4. Activate the persistent world through Core World Registry.
5. Set the Cassandra world-session context to the persistent world.
6. Resume world-scoped updates for the persistent world from its preserved state.

A transition must either complete as a coherent state change or leave the previous world active. Partial transitions must not result in two worlds receiving updates or in no world context being authoritative.

## 6. Ownership boundaries

| Responsibility | Owner |
|---|---|
| Registered world IDs, dimensions, active/inactive/closed status | Core World Registry |
| Entity identity | Core Entity Registry |
| Entity placement within any registered world | Core World Context |
| Tile/cell content and tile-specific rules | Cassandra world/gameplay system |
| Persistent-world domain state | Owning Cassandra gameplay systems |
| Temporary-world domain state and its exit policy | Owning Cassandra gameplay systems / relevant feature |
| Which world is eligible for world-scoped simulation | Cassandra world-session coordination layer |
| Rendering and camera view | Presentation adapter; never authoritative |

The world-session layer must not duplicate Core's world registry or entity placement data. It coordinates the game rule using Core's public APIs.

## 7. Required tests before implementation is accepted

- Register persistent and temporary worlds; activate the persistent world.
- Activate a temporary world and verify Core marks the persistent world inactive.
- Verify the persistent world's data and entity placements remain intact while inactive.
- Verify world-scoped simulation advances only the active world's state.
- Verify attempting to activate a second temporary world while one is already active is rejected by Cassandra's world-session rules.
- Return to the persistent world and verify its simulation resumes from the exact preserved state.
- Inject a failed transition and verify the previously active world remains the only authoritative simulation context.
- Save/restore registry state and world-owned data without losing inactive-world state.

## 8. Deliberately open decisions

- Whether multiple inactive temporary worlds may be retained simultaneously.
- Which temporary-world types are persistent, disposable or reusable.
- Whether temporary-world creation is synchronous or may involve asynchronous generation/loading.
- Which global (non-world-scoped) clocks or systems continue while a temporary world is active.
- Whether a temporary world can be suspended and resumed later rather than ended.
- The permanent world's actual dimensions and content.

## 9. First implementation scope

The first World/Pawn foundation should use one 128 × 128 test-world descriptor. It should prove authoritative tile/world data, Pawn identity/placement and the simulation path without implementing temporary-world transitions prematurely.

The persistent/temporary lifecycle is an approved architectural constraint for subsequent world-session work, not a reason to build a generic multi-world framework before the first real world is working.
