# Spatial Composition and Occupancy Contract — Working Proposal

**Status:** Working contract; conceptual direction agreed, technical defaults proposed  
**Scope:** Generic Engine spatial composition, cell-associated contents, entity occupancy and multi-cell footprints  
**Branch:** `work`  
**Source audit:** 2026-11-15

This document defines the next spatial layer above optional grid geometry. It separates entity identity, spatial placement, cell-associated data, occupancy indexes, and host/game rules. The intent is to provide a concrete implementation target without turning Engine into a game-specific tile system.

Technical defaults in this proposal are intended to be used unless implementation reveals a concrete reason to refine them. This proposal does not authorize source/runtime changes by itself.

## 1. Agreed direction and invariants

The following are established project requirements:

- A grid cell may contain multiple independent spatial contents.
- A category/layer may contain multiple entities or contents at the same coordinate.
- There is no fixed number of layers or categories.
- One entity may occupy one or multiple cells while retaining one stable entity identity and one lifecycle.
- The number of occupied cells is not the number of entities.
- Tile-by-tile construction remains possible; multi-cell footprints are a capability, not a requirement for every building.
- An empty cell is neutral and need not have a persistent object.
- Vacuum and other environmental conditions are represented as separate contents/data, not as the definition of an empty cell.
- Engine provides generic representation and indexing. Cassandra defines the meaning of its floors, rock, vacuum, furniture, pawns, projectiles, debris, and legal overlaps.
- Rendering and viewport state are consumers of spatial data, never its authority.

Examples such as environment/vacuum, floor, carpet, table, candleholder, projectile, and debris illustrate independent contents that may coexist. They do not define a fixed schema or ordering.

## 2. Responsibilities and existing contracts

### 2.1 Entity Registry remains the identity authority

Entity Registry owns:
- Stable entity IDs.
- Entity kind and generic lifecycle metadata.
- Persistent/scoped identity and stored/active/removed lifecycle status.
- Entity identity snapshots and migrations.

Entity Registry does not own:
- Domain/gameplay state.
- Grid coordinates or footprints.
- Cell contents or occupancy indexes.
- Rendering, collision, passability, or placement legality.

A multi-cell entity is still exactly one Entity Registry record. Its identity is not duplicated per occupied cell.

### 2.2 World Context remains the placement/transfer authority for its current contract

The current World Context:
- Stores one current placement record per entity.
- Supports world placement or storage placement.
- Validates finite world-space x/y coordinates and world bounds.
- Provides atomic single-record relocation/transfer operations.
- Does not index cells, represent footprints, or query coordinate occupancy.

The new spatial service should be a separate capability rather than silently changing the meaning of the existing World Context API. Integration may later coordinate World Context and spatial occupancy, but must preserve the existing tested placement contract until a deliberate migration is designed.

### 2.3 Proposed spatial composition service

A dedicated generic spatial service (working name: Spatial Composition / Spatial Index) owns:
- Cell-associated spatial content records.
- Entity-to-footprint occupancy relationships for grid worlds.
- Reverse cell-to-content/entity indexes.
- Bounds and footprint validation against the Grid Geometry contract.
- Deterministic spatial queries and atomic occupancy updates.
- Its own versioned persistence participant/snapshot.

It references entity IDs; it does not become a second entity registry and does not own entity domain state.

The exact public class, service ID and method names are implementation details to settle when the implementation slice is planned. The responsibility boundary is the important contract.

## 3. Geometry, cells and contents are separate

Grid Geometry defines:
- Whether a World has a grid.
- Grid dimensions and valid integer cell coordinates.
- Coordinate conversion and neighborhood geometry.

Spatial Composition defines what is present at those coordinates.

A cell is therefore best treated as an addressable coordinate and a query surface, not as one mutable tile object that owns every possible property. An untouched in-bounds coordinate may have no stored composition record at all.

### 3.1 Neutral empty cells and sparse storage

- Empty/default composition is implicit.
- Querying an untouched in-bounds cell returns an empty result without creating persistent state.
- The service stores only explicit non-default contents and occupancy entries.
- Removing the final content from a cell removes its sparse index entry.
- No persistent record is required merely to say that a cell exists; the grid descriptor already defines the address space.
- Vacuum is an explicit environmental content/state and therefore is not treated as empty/default.

The storage representation may use maps keyed by coordinate or another equivalent sparse structure. Chunking and streaming optimizations are deferred until measured scale requires them.

## 4. Two kinds of spatial content

The model distinguishes content that is itself an entity from content associated directly with a cell.

### 4.1 Entity-backed spatial content

An entity-backed entry refers to one registered entity ID. The entity may occupy one or many cells.

The spatial service stores the occupancy reference and footprint relationship, not a duplicate copy of the entity's identity or domain state.

