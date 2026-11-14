# Phase 3 — Physical World & Grid (Brainstorm)

> **Purpose:** Working document for thinking through and specifying the next Engine capability before implementation.
>
> **Working mode:** Discussion and specification only. Do not implement code during this phase until the complete design is reviewed and explicitly approved.
>
> **Branch:** work
> **Status:** Brainstorm in progress
> **Current focus:** Step 1 — Goals and scope

---

## How we use this document

- We work through the sections step by step, in order unless a dependency requires otherwise.
- The **Current focus** marker identifies the one section we are actively discussing.
- When we reach a decision, record it in the appropriate section and mark it as **Agreed**.
- Keep unresolved questions visible as **Open questions**. Do not silently turn assumptions into decisions.
- Record alternatives and the reason for rejecting them when a meaningful architectural choice is made.
- Update earlier sections if a later discussion changes a previous decision.
- This document is the shared source of truth for Phase 3. At the end, it should be sufficiently complete to guide implementation in a fresh conversation without reconstructing the design from chat history.
- No code implementation begins until all required sections have been discussed, the specification has been reviewed as a whole, and the user explicitly approves moving to implementation.

### Decision labels

- **Agreed** — explicitly decided.
- **Proposed** — current candidate, not yet approved.
- **Open** — requires discussion or investigation.
- **Out of scope** — intentionally deferred to another phase.

---

## Phase overview

The goal of this phase is to define a reusable physical-world foundation for Engine, informed by the needs of Cassandra but without embedding Cassandra-specific rules into Engine Core.

The existing Engine already has world registration and entity placement concepts. This phase must first understand those contracts and decide how to extend them without duplicating responsibilities or breaking existing behavior.

### Step 1 — Goals and scope
**Status:** In progress

Define what the Physical World & Grid capability must enable, what it explicitly will not do, and which requirements come from Cassandra versus the reusable Engine.

#### Cassandra gameplay requirements (recorded from discussion)

These describe Cassandra's game design. They must not automatically become restrictions inside the reusable Engine.

- Cassandra needs a **main world** containing the colony.
- Cassandra also needs a **secondary world** for expeditions, events, and encounters where the environment can be damaged and combat can take place.
- The expected Cassandra runtime arrangement is one main world plus at most one secondary world active at a time. The secondary world will often be around 128×128 cells; 256×256 is also already relevant to the game.
- The main world is the buildable colony. The secondary world is an expedition/encounter space with different gameplay rules.
- Much of the game takes place in space. Space will frequently be represented as vacuum, but vacuum is an environmental/gameplay condition, not necessarily a special kind of grid or world geometry.

#### Engine direction (candidate, not yet fully specified)

- The Engine should remain more universal than Cassandra's main-world/secondary-world arrangement.
- A square grid is the current preferred direction for this project. This is a design preference, not yet a complete grid contract.
- A coordinate system is required, but its exact representation and semantics remain open.
- The Engine should not hard-code the Cassandra concepts “colony”, “expedition”, “encounter”, or “vacuum” as world types or core spatial rules.

#### Important architecture observation to investigate

The current World Registry implementation exposes a single `activeWorldId`. Cassandra's desired arrangement may require a main and secondary world to be simultaneously available/active. We must decide whether:
- “active” in Engine means one globally selected world, while Cassandra separately manages its loaded/participating worlds; or
- the generic Engine world lifecycle must support multiple simultaneously active worlds; or
- another explicit distinction is needed (for example loaded, simulated, selected, or focused).

Do not change the existing World Registry contract until this is resolved.

#### Questions to resolve

- What does “physical world” mean in the reusable Engine, independent of Cassandra?
- Which capabilities are generic spatial infrastructure, and which are Cassandra policies?
- What is the smallest useful outcome of this phase?
- What capabilities are deliberately deferred?
- What must remain compatible with the existing Engine and Cassandra?

### Step 2 — World Geometry
**Status:** Open

Define world dimensions, coordinate representation, boundaries, coordinate systems, and whether the model must support more than one geometry/topology.

Questions to resolve:
- Are coordinates continuous, discrete, or both?
- Are dimensions finite, unbounded, or configurable by world type?
- How are boundaries represented and queried?
- Do we need support for multiple planes, levels, or dimensions?
- Which geometry concepts belong in generic Engine versus a host application?

### Step 3 — Grid
**Status:** Open

Define whether a grid exists, what a cell is, how cells are addressed, and how neighborhood relationships work.

Questions to resolve:
- Is the grid square, hexagonal, another topology, or pluggable?
- Is grid structure mandatory for every world or an optional spatial representation?
- Are cells stored explicitly or derived from coordinates?
- How are neighbors and distances defined?
- Can different worlds use different grid configurations?

### Step 4 — Spatial Occupancy
**Status:** Open

Define how physical entities occupy space, including multiple objects at one coordinate and independent spatial layers.

