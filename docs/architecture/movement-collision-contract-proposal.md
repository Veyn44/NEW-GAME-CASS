# Movement and Collision Contract — Working Proposal

**Status:** Slice 4 generic Engine movement transaction implemented on `work`; Cassandra gameplay integration remains deferred  
**Scope:** Generic movement transaction and spatial collision/overlap primitives above Spatial Composition  
**Branch:** `work`  
**Source audit:** 2026-11-15

This document defines the boundary between reusable Engine spatial operations and host-owned movement/collision behavior. It builds on the optional Grid Geometry and Spatial Composition contracts. It does not authorize source/runtime changes.

Technical defaults below are intended to guide the next implementation plan. They should be refined only where a real integration requirement appears.

## 1. Recommended scope decision

Movement and collision should be included in the physical-world foundation as **small generic spatial primitives**, not as a complete movement simulation framework.

Engine should provide:
- Atomic relocation of an entity's complete spatial footprint.
- Validation of candidate target footprints against grid bounds.
- Queries for occupied cells, intersecting footprints and spatial overlaps.
- A host-supplied policy hook that can accept or reject a proposed move.
- A consistent result for accepted, rejected and invalid moves.

Engine should not provide:
- Pawn/Unit movement rules or movement speed.
- Input handling, WASD/key bindings, Draft/possession rules or player-control eligibility.
- Universal blocking/passability semantics.
- Collision response such as damage, bounce, knockback, destruction or projectile impact.
- Pathfinding, navigation meshes or AI movement.
- A mandatory continuous-physics/velocity simulation.

This is the smallest reusable capability that Cassandra and Dev Lab can both exercise without moving game rules into Core.

## 2. Ownership boundaries

### 2.1 Engine

Engine owns generic mechanisms:
- The spatial move transaction and its atomicity.
- Footprint transformation and target-cell derivation.
- Bounds checks for every occupied cell.
- Queries for occupancy and geometric overlap.
- Stable, deterministic collision/overlap query results.
- A policy boundary through which the host can decide whether a proposed move is legal.
- Generic movement result/error categories.

Engine does not know what a Pawn, wall, bullet, door, debris or vehicle means.

### 2.2 Cassandra

Cassandra owns all game-specific movement and collision meaning:
- Which entities can move, and under what conditions.
- Pawn/Unit movement speed, acceleration if any, diagonal normalization and movement cadence.
- Draft/possession eligibility and input-to-movement mapping.
- Whether a wall, rock, closed door, furniture, another Pawn or debris blocks a particular mover.
- Whether an entity is passable, blocking, destructible, pushable, climbable or traversable.
- Projectile behavior and hit resolution.
- Damage, knockback, death, destruction, sound, effects and gameplay consequences.
- Any cost, stamina, oxygen or other movement constraints.

Cassandra supplies the policy used by Engine's generic move operation. The policy can depend on the moving entity, its current state, the proposed target footprint and the spatial contents encountered.

### 2.3 Dev Lab

Dev Lab owns tools for:
- Creating reproducible movement/collision scenarios.
- Selecting a test entity and issuing generic relocation attempts.
- Inspecting target footprints and overlap query results.
- Visualizing accepted/rejected moves and the reason supplied by the host policy.
- Testing Engine primitives with a neutral test policy as well as optional application-provided policies.

Dev Lab must not create a parallel Pawn movement or collision implementation.

### 2.4 Presentation

Presentation may animate between an entity's previous and committed positions, but visual interpolation is not authoritative occupancy. Rendering must not decide whether a move is legal or whether a collision occurred.

## 3. Movement is a transaction over spatial occupancy

The spatial model from the preceding contract remains authoritative. An entity's current footprint is a set of occupied cells derived from its anchor, canonical footprint offsets and orientation.

A generic move request should conceptually contain:
- Entity ID.
- Target world ID.
- Target anchor cell.
- Target orientation (or preserve current orientation).
- Optional host-defined context for policy evaluation.

The service resolves the entity's current occupancy and derives the complete target footprint. The host policy receives enough information to decide whether that transition is permitted; it does not mutate the spatial index while evaluating.

