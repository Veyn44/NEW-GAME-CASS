# Next Steps and Development Handoff

> Read this file first when continuing work in a new ChatGPT conversation. It describes the accepted project direction, the current phase roadmap and the immediate next action. Verify the live repository and branch before making changes.

## Current project direction

**Cassandra is the primary project. The reusable engine is emerging from its real development needs.**

We are not designing an engine for hypothetical games or building a separate engine project alongside Cassandra. We implement capabilities because Cassandra needs them, while keeping genuinely reusable technology independent from Cassandra-specific rules, content and presentation.

The result should be an independently usable engine foundation, but we will not pursue universality for its own sake. Generalize from real requirements, keep optional capabilities optional, and avoid speculative abstractions.

Practical genre direction includes top-down RPG, top-down action and colony simulation. Do not impose support for unrelated genres or physics models without a concrete Cassandra-driven requirement.

## Architectural boundaries

1. **Core** owns stable foundational primitives and contracts. Do not expand or alter it for convenience; every Core change requires a concrete technical justification and separate review.
2. **Reusable runtime/gameplay systems** implement capabilities that can serve Cassandra without embedding Cassandra-specific rules.
3. **Cassandra/game layer** owns game-specific rules, content, balance and composition.
4. **Presentation** owns rendering, HUD, UI and visual styling. It must not become the owner of gameplay state or rules.
5. **Development tools** such as Dev Lab may configure, inspect and test the real runtime, but must not become dependencies of the shipped game.

Keep these boundaries practical. Do not introduce layers or abstractions that do not solve a real problem.

## Dev Lab principles

Dev Lab remains in the main repository and is a first-class development and verification tool. It is not part of the game itself, and Cassandra must be able to run without loading or depending on Dev Lab.

- Dev Lab must use the same real runtime and gameplay systems as Cassandra. No parallel Dev Lab-only implementations of movement, world, collision or other gameplay behavior.
- Dev Lab may create, configure, inspect and test worlds and runtime instances without requiring a complete game session.
- Game content and testable world content (units, structures, objects, terrain definitions and similar data) should be sourced from the database/definition registries, not hardcoded into Dev Lab logic.
- Dev Lab controls and diagnostic tools may be implemented in code. They are tooling, not game content.
- Keep the Dev Lab entrypoint, orchestration and presentation separate from the game entrypoint and reusable runtime. A Dev Lab module must not be imported as a prerequisite for starting Cassandra.
- Keep HUD, panels, styles, layout and visual configuration outside gameplay systems. Visual presentation should be replaceable and frequently adjustable without rewriting runtime/gameplay logic.
- Dev Lab must not own gameplay rules or authoritative game state. It is a client/tool of the real systems.
- A meaningful system should have an appropriate repeatable Dev Lab test path, alongside automated tests and real Cassandra integration checks.

## Phase 3 — Physical World & Unit Foundation

### Goal

Give Cassandra a real physical world foundation: a grid-based world that can contain multiple co-located objects, structures with spatial properties, living units, collision and reusable movement. Build only what Cassandra needs, but keep the underlying capabilities independent from Cassandra-specific rules.

### Step 1 — Dev Lab Revision & Decoupling

Review and refactor the existing Dev Lab before using it as the main environment for new physical-world work.

- Separate the Dev Lab entrypoint and presentation/orchestration from the Cassandra game entrypoint.
- Ensure Cassandra can initialize and run without Dev Lab modules or Dev Lab DOM.
- Preserve the existing Dev Lab workflows and real runtime integration while removing unnecessary coupling.
- Remove hardcoded game content and source world content/definitions from the database and registries.
- Separate development controls and diagnostics from runtime/gameplay logic.
- Isolate HUD, panels, styles and visual configuration from the runtime; make presentation easy to change without changing gameplay systems.
- Do not create duplicate gameplay implementations or Dev Lab-only rules.
- Avoid unrelated gameplay changes during this step.

**Exit criteria:** Cassandra starts and runs independently; Dev Lab starts independently and uses the same runtime/gameplay systems; its content is data-driven; its presentation is isolated; existing workflows are verified.

### Step 2 — Physical World Design

Agree on the physical-world contract before implementing the grid.

- Define World identity, dimensions, coordinate conventions, cell model and world boundaries.
- Support multiple objects at the same coordinate. A cell is not limited to one entity.
- Define the relationship between terrain/ground, floor or covering objects, furniture/items, structures, living units and moving objects such as projectiles.
- Specify placement, occupancy, multi-cell footprints and which spatial properties belong to a cell versus an object.
- Separate placement/location, interaction and collision rules, and rendering order. Rendering layers must not implicitly define physical behavior.
- Define persistence expectations and the minimum spatial query contract.

The multi-object-per-coordinate requirement is accepted. The exact representation (layers, components, collections or another suitable model) remains an implementation design decision to be justified against these requirements.

### Step 3 — World Grid

Implement the reusable grid and world-space foundation for each World.

- Cell addressing, dimensions, boundaries and coordinate conversion.
- Terrain/ground data and cell-level spatial properties.
- Multiple co-located objects according to the agreed design.
- Basic spatial queries and controlled world mutation.
- Persistence readiness and automated contract/unit coverage.

Do not put Cassandra-specific gameplay rules into the reusable grid.

### Step 4 — Entities, Structures & Objects

Establish the common identity/instance model and the data-driven definitions needed by the physical world.