Candidate concepts to examine (not decisions):
- Terrain
- Structures / construction
- Items
- Units / actors
- Effects or other overlays

Questions to resolve:
- Can multiple entities occupy one coordinate?
- Which layers are independent, and can a layer contain multiple entities?
- Can an entity occupy more than one cell?
- How are size, footprint, and orientation represented?
- Is occupancy owned by a dedicated spatial service/system or by the world itself?
- How does occupancy relate to Entity Registry identity and World Context placement?

### Step 5 — Spatial Queries
**Status:** Open

Define the read/query API for spatial data.

Questions to resolve:
- Query all entities at a position.
- Query entities by layer/category/type.
- Query neighboring cells or a radius/area.
- Find empty or eligible positions.
- Query intersecting footprints.
- Query behavior for inactive, unloaded, or out-of-bounds regions.
- Performance expectations and indexing requirements.

### Step 6 — Movement and Collision
**Status:** Open

Decide how much movement and collision belong in this phase versus a later phase.

Questions to resolve:
- Does this phase only provide spatial placement and queries?
- Is movement a separate system built on top of occupancy?
- What does collision mean for different layers and entity types?
- Are blocking rules generic capabilities or host-defined policies?
- How are atomic moves and failed moves handled?
- Is pathfinding explicitly deferred?

### Step 7 — Entity and application boundaries
**Status:** Open

Define ownership and contracts between Engine Core, reusable spatial capabilities, Cassandra gameplay systems, and presentation.

Questions to resolve:
- What remains the responsibility of Entity Registry?
- What remains the responsibility of World Registry and World Context?
- Which new service/API is needed, if any?
- Which rules must be supplied by the host application?
- How can presentation/rendering consume spatial data without owning it?
- How do we avoid Engine importing Cassandra concepts?

### Step 8 — Persistence and compatibility
**Status:** Open

Define persistence of geometry, grid configuration, occupancy, and spatial state.

Questions to resolve:
- Which component owns the spatial snapshot?
- How are restore dependencies ordered and validated?
- How are invalid or conflicting placements handled during restore?
- What migrations are required?
- How do we preserve existing .cass save compatibility?
- What happens to existing worlds and placements when the new capability is introduced?

### Step 9 — Testing and acceptance criteria
**Status:** Open

Define observable conditions that prove the design and implementation are correct.

Include:
- Unit-level invariants and failure cases.
- Integration with Entity Registry, World Registry, World Context, and persistence.
- Multiple entities at one coordinate and across layers.
- Boundary and invalid-coordinate behavior.
- Deterministic behavior where required.
- Compatibility tests for existing saves and existing Cassandra workflows.
- Explicitly stated performance expectations only where justified.

### Step 10 — Implementation plan
**Status:** Open

Only after the preceding design is settled, specify:
- Exact modules/files to add or change.
- Public APIs and ownership of each responsibility.
- Dependency and initialization order.
- Persistence participants and migrations.
- Test files and test cases.
- Implementation sequence and review checkpoints.
- Explicit list of untouched systems and files.

No implementation starts from this section until the complete specification is approved.

---

## Cross-cutting constraints and guardrails

- Engine remains application- and domain-neutral. Cassandra-specific gameplay rules stay in Cassandra.
- Do not assume a single entity per coordinate.
- Do not assume a tile-only or square-grid world before the geometry discussion establishes that requirement.
- Do not mix rendering/art assets with authoritative spatial state. Presentation may consume spatial data, but visual representation must not become the source of truth for occupancy or world geometry.
- Do not modify tested environment/simulation behavior unless a concrete dependency is demonstrated and separately agreed.
- Preserve .cass save compatibility.
- Prefer the smallest set of clear, stable contracts over speculative abstractions.
- Avoid broad refactors unrelated to the agreed Phase 3 scope.

---

## Current decisions

- **Cassandra world roles — Agreed as a game requirement:** Cassandra has a main colony world and a secondary expedition/encounter world. At most one secondary world is expected alongside the main world.
- **Cassandra world scale — Recorded requirement:** 128×128 is a common secondary-world size; 256×256 must remain supported by the game.
- **Grid preference — Proposed:** square grid, with an explicit coordinate system. Detailed geometry and grid semantics remain open.
- **Engine boundary — Agreed principle:** Engine spatial capabilities must be more universal than Cassandra's world roles and gameplay vocabulary.

## Open questions / investigation notes

- Audit the current uses of World Registry, World Context, Entity Registry, and any existing Cassandra/shared spatial or viewport code before proposing new contracts.
- Distinguish authoritative world/spatial state from viewport geometry, visual presentation, and input coordinates.
- Resolve the meaning of “active world” and whether multiple worlds can be loaded, simulated, or selected concurrently.
- Clarify whether vacuum is solely an environmental state or whether any physical-world representation is needed for empty space.
- Clarify the lifecycle and ownership of the main colony world and temporary expedition/encounter worlds.