### 3.1 Atomic move sequence

1. Resolve the entity and its current spatial occupancy.
2. Validate that the entity is eligible for spatial movement under generic lifecycle rules.
3. Validate the target world and its grid capability.
4. Derive the complete target footprint using the target anchor/orientation.
5. Reject the request if any target cell is out of bounds.
6. Query all relevant spatial contents and overlapping footprints.
7. Invoke the host-supplied movement/overlap policy.
8. If rejected, return a structured rejection and leave the old occupancy unchanged.
9. If accepted, prepare and commit the complete occupancy replacement synchronously.
10. Publish notifications only after the new occupancy is internally consistent.

No intermediate state may expose only part of a multi-cell footprint. A failed move must leave the original footprint and all unrelated contents unchanged.

### 3.2 No implicit movement side effects

A successful Engine move changes spatial occupancy only. It does not:
- Change entity health or status.
- Trigger damage or destruction.
- Consume game resources.
- Change player control/possession.
- Advance simulation time.
- Decide whether the entity should continue moving next tick.

The host may react to the committed move through its own systems/events.

## 4. Collision and overlap are queries plus host policy

The word “collision” covers different game concepts. Engine should not collapse them into one boolean property.

The generic layer can determine geometric facts:
- Which cells the target footprint would occupy.
- Which entity footprints intersect those cells.
- Which cell-associated contents exist in those cells.
- Which entities overlap a specified cell set or footprint.
- Whether two footprints geometrically intersect.

The host determines the meaning of those facts for a particular movement attempt.

A host policy may consider:
- Moving entity identity/kind and domain state.
- Existing entities and cell-associated contents.
- Movement mode or action context.
- Direction of travel and previous footprint.
- Whether an overlap is temporary or persistent.
- Any game-specific permissions, doors, ladders, hazards or special traversal rules.

A generic overlap result is not automatically a collision, and a collision is not necessarily a blocking event. For example, a projectile may overlap a Pawn to register a hit; a Pawn may share a cell with a floor; debris may be traversable; a large machine may be forbidden from overlapping another machine.

Engine must not infer physical behavior from category names, entity kinds or rendering layers.

## 5. Passability and blocking policy

Passability is host-defined, not a universal Engine property.

The Engine may expose the contents and footprint intersections required to evaluate a movement request, but it should not provide a fixed `blocksMovement` meaning that every host must obey.

A host can implement policies such as:
- Block movement if any target cell contains a blocking structure.
- Allow a Pawn to enter a cell occupied by a friendly or non-blocking entity.
- Allow movement through a door only if the door is open.
- Allow projectiles to cross a cell that blocks Pawns.
- Allow special movement modes to ignore selected obstacles.
- Reject movement when the target footprint leaves the world bounds.

These are examples of possible Cassandra rules, not approved game balance/behavior specifications.

The policy should be deterministic for the same authoritative state and request. It should return a stable decision and optional structured reason; it should not directly mutate spatial state.

## 6. Different entity classes need different collision behavior

The Engine treats all entity footprints uniformly as geometry. Cassandra chooses behavior by entity class and action.

| Example | Engine contribution | Cassandra-owned meaning |
|---|---|---|
| Pawn / Unit | Candidate footprint, occupancy and overlap queries; atomic move | Speed, Draft eligibility, blocking rules, movement cost, consequences |
| Structure / furniture | Occupied footprint and overlap result | Whether it blocks, can be entered, moved, built over or destroyed |
| Projectile | Position/footprint query and relocation primitive if needed | Trajectory, hit detection, impact, damage and penetration |
| Debris | Occupancy and overlap query | Whether it blocks, slows, can be crossed or collected |
| Vehicle / large creature | Multi-cell footprint and atomic relocation | Turning/movement rules, collision response and special traversal |
| Terrain / rock / floor | Cell-associated content query | Passability, mining, support, hazards and environmental rules |

The table intentionally does not prescribe which Cassandra objects are entities versus cell-associated contents. That choice remains with Cassandra's data model.

## 7. Movement granularity and presentation