Examples:
- A table or candleholder represented as an entity.
- A pawn, machine, vehicle or projectile represented as an entity.
- A large creature represented by one entity spanning several cells.

A cell query may encounter the same entity through multiple footprint cells. Entity-oriented query results must deduplicate by entity ID.

### 4.2 Cell-associated non-entity content

Some spatial data does not need an independent Entity Registry identity or entity lifecycle. It may be stored as a stable cell-associated content record.

Examples may include:
- A terrain/material patch.
- A floor or surface definition.
- A cell-local environmental value such as vacuum.
- A surface overlay.
- A static map feature that does not need independent entity behavior.

Each explicit record has its own stable content ID within the spatial service's namespace, a host-defined category ID, and an opaque serializable payload or host-owned data reference.

This does not force Cassandra to represent every floor, rock cell or environmental property this way. Cassandra may choose entities, cell-associated records, components, fields or regions according to its domain requirements. Engine provides the generic options and does not decide the game model.

### 4.3 Do not conflate category, layer and entity kind

These are distinct concepts:

- **Entity kind** describes the registered entity's host-defined identity/type.
- **Content category** is a generic classification key used to filter or group spatial contents.
- **Layer** is an optional host-defined grouping or ordering concept if a host needs one.
- **Cell coordinate** is the address at which content is associated or occupied.

The initial generic contract should require a stable category ID for explicit cell-associated contents and allow an optional layer ID where useful. It must not impose a fixed built-in category list or assume that category IDs imply physical priority, draw order, collision behavior or exclusivity.

Entity-backed entries may expose a category association through the spatial record/index without changing the Entity Registry kind. One entity may be discoverable through more than one host-defined query classification if the host's model requires it; the initial implementation should avoid baking a one-category-per-entity rule into identity.

## 5. Stable identifiers and record shape

The following is a conceptual record shape, not a final public API or mandated serialized property naming:

**Cell-associated content**
- Stable content ID.
- World ID.
- Integer cell coordinate.
- Stable category ID.
- Optional layer ID.
- Opaque JSON-like payload or host-owned data reference.
- Optional host-defined metadata.

**Entity occupancy**
- Entity ID.
- World ID.
- Anchor cell.
- Footprint definition/reference.
- Orientation.
- Derived occupied-cell set or index entries.

IDs must be stable, validated and non-reusable within the relevant registry/service lifecycle. IDs must not be derived from array position, query order, or current footprint cell count.

The spatial service should validate entity references against Entity Registry when inserting, restoring or querying authoritative occupancy. It must reject unknown or lifecycle-ineligible entity references according to the integration contract. A removed entity must not remain spatially occupied.

Opaque payloads must follow the same safe serialization expectations as other Core snapshots: plain JSON-like data, finite numbers, no functions, symbols, accessors, cycles or mutable external object references. The Engine must not interpret host payload fields.

## 6. Multi-cell footprints

### 6.1 Generic footprint representation

Represent a footprint as a set of integer cell offsets relative to an anchor cell. This supports shapes that are not necessarily rectangles.

For example, a 2×1 footprint may use offsets (0,0) and (1,0). An L-shaped machine or irregular creature can use a different set of offsets.

A one-cell entity is simply a footprint containing (0,0). It is not a special entity type.

The anchor convention should be stable: the anchor is the entity's logical origin in grid coordinates, and each offset identifies one occupied cell relative to that origin.

### 6.2 Rotation and orientation

The initial square-grid default should support the four quarter-turn orientations: 0°, 90°, 180° and 270°. Apply the orientation transform to each offset before adding it to the anchor.

- The unrotated footprint is the canonical stored definition.
- Orientation is stored separately from the canonical offsets.
- The resulting occupied cells are derived deterministically.
- Duplicate offsets in a footprint are invalid.
- The origin offset (0,0) is required so the anchor is part of the occupied footprint.
- A footprint is not required to be rectangular or contiguous.
- Arbitrary-angle rotation is not part of a discrete cell occupancy contract.

If a later host needs a non-quarter-turn or non-grid-aligned representation, that should be an explicit extension rather than an implicit rounding rule.

### 6.3 Bounds

Every transformed footprint cell must be within the world's grid bounds. A footprint whose anchor is in bounds but whose other cells cross the boundary is invalid.

The service must not silently clip, wrap, clamp or partially register a footprint.

### 6.4 One entity, many occupancy references

The occupancy index may contain one reference for each occupied cell, but all references point to the same entity ID.

- Entity Registry still contains one entity record.
- Entity lifecycle operations still address one entity ID.
- Entity-level queries return one entity once, even if several of its occupied cells match.
- Cell-level queries may return the entity reference in each cell it occupies.
- Removing or moving the entity removes/replaces all of its occupancy references as one operation.

## 7. Coexistence and overlap policy

Engine must not impose a universal one-object-per-cell rule.

