# World Lifecycle — Design Proposal

> **SUPERSEDED (2026-11-16):** This is a historical, non-binding pre-implementation proposal. The agreed initial contract and implemented behavior are documented in [world-lifecycle-contract-proposal.md](world-lifecycle-contract-proposal.md); current implementation and verification status are in [current-implementation-status.md](current-implementation-status.md). Do not use this proposal's independent-clock recommendations or open-decision list as current requirements.

> **Status:** Non-binding proposal for review. No Engine API or behavior is approved by this document.
> **Branch:** work
> **Scope:** First Engine design slice: world lifecycle, simulation ownership, time and host presentation boundaries.
> **Source baseline:** `engine/core/world-registry.js`, `engine/core/world-context.js`, `engine/core/game-clock.js`, `engine/core/simulation-scheduler.js` and their current tests.

## 1. Why this design is needed

The current Engine has several distinct concepts represented by mechanisms that are not yet connected into a world lifecycle contract:

- `WorldRegistry` registers multiple descriptors but allows only one descriptor with status `active`.
- Its own documentation explicitly excludes simulation and rendering.
- `GameClock` stores one accumulated simulation timeline and one set of pause reasons.
- `SimulationScheduler` advances one task set against that clock and has no world identity.
- `WorldContext` owns entity placement, not loading, simulation, focus or rendering.

Therefore, the current `active` status must not be overloaded to mean loaded, ready, selected, focused, visible, simulating or unpaused.

Cassandra's agreed product requirement is a persistent Main World and at most one normally active Temporary World for an expedition/encounter. The Main World is normally paused during an encounter. Engine must remain domain-neutral and must not hard-code those roles or a two-world limit.

## 2. Proposed lifecycle dimensions

Keep these dimensions independent. They may be coordinated by a host, but none should be inferred from another.

| Dimension | Proposed owner | Candidate states / meaning |
|---|---|---|
| Registration / existence | Engine World Registry | Registered descriptor; closed descriptor; unregistered after cleanup |
| Loading / readiness | Engine world lifecycle mechanism + host loader | Unloaded, loading, ready, unloading, failed |
| Simulation participation | Engine simulation runtime + host policy | Enabled or disabled for that world's simulation runtime |
| Pause | Engine clock/runtime | Independent named pause reasons; paused if any applicable reason remains |
| Selection / focus | Host application | Which world the user is currently working with; at most one focused world per host window |
| Rendering / visibility | Host presentation | Which world(s) are rendered; independent from simulation |
| Disposal | Engine lifecycle + host cleanup | Runtime resources disposed before descriptor removal |

The exact public types and whether some dimensions belong in separate services remain open. In particular, loading and rendering adapters must not leak browser/DOM dependencies into Engine Core.

## 3. Recommended simulation and time model

**Recommendation for the first implementation contract: independent per-world simulation runtimes by default.**

Each loaded world that is permitted to simulate receives a simulation runtime with:
- its own `GameClock` state (elapsed simulation time, speed and pause reasons);
- its own fixed-step scheduler, tick counter, backlog and overload state;
- a host-controlled enable/disable lifecycle;
- deterministic, ordered task execution using the existing scheduler guarantees.

A host-level frame driver may feed elapsed real time to multiple world runtimes. It must not make their simulation clocks identical or force every registered/loaded world to advance.

This supports the Cassandra case without Engine knowing Cassandra:
- the host may stop/disable the Main World's simulation runtime while a Temporary World's runtime advances;
- the Main World's accumulated simulation time and scheduler backlog remain unchanged while it is stopped;
- resuming the Main World continues its own timeline;
- a selected/focused world is not automatically the only world allowed to simulate.

This is a recommended initial contract, not an approved decision. A shared-clock / synchronized-world facility is deliberately not included until a concrete requirement proves it is needed. Do not add speculative clock-domain abstractions merely to anticipate hypothetical games.

### Pause versus simulation disabled

These should remain distinguishable:
- **Paused:** the runtime exists and is eligible to run, but one or more pause reasons prevent advancement. Existing pause-reason composition remains meaningful.
- **Simulation disabled:** the host has not scheduled that world's runtime. No new real-time input is accumulated into its scheduler backlog.
- **Unloaded:** there is no ready simulation runtime to advance.

The implementation must explicitly define what happens to any pre-existing partial fixed step/backlog when a world is disabled, unloaded or paused. The safe default proposal is to preserve it across pause/disable, and to discard it only through an explicit runtime reset/disposal operation. This must be tested.

