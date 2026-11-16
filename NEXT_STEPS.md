# Next Steps and Development Roadmap

> **Canonical roadmap status:** 2026-11-16. This file describes the current working plan for `work`. The source code and tests remain authoritative; implementation status and exact CI evidence are summarized in [Current implementation status](docs/architecture/current-implementation-status.md).

## Project shape — agreed direction

One repository, one project and one Pages deployment, with three distinct responsibilities:

- **Engine** is the reusable technology foundation. It must work without Cassandra or Dev Lab and must not import either application.
- **Dev Lab** is the Engine development workspace. It uses the same Engine runtime and spatial services as Cassandra; it is not a parallel gameplay implementation.
- **Cassandra** is a separate game built on Engine. It owns game rules, game-specific data, campaign state, player-facing UI, presentation and audio.

Dependency direction:

`Dev Lab → Engine`  
`Cassandra → Engine`

Neither application is a runtime prerequisite for the other. The removal tests in the architecture documentation remain the intended boundary checks.

## Repository and safety rules

- Repository: `Veyn44/NEW-GAME-CASS`.
- Stable branch: `main`; active development branch: `work`.
- Keep all ongoing implementation and verification on `work`.
- Do not merge, cherry-pick into, force-update or otherwise change `main` without the user's explicit approval.
- Do not create or delete branches without explaining why and obtaining permission.
- Do not claim browser/manual acceptance from Node/CI tests or syntax checks.
- Do not alter the previously tested environment simulation as an incidental part of spatial, lifecycle or persistence work.
- Discuss and validate new gameplay rules, public Engine contracts and significant architecture changes before implementing them.

## Ownership boundaries

### Engine
Engine owns generic entity identity, world registration/runtime lifecycle, deterministic simulation scheduling, generic spatial geometry/composition/queries/movement primitives, persistence coordination and other reusable mechanisms. It reports geometry and runtime facts; it does not decide Cassandra gameplay meaning.

### Cassandra
Cassandra owns Unit/Pawn meaning and state, movement speed and input rules, passability and collision policy, Main/Temporary World roles, expedition rules, campaign aggregates, resources, environment meaning, generation, outcomes and player-facing workflow.

### Dev Lab
Dev Lab owns editor/test UI, spatial inspection and controlled test scenarios. It must use the authoritative Engine services and must not maintain a second occupancy or movement implementation.

### Persistence
Engine owns generic snapshot/restore contracts. Cassandra and Dev Lab own separate storage adapters, formats and save identities. Cross-application save compatibility is not required. Unsupported old formats may be rejected safely; do not invent a migration chain.

## Roadmap status

### Phase 0 — Baseline and repository protection
**Completed for the current working branch.** The branch split and current CI evidence are recorded in the implementation-status document. Re-check the live branch and test state before each new implementation slice.

### Phase 1 — Architecture and ownership
**Agreed at the current conceptual level.** Engine/Dev Lab/Cassandra ownership and dependency direction are established. Individual new public contracts still require focused design and approval where marked open.

### Phase 2 — Repository restructuring
**Completed and merged to `main` through PR #6 on 2026-11-14.** Do not restart the mechanical restructuring. Remaining boundary cleanup is follow-up work only when a concrete dependency requires it.

### Phase 3 — Engine physical-world foundation and application integration
**Partially complete; infrastructure slices are substantially implemented on `work`.**

- **Slices 1–6 — implemented:** Grid Geometry, Spatial Composition, Spatial Queries, Movement, coordinated spatial persistence and Core Assembly integration.
- **Slice 7 — partially implemented:** Cassandra grid-backed Unit movement, Main/Temporary World session policy, runtime identity projection and persistence, Change Package/Change Buffer protocol foundations, and a candidate IndexedDB compare-and-swap backend exist. Authoritative campaign aggregate/domain handlers, full expedition workflow, complete reconciliation/disposition rules and real-browser backend verification remain open.
- **Slice 8 — implemented at the automated integration level:** Dev Lab spatial inspection and controlled test workflows use the shared Engine services. Actual browser interaction/layout acceptance remains open.
- **Slice 9 — pending final acceptance:** automated CI coverage exists, but the manual/browser acceptance checklist has not been executed.

Do not interpret “Slice 7 foundations implemented” as “Cassandra expedition gameplay is complete”. Do not invent missing campaign or environment rules to close a checklist.

### Phase 4 — Dev Lab as the Engine workspace
**Partially delivered through Slice 8.** Shared Engine spatial inspection/test integration exists. Full application-separation and browser acceptance still need review against the removal tests and actual Pages entry points.

### Phase 5 — Cassandra as an independent game host
**Not complete.** The current branch contains a Cassandra application/runtime prototype and infrastructure integrations, not the complete campaign/gameplay experience. Continue only through jointly designed, bounded gameplay slices.

### Phase 6 — Single Pages deployment and acceptance
**Pending owner-led browser verification.** Verify actual Pages source/configuration, direct entry points, refresh/deep links, assets, browser console, save/load and both application workflows. Do not infer successful deployment from workflow syntax checks.

### Phase 7 — Architecture audit and stable milestone
**Pending.** Run after the implementation scope and acceptance gates are complete. Audit dependency boundaries, duplication, dead code, runtime/browser behavior, persistence, test quality and measured performance. Fix findings in small separately verifiable changes.

## Immediate next step

The documentation baseline is now being reconciled against the live `work` implementation. After that, the next engineering task should be selected from the explicitly open Slice 7 work, with its domain contract and acceptance criteria agreed before implementation. Do not start campaign inventory, health, equipment, resources, disposition, End Expedition or Abandon Expedition rules by assumption.

The full current status, verified CI evidence and outstanding manual gates are maintained in [Current implementation status](docs/architecture/current-implementation-status.md).

## Protected constraints

- Keep the existing Engine fixed-step ordering, deterministic behavior and persistence boundaries intact unless a separately approved contract requires a change.
- Engine's initial multi-world runtime uses one global Game Clock plus committed per-world simulated time; it is deterministic and sequential, not parallel CPU simulation.
- A simulation task failure still faults/pauses the global scheduler. Per-world failure isolation and rollback are not implemented.
- World lifecycle changes that would tear down a world are rejected during an active simulation round.
- Cassandra's environment simulation is not to be modified without a concrete dependency and separate approval. The current branch audit did not locate an authoritative environment simulation module to integrate.
- No merge to `main` without explicit user approval after the user has reviewed the browser/Pages result.