Multiple entities and cell-associated contents may coexist at the same coordinate, including multiple contents in the same category/layer unless a host-supplied rule says otherwise.

The generic service provides:
- Occupancy lookup.
- Category/layer filtering.
- Footprint intersection and overlap reporting.
- Optional host validation hooks or prevalidated placement operations.

The host/game decides whether a proposed composition is legal. For example, Cassandra may decide that two large machines cannot overlap, that a pawn can share a cell with a floor, or that a projectile can temporarily overlap another object. These are gameplay/physical rules, not universal Engine restrictions.

The default generic operation should therefore permit composition unless an explicit host policy rejects it. The Engine must not infer collision or physical exclusivity from category names.

## 8. Deterministic queries and ordering

Spatial queries must have stable, documented ordering so identical authoritative state produces identical results.

Recommended defaults:
- Cell coordinates are ordered by y, then x.
- Cell-associated records within a cell are ordered by category ID, then content ID.
- Entity IDs in entity-oriented result sets are deduplicated and ordered lexicographically.
- Footprint cell lists are normalized and ordered by y, then x.
- Any optional explicit layer order must be supplied by host configuration; it must not be inferred from insertion order or visual presentation.

Queries should clearly distinguish:
- All spatial entries at a cell.
- Cell-associated records at a cell.
- Entity references occupying a cell.
- All cells occupied by one entity.
- All unique entities intersecting a requested cell set/area.
- Contents filtered by category and/or layer.

Out-of-bounds coordinates must be reported as invalid rather than treated as empty. A valid in-bounds empty cell returns an empty composition result. A world without grid capability cannot accept grid-cell occupancy; the host must use an appropriate non-grid placement path instead.

## 9. Atomic spatial changes

An entity footprint update is one logical operation, not a sequence of independently visible cell edits.

For place, move, rotate, resize-footprint or remove:
1. Validate world/grid capability and entity identity/lifecycle.
2. Normalize the footprint and orientation.
3. Derive the complete target cell set.
4. Validate every target cell against bounds.
5. Run host-supplied composition/overlap validation.
6. Prepare all index changes without mutating authoritative state.
7. Commit the complete replacement synchronously as one operation.
8. Publish any resulting notification only after the spatial state is consistent.

If validation fails, the previous occupancy must remain unchanged. No observer may see a half-written footprint.

The same principle applies to cell-associated content insertion/removal: validate the full operation before committing its sparse records and indexes.

Moving an entity between worlds must update the source and target occupancy consistently. If the operation spans other stateful services, the host-level integration must coordinate it as a transaction; the spatial service alone must not claim to atomically update unrelated domain state or the Entity Registry unless that coordination is explicitly implemented.

## 10. Removal, transfer and restore semantics

- Removing an entity from spatial occupancy does not automatically remove its Entity Registry identity.
- Removing an entity identity must be coordinated so no active occupancy reference remains.
- Storing an entity or transferring it out of a world removes its world occupancy as part of the coordinated operation.
- Moving an entity between grid worlds requires validating the target world's grid and bounds before the source occupancy is released.
- Cell-associated content removal deletes its content record and all related index entries.
- A host may choose to preserve, transform or discard cell-associated content when a world is retired; that policy belongs to the host and its persistence workflow.
- The generic spatial service does not decide expedition commit/abandon outcomes.

These rules preserve the distinction between identity lifecycle and spatial presence. An entity may exist in the registry while stored or otherwise not occupying a grid cell.

## 11. Persistence and restore

The spatial service should own a versioned persistence participant for its authoritative cell-associated records and entity occupancy definitions.

A snapshot should preserve:
- World association.
- Stable content IDs and category/layer identifiers.
- Cell coordinates and opaque payloads for cell-associated records.
- Entity IDs, anchors, canonical footprints and orientations for entity occupancy.
- Schema version and any required world/grid identity references.

Derived reverse indexes should normally be rebuilt from canonical records during restore rather than serialized as a second independent authority. This avoids contradictory forward and reverse occupancy state.

Restore validation must reject:
- Unsupported schema versions without a migration.
- Duplicate content IDs or duplicate entity occupancy records.
- Invalid IDs, categories, coordinates, footprint offsets or orientations.
- Out-of-bounds occupied cells.
- Occupancy references to missing, removed or otherwise ineligible entities.
- A world reference whose grid capability/dimensions do not match the saved spatial data.
- Inconsistent canonical records that would rebuild into contradictory occupancy.

Preparation must be side-effect-free. Commit swaps in the fully validated prepared state; rollback restores the previous state if a later persistence participant fails.

The spatial participant must restore after the identity and world/grid descriptors it depends on are available. The exact participant order and cross-participant validation hook should be confirmed during implementation against the existing Persistence coordinator. The current supported save format and participant migrations must remain internally consistent. Backward compatibility with arbitrary older .cass versions is not required; unsupported versions may be rejected safely. Do not silently change save envelopes or unrelated application state.