## 4. Selection and rendering are host concerns

Selection/focus should be a host-level reference, not the simulation authority. A host can focus World A while World B continues simulating, or render multiple worlds if its presentation supports that.

Engine Core must not import DOM, Canvas, browser rendering or Cassandra UI. It may expose neutral world identity/lifecycle information for a host to consume. The host owns actual viewport, visibility, focus and input routing.

## 5. Persistence boundary

World descriptors and any durable per-world simulation state must be captured through explicit persistence participants/contracts. Do not silently persist transient browser/rendering state.

The design must decide whether simulation clock/tick/backlog state is:
1. part of each world's durable snapshot, or
2. owned by a separate host/application simulation-session participant keyed by world ID.

Recommendation: keep world identity/descriptor persistence in World Registry and simulation runtime persistence in a separate participant, so registry restoration does not pretend to restore a running scheduler. A restored world should be registered first, then loaded/rebuilt, then its simulation runtime restored and enabled according to host policy.

No save format or snapshot schema should change until this contract and migration behavior are agreed.

## 6. Required invariants

1. Multiple worlds may be registered simultaneously; Engine has no hard-coded Main/Temporary role or two-world limit.
2. A world's registration does not imply it is loaded, focused, rendered or simulating.
3. A world's focus/selection does not implicitly start, stop, pause or resume simulation.
4. Rendering visibility does not implicitly start or stop simulation.
5. A paused or simulation-disabled world does not accumulate new simulation time.
6. One world's pause/disable does not pause another world's independent runtime.
7. Each runtime preserves fixed-step determinism, task ordering, speed-segment accounting and overload safety.
8. Unload/disposal cannot leave scheduled callbacks/tasks able to mutate a disposed world.
9. A world cannot be unregistered while runtime, placement, occupancy or other owned state still references it.
10. Existing Core behavior remains compatible until an explicit migration is implemented and tested.

## 7. Acceptance scenarios before implementation

The first contract should have tests for at least these scenarios:

- Register three worlds; all coexist without a unique global simulation-active descriptor.
- Load World A and World B; leave World C registered but unloaded.
- Enable A and B; both advance independently from the same host frame driver.
- Pause A; B advances while A's time, tick and backlog remain unchanged.
- Disable A; new real time is not enqueued for A; B continues.
- Focus A while B simulates; focus change does not alter either runtime.
- Render A only while B simulates; rendering selection does not alter simulation.
- Change A's speed while B uses a different speed; their timelines remain independent.
- Trigger overload in A; B remains healthy and continues according to host policy.
- Unload/dispose A; its tasks cannot run again, while B remains unaffected.
- Restore descriptors and runtime state; verify no world accidentally starts simulating merely because it was selected or rendered.
- Preserve existing scheduler guarantees: fixed-step frame-partition invariance, deterministic task order, pause-reason composition, speed-segment accounting, bounded catch-up and explicit overload acknowledgement.

These scenarios are a design checklist, not a claim that the behavior already exists.

## 8. Migration strategy proposal

Do not mutate the existing World Registry status semantics in place as a first step.

1. Approve lifecycle dimensions and simulation-time policy.
2. Define the smallest public Engine contracts and ownership of host adapters.
3. Add new lifecycle/simulation runtime services alongside existing Core behavior.
4. Add contract tests and a compatibility bridge for current single-world hosts.
5. Migrate one host composition at a time; preserve existing entry points and save semantics.
6. Remove or deprecate the old single-active semantics only after all consumers are migrated and compatibility is verified.

No source implementation, current save schema or Pages configuration is changed by this proposal.

## 9. Decisions required before implementation

- **D1 — Simulation time:** approve independent per-world clocks/schedulers as the default, or require one shared timeline for all worlds.
- **D2 — Disabled runtime backlog:** confirm that pause/disable preserves already accumulated partial fixed-step backlog, while unloaded/disposed runtime requires explicit reset/discard.
- **D3 — Persistence:** approve separating world descriptor persistence from simulation runtime persistence.
- **D4 — Focus/rendering:** approve these as host-owned concerns, independent of Engine simulation state.

**Recommended answers:** independent per-world runtimes; preserve backlog on pause/disable; separate persistence participants; host-owned focus/rendering.

Until these decisions are accepted, this document remains a proposal and no lifecycle implementation should be started.