The generic spatial transaction operates on grid-cell footprints. It does not require the host to animate movement in discrete visual jumps.

A host may:
- Move an entity one cell per accepted action.
- Move it several cells over a sequence of validated steps.
- Interpolate its visual position between committed cell anchors.
- Implement continuous visual motion while committing occupancy at defined authoritative boundaries.

The authoritative occupancy must remain unambiguous at every simulation boundary. Presentation interpolation must not create a second, conflicting source of truth.

If Cassandra needs continuous collision/physics at sub-cell precision, that is a separate capability and should not be silently approximated by the grid contract.

## 8. Cross-world movement versus temporary-world transfer

These are separate operations.

### Spatial relocation between worlds

A generic spatial relocation may move the same entity ID from one grid world to another if:
- Both worlds are valid and ready for the operation.
- The target footprint is valid and within bounds.
- Host policy permits the relocation.
- The complete source removal and target insertion can be committed consistently.

This operation does not clone identity, copy domain state or decide why the entity changed worlds.

### Cassandra temporary-world transfer

Expedition start/end/abandon is a Cassandra workflow. It may involve selecting participating entities, creating temporary representations, preserving identity mappings, applying outcomes and deciding which changes return to the Main World.

The generic spatial move API must not be used as a substitute for that change-package/expedition transaction. The same entity ID appearing in two separate world representations, or a temporary copy using a scoped identity, requires explicit host-level identity and persistence policy.

## 9. Failure and result semantics

A move operation should distinguish at least these outcomes:
- **Moved:** complete target occupancy committed.
- **Rejected by policy:** target is geometrically valid, but host rules disallow it; current occupancy is unchanged.
- **Invalid request:** malformed ID, coordinate, orientation, footprint or target.
- **Out of bounds:** one or more target footprint cells exceed the grid.
- **Unavailable world/grid:** target world is absent, not ready for spatial operations or has no grid capability.
- **Unknown/ineligible entity:** identity cannot participate in the requested operation.
- **Internal failure:** the spatial operation could not complete; no partial occupancy may be exposed.

A policy rejection is an expected gameplay result, not an Engine runtime fault. Invalid API use should produce stable structured errors. An unexpected internal failure must preserve the previous complete occupancy or force the service/runtime into a clearly faulted recovery state; it must never silently leave a partial footprint.

The policy evaluation phase must be side-effect-free. Any domain consequences happen after the accepted move and are owned by the host.

## 10. Pathfinding and navigation are deferred

Pathfinding is explicitly out of scope for this contract.

The occupancy and query primitives may later support:
- Neighbor passability checks.
- Reachability and flood-fill.
- Route planning.
- Multi-agent navigation.
- Cost-aware path selection.

But none of these algorithms is required to implement atomic movement and collision/overlap queries. Do not introduce a navigation graph, path cache, A*, flow fields or AI movement into the first spatial foundation without a concrete gameplay requirement.

Cassandra may initially issue direct movement attempts and let its own rules decide each step. A later pathfinding slice can define how it uses spatial queries and passability policy.

## 11. Persistence

Movement does not require a separate movement-history snapshot by default. The spatial composition persistence participant stores the committed current occupancy, including each entity's anchor, footprint and orientation.

- In-progress presentation interpolation is transient and not persisted.
- Rejected movement attempts are not persisted.
- Movement history, trails or replay logs are host/application features unless a reusable requirement is demonstrated.
- Restore validates the final occupancy against world/grid descriptors and registered entity identities.
- A save must never contain a partially committed multi-cell move.

If a game later needs durable movement orders or queued actions, those belong to the owning simulation/game systems and their own persistence participants.

## 12. Acceptance scenarios