## 12. Ownership boundaries

**Engine owns**
- Generic spatial composition and occupancy records/indexes.
- Stable generic identifiers and schema validation for its own records.
- Generic footprint geometry, orientation transforms and bounds checks.
- Deterministic spatial query/index behavior.
- Atomic updates to its own spatial state.
- Versioned snapshots and restore validation for the spatial participant.

**Cassandra owns**
- Which contents are entities versus cell-associated data.
- Meaning of floors, walls, rock, cavities, vacuum, furniture, items, pawns, projectiles and debris.
- Which categories/layers exist and what they mean.
- Legal overlaps, placement restrictions, construction rules and environmental semantics.
- Whether a particular entity is one cell, multi-cell, irregular, movable or static.
- Gameplay consequences of destruction, movement, placement or removal.

**Dev Lab owns**
- Generic spatial content/footprint editing tools.
- Occupancy and overlap inspectors.
- Cell composition visualization and diagnostics.
- Test scenarios that exercise multiple contents and multi-cell occupancy without requiring Cassandra rules.

**Presentation/viewport**
- Visualizes cell composition and entity footprints.
- Does not own authoritative coordinates, occupancy, category semantics or placement validity.

## 13. Acceptance scenarios

1. A grid world with no spatial contents can be queried at any in-bounds coordinate and returns an empty result without persistent cell allocation.
2. Adding one cell-associated content creates an explicit record; removing it leaves no stored neutral cell.
3. A cell can contain several independent cell-associated contents with different categories.
4. Multiple entity IDs can occupy the same coordinate when host policy permits.
5. An entity-backed entry and cell-associated contents can coexist at one coordinate.
6. A multi-cell entity occupies every transformed footprint cell but appears once in an entity-oriented query.
7. A non-rectangular footprint is supported without changing the entity's identity.
8. Four quarter-turn orientations produce deterministic expected cell sets.
9. A footprint crossing any world boundary is rejected without partial occupancy.
10. A rejected overlap leaves the previous spatial state unchanged.
11. A successful move replaces all old occupancy entries with the new footprint atomically.
12. A failed move preserves the full original footprint.
13. Removing an entity's spatial presence does not silently remove its Entity Registry identity.
14. Removing or storing an entity cannot leave stale occupancy references.
15. Cell and area queries return deterministic results independent of insertion order.
16. Querying an out-of-bounds coordinate is distinct from querying a valid empty coordinate.
17. Snapshot/restore round-trips cell-associated records and entity footprints.
18. Restore rejects duplicate IDs, invalid references, invalid orientation and out-of-bounds footprints before commit.
19. A failed multi-participant restore rolls the spatial participant back to its previous complete state.
20. Existing Entity Registry and World Context behavior remains unchanged until an explicit integration/migration step is implemented.
21. Non-grid worlds remain valid and do not accidentally acquire grid occupancy.
22. Presentation changes do not mutate authoritative spatial composition.

## 14. Explicitly deferred

- Pawn movement rules, movement speed and input mapping.
- Collision response, passability, blocking, line of sight and combat consequences.
- Pathfinding and AI navigation.
- Cassandra-specific terrain, asteroid generation, environmental simulation and vacuum rules.
- Region/field-based environmental data optimization.
- Chunking, streaming, multithreaded indexing and advanced performance optimization.
- Grid resizing, arbitrary-angle rotation and non-square topologies.
- Generic expedition transfer/change-set semantics.
- Rendering order, sprite stacking and visual layer policy.

Movement/collision scope is the next design slice. It may consume the occupancy and footprint/query primitives defined here, but it must not retroactively make overlap semantics universal.

## 15. Current source facts

The source audit on `work` confirms:

- Entity Registry stores stable entity IDs, kind, scope, lifecycle status and metadata. Its versioned snapshot covers identity records, not domain state or spatial placement.
- Entity Registry lists records in deterministic ID order and preserves removed IDs as tombstones; IDs are not reused within the registry.
- World Context stores one placement per entity, either a world position or a storage location. It validates finite x/y and world bounds, but has no grid-cell occupancy, category/layer composition or footprint model.
- World Context's current single-placement map is indexed by entity ID. It does not enforce one entity per coordinate; multiple entity IDs may currently share the same coordinate.
- World Context's move operation validates a target before replacing the one placement record. It is not a multi-cell occupancy transaction.
- Persistence already supports ordered participants, schema versions, migrations, side-effect-free prepare, commit and rollback. The new spatial participant should use those existing generic mechanisms rather than invent a separate save system.
- The existing Core README describes Entity Registry and World Context as separate identity and placement responsibilities. This proposal preserves that separation.

This proposal defines the next reusable spatial contract only. It does not authorize source/runtime code changes or alter existing save behavior.
