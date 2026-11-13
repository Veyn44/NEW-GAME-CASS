# Phase 3 — Living & Intelligent Units Foundation

**Status:** Accepted working direction (2026-11-13); detailed contracts and implementation sequence must be refined before coding. This document records the previously agreed Phase 3 direction. It is not evidence that any Phase 3 feature has been implemented.
**Starting point:** `main` after the Phase 2 merge (`31c1cd4`).
**Working branch:** Create a fresh `next-step/phase-3` from the then-current `main` when Phase 3 work is authorized. Do not reuse or rename the historical `next-step/phase-2` branch.
**Core rule:** Build on the existing Core and Phase 2 gameplay contracts. No Core changes are authorized by this plan.

## 1. Purpose

Phase 2 proved that Cassandra can compose the Core, create and persist Core-backed Units, place them in a world, and exercise a first direct-control path through Dev Lab.

Phase 3 broadens that foundation from the first technical Unit/Pawn slice into a reusable model for the living and intelligent entities that can populate Cassandra. The target is not a collection of hard-coded character types. It is a coherent Unit foundation that can represent different kinds of entities and expose the capabilities they actually have.

## 2. Accepted scope

The following topics define the accepted Phase 3 direction. Their exact schemas, ownership boundaries, APIs, dependencies and order of implementation remain design work.

### 2.1 Universal Unit model

- Support both mobile and stationary Unit classes.
- Allow the model to represent biological beings, robots and other intelligent entities without creating a separate identity/lifecycle system for each category.
- Keep the existing separation: Core Entity provides generic identity/lifecycle, Cassandra Unit owns gameplay instance data, and Pawn describes a Unit's relationship to player control.
- Avoid a rigid inheritance tree where optional capabilities or traits are more appropriate.

### 2.2 Optional traits and capabilities

- Define how Units acquire optional capabilities/components rather than assuming every Unit has every property.
- A capability should have a clear owner, lifecycle and public contract.
- Mobile capability must not be assumed for stationary Units; perception, inventory, equipment and interaction capabilities may likewise be present only where appropriate.
- Do not build a generic plugin/component framework without concrete requirements. Keep the model proportional to the first real Unit use cases.

### 2.3 Attributes and statistics

- Establish the foundation for canonical definition values, mutable instance values and derived/effective values.
- Preserve the distinction between base values and runtime changes/modifiers.
- Keep attribute ownership and calculations in the responsible gameplay systems; the Database/inspector presents supplied data and does not become the gameplay authority.
- Do not invent a final exhaustive attribute list or progression model before concrete Unit types require it.

### 2.4 Perception foundation

- Define how a Unit can receive or query relevant information about its surroundings.
- Keep perception data and its access boundaries distinct from decision-making.
- Perception is a foundation for later behavior and AI; it does not itself authorize autonomous decision logic in this phase.

### 2.5 Inventory and equipment foundations

- Establish the data and ownership model needed for Units that can carry items or use equipment.
- Keep inventory/equipment optional capabilities rather than mandatory fields on every Unit.
- Define only the minimum contracts needed for the agreed Unit foundation; full crafting, economy, item progression and balancing are not implied.

### 2.6 Interactions, actions and control

- Establish reusable interaction/action concepts that can be invoked by the player or later systems through explicit gameplay contracts.
- Keep action execution out of UI and presentation code.
- Explore only the foundational combat/action hooks required by the agreed Unit model; a complete combat simulation is not implied.
- Generalize the Phase 2 movement/control path so Dev Lab can exercise any eligible mobile Unit, rather than relying on the Phase 2 temporary Johny/Colony Leader test arrangement.
- Stationary Units must not be forced through movement-specific APIs.

### 2.7 Dev Lab integration

- Dev Lab remains the early integration host for real gameplay systems.
- Provide a way to create, inspect and test representative mobile and stationary Unit definitions and their available capabilities.
- Expose controls according to the selected Unit's supported capabilities; do not show movement or other actions that the Unit cannot perform.
- Keep Dev Lab tooling and presentation separate from reusable gameplay logic so New Game and normal gameplay can compose the same systems.

## 3. Explicit exclusions and boundaries

- **Behavior and AI are deferred.** Phase 3 may establish data and perception foundations needed by future AI, but it does not implement autonomous behavior, decision trees, planning or general-purpose AI.
- A full colony/job/schedule simulation is not implied.
- A complete combat system, damage model, weapons system or enemy AI is not implied by the foundational action/combat hooks.
- Full crafting, economy, research progression and balancing tools are not automatically included.
- World generation, galaxy/navigation, expeditions and temporary-world transitions are not part of this Unit-focused scope by default.
- The approved [World Lifecycle](../architecture/WORLD_LIFECYCLE.md) remains a separate architectural constraint. Its implementation can be planned as a later phase or separately approved work.
- No changes to `src/core/` are authorized. Demonstrate a concrete domain-neutral Core limitation and obtain separate approval before proposing any Core modification.

## 4. Required design work before implementation

Before coding each system or capability, document:

1. Its authoritative data owner and non-responsibilities.
2. Whether it belongs to every Unit or is an optional capability.
3. Its public service/API, dependencies and error behavior.
4. Lifecycle and persistence ownership, including schema versioning and restore ordering.
5. How canonical definitions, live instance data and derived values relate.
6. Unit tests, public-contract tests, Core integration tests and relevant Dev Lab/manual checks.
7. How the capability behaves when absent, disabled, removed or incompatible with a Unit class.

Follow [System Development Standard](../standards/SYSTEM_DEVELOPMENT_STANDARD.md). Preserve the Phase 2 rule that presentation and Dev Lab tools never own authoritative gameplay state.

## 5. Acceptance direction

Phase 3 should leave Cassandra with a tested, extensible Unit foundation that can represent multiple Unit classes and optional capabilities, expose their data through stable gameplay contracts, and exercise eligible mobile Units through Dev Lab. Acceptance criteria and test counts must be made concrete in the phase branch before implementation begins; no tests are claimed as passing by this planning document.

## 6. Related accepted decisions

- [Phase 2 system contracts](../architecture/PHASE_2_SYSTEM_CONTRACTS.md) — existing Entity → Unit ownership, persistence and movement/control boundaries.
- [Game systems architecture](../architecture/GAME_SYSTEMS_ARCHITECTURE.md) — system ownership and dependencies.
- [Application shell and modes](../architecture/APPLICATION_SHELL_AND_MODES.md) — Dev Lab and New Game separation.
- [World Lifecycle](../architecture/WORLD_LIFECYCLE.md) — persistent world and at most one active temporary world; separate from the Phase 3 Unit scope.
- `WHATANDWHY.md` — canonical record of accepted game decisions.

## 7. Change log

| Date | Change |
|---|---|
| 2026-11-13 | Recorded the previously accepted Phase 3 working direction as Living & Intelligent Units Foundation. Detailed contracts and implementation order remain open. |