1. A valid one-cell entity move commits the new occupancy and removes the old occupancy.
2. A valid multi-cell entity move replaces every old occupied cell with the complete target footprint.
3. A rejected move preserves the entity's full original footprint.
4. An out-of-bounds target is rejected even when the anchor alone is in bounds.
5. A host policy can allow two entities to overlap or share a cell.
6. A host policy can reject an overlap without the Engine hard-coding a universal blocker rule.
7. Different mover kinds can receive different policy decisions for the same target contents.
8. A projectile can geometrically overlap another entity without the Engine automatically applying damage or blocking it.
9. A successful move changes occupancy only; it does not change health, inventory, simulation time or control ownership.
10. Query results for the same spatial state are deterministic.
11. A move between two grid worlds preserves one entity ID and commits source/target occupancy consistently when host policy allows it.
12. A temporary-world expedition transfer is not treated as an ordinary spatial move.
13. A non-grid world cannot accidentally accept grid-cell movement.
14. Presentation interpolation does not change authoritative occupancy.
15. Pathfinding is not required for the movement transaction to function.
16. Save/restore during a safe boundary returns the last fully committed occupancy, never an intermediate move state.
17. Policy rejection is distinguishable from invalid request and internal failure.
18. Existing Entity Registry, World Context, Grid Geometry and Spatial Composition contracts remain intact unless a separately reviewed integration step requires a change.

## 13. Explicitly deferred

- Cassandra Pawn/Unit movement implementation and input binding.
- Draft mode, possession and player-control rules.
- Exact speed, acceleration, diagonal normalization, movement costs and movement cadence.
- Cassandra passability/blocking matrix for terrain, doors, structures, Pawns, enemies, projectiles and debris.
- Damage, knockback, destruction, hit resolution and other collision responses.
- Pathfinding, route planning and AI navigation.
- Continuous physics, sub-cell collision and rigid-body simulation.
- Movement orders, queues, replay/history and network synchronization.
- Expedition transfer/change-set protocol.

## 14. Current source facts and audit boundary

The current Engine Core source and documentation confirm:
- Entity Registry owns stable identity and generic lifecycle, not movement or domain state.
- World Context currently stores one world/store placement per entity, validates finite x/y and world bounds, and atomically replaces a single placement record on move.
- World Context does not currently provide grid occupancy, multi-cell footprints, collision queries or host movement policies.
- The documented Persistence coordinator provides ordered participants, schema validation/migration, side-effect-free preparation and commit/rollback.
- The existing Cassandra ownership roadmap explicitly assigns Unit/Pawn movement, speed, eligibility, Draft meaning and concrete behavior to Cassandra, while assigning generic Control Modes and input/action infrastructure to Engine.

The repository code-search audit available for this review did not return indexed Cassandra movement implementation files. Accordingly, this document does not claim to have verified the current Pawn movement implementation or its exact runtime behavior. Before any code implementation, the relevant current Cassandra movement files and tests must be located and inspected; this proposal does not assume that current implementation should be replaced.

## 15. Slice 4 implementation checkpoint

**Implemented on `work`:**
- `engine/spatial/spatial-movement.js` provides synchronous host-policy movement over an entity's existing grid footprint.
- Core Assembly registers `core.spatial-movement`; the host supplies a policy for each move, so Engine has no permissive default.
- The policy receives immutable mover/current/target facts, per-target-cell content and occupancy facts, and deduplicated geometric overlaps.
- A policy may return a boolean or `{ accepted, code?, reason? }`. Asynchronous, malformed and throwing policies do not commit movement.
- Accepted movement commits only through Placement Coordinator. Rejected, invalid, unavailable and out-of-bounds outcomes preserve the previous placement. Same-position requests return `unchanged`.
- Movement preserves the entity's existing footprint; changing footprint size/shape is a separate placement operation, not a movement side effect.
- Re-entrant movement is rejected. During policy evaluation, Spatial Composition content/occupancy writes and Placement Coordinator commits/restore rollbacks are guarded. Policy decision properties are read while those guards are active.
- Focused tests cover multi-cell translation/rotation, cross-world relocation, overlaps, cell content, rejection, same-position, bounds, policy failures, re-entrancy and mutation attempts during policy evaluation.

The policy remains a host contract: it must be deterministic and side-effect-free with respect to external host-owned state. The Engine prevents mutations through its spatial-content and placement mutation surfaces during evaluation. Cassandra movement speed, input, interpolation, passability and collision consequences are not integrated or modified by this slice.