- Distinguish entity identity, definition, runtime instance and placement.
- Support structures (walls, doors and similar), items/objects (furniture, carpets and similar), and other required world objects.
- Model behavior through explicit capabilities/components/properties rather than one deep inheritance tree.
- A wall is an Entity/World Object with structural behavior; it is not a Unit.
- Reserve **Unit** for independently simulated or controlled agents, especially living actors.
- Terrain/ground may be cell data rather than an entity where that is the simpler and more accurate model.
- Extend definition registries only as required by actual object categories and validated use cases.

The categories above are conceptual domain distinctions, not a mandate to create a rigid class hierarchy. The final schema must follow the real requirements.

### Step 5 — Collision & Spatial Queries

Implement spatial interaction rules independently of rendering.

- Walkability and movement blocking.
- Object and structure footprints, including multi-cell objects.
- Unit-to-world and unit-to-unit collision where required.
- Separate rules for movement obstruction, projectile interaction and other collision/query purposes.
- Query APIs that do not require gameplay systems to inspect renderer internals.
- Automated tests for overlapping objects and edge cases.

A visual overlap does not automatically mean a physical collision. Each interaction must follow explicit properties/rules.

### Step 6 — Unit Foundation & Attributes

Build the reusable foundation for Units after the world and spatial contracts exist.

- Separate entity identity, unit definition and mutable runtime state.
- Define attribute ownership, defaults, validation and runtime mutation.
- Support the attributes required by Cassandra, such as movement speed and health, without hardcoding individual characters.
- Keep living-agent behavior separate from structures and ordinary objects.
- Connect unit definitions to the existing database/definition registry through explicit contracts.

Do not assume all possible attributes or agent behaviors need to be implemented in this phase.

### Step 7 — Movement System

Move general movement behavior into a reusable movement system.

- Movement intent and destination/target representation.
- Movement speed driven by unit attributes.
- World bounds and collision-aware movement.
- Clear separation between deciding where/when an agent should move and executing the movement.
- Colony Control remains responsible for Cassandra's leader selection and Draft/command behavior; it must not own generic movement mathematics.

### Step 8 — Cassandra Integration, Persistence & Phase Audit

Validate the complete capability through a practical vertical slice.

- In Dev Lab, create a world with terrain/floor, structures and objects from database definitions.
- Place and control units with different attributes.
- Verify multiple co-located objects, footprints, movement, collisions and projectile interactions where implemented.
- Verify save/load of world state, placements, unit state and definitions.
- Verify the same runtime systems in Cassandra, not a Dev Lab-only substitute.
- Run automated unit, contract, integration and persistence tests; record manual browser acceptance separately.
- Perform the phase-end architecture audit: Core boundaries, reusable/game-specific separation, duplicate or dead code, data flow, persistence, test coverage and runtime issues.
- Fix audit findings in separate reviewable PRs. Archive/snapshot only after the audit fixes are accepted and merged.

## Phase 3 non-goals

- Designing an engine for hypothetical games instead of Cassandra.
- Building a universal framework or speculative abstractions without a concrete requirement.
- Implementing unrelated genre-specific physics or systems.
- Cross-world unit transfer (deferred to a later phase).
- Expanding Core without a separately justified need.
- Rewriting the tested environment simulation or unrelated stable systems as part of Dev Lab cleanup.

## Definition of success

Cassandra uses a grid-based physical world with data-driven structures and objects, multiple co-located objects, spatial queries, collision and attribute-driven unit movement. Dev Lab independently exercises the same runtime systems without becoming a dependency of the game. Cassandra-specific rules remain outside reusable engine infrastructure, and the resulting capabilities form a practical independently usable engine foundation.

## Development workflow

For each meaningful step or capability:

1. Confirm scope, responsibility, owned state, public contract, dependencies and non-responsibilities.
2. Identify reusable runtime behavior versus Cassandra-specific rules/content and presentation.
3. Inspect the current implementation before proposing changes; preserve working behavior unless a demonstrated requirement calls for change.
4. Implement the smallest useful increment on a dedicated branch and PR.
5. Add automated unit/contract/integration coverage as appropriate.
6. Verify the relevant Dev Lab scenario and real Cassandra integration.
7. Record actual test evidence, manual browser checks, known limitations and deferred items.
8. Review the diff and CI before merging. **Do not merge into `main` without the user's explicit approval.**
9. Preserve historical branches and archive snapshots; do not delete, rename or repurpose them without an explicit decision.

Do not claim a test passed unless it was actually run. Keep automated CI results separate from manual browser acceptance.

## Planning constraints and repository references

- Active repository: `Veyn44/NEW-GAME-CASS`.
- Archive/reference repository: `Veyn44/CassandraCoreRuntimefoundation`. Preserve its history and use it only for agreed snapshots.
- The historical `next-step/phase-2` branch is retained. Do not delete, rename or reuse it. Create new work branches from the then-current `main`.
- The current tested Core behavior is a stable baseline. Consult `src/core/README.md` and `src/host/README.md`, then verify APIs against source.
- Repository requires Node.js 20 or newer. Test commands:
  - `npm run test:core`
  - `npm run test:host`
  - `npm run test:all`

## First action

Start with **Phase 3, Step 1 — Dev Lab Revision & Decoupling**.

First perform a read-only audit of the current Dev Lab entrypoint, imports, runtime initialization, data sources, presentation and existing workflows. Produce a concrete dependency map and a small proposed change plan. Do not begin code changes until that audit identifies the actual coupling and the proposed scope is reviewed.
