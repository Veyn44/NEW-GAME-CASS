# Spatial Query Contract — Working Proposal

> **Post-merge status (2026-11-16):** Slice 3 and its read-only query baseline are included in `main` through PR #7. Exact merge-commit Core/Host CI passed in [run 43940567950](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43940567950). Host-specific/manual acceptance remains tracked in the current status index.

**Status:** Slice 3 implemented and merged; selected host/browser acceptance remains separate.  
**Scope:** Generic read/query interface over grid cells, spatial contents, entity occupancy and footprints  
**Integrated branch:** `main`  
**Source audit:** 2026-11-15

This document defines how Engine consumers inspect spatial composition without changing it. It builds on Grid Geometry, Spatial Composition and Movement & Collision. It does not authorize source/runtime changes.

The goal is a small, predictable query surface that can serve Cassandra and Dev Lab without embedding game-specific meanings such as passability, blocking, vacuum, visibility or target eligibility into Engine.

## 1. Direction and invariants

The spatial query capability should follow these rules:

- Queries are read-only. They never create cells, content records, occupancy entries, entities or other persistent state.
- Querying an untouched in-bounds cell returns an empty/neutral result.
- Cell composition and entity occupancy remain authoritative in the Spatial Composition service; queries are views over that data, not a second store.
- A cell may contain multiple independent contents, including multiple contents in the same category or layer.
- One multi-cell entity remains one entity. Entity-oriented results deduplicate by entity ID.
- Cell-oriented queries may report the same entity in each cell it occupies, with the matched cell made explicit.
- Category, layer and entity kind remain separate identifiers. None implies physical behavior or visual order.
- Queries return geometric/compositional facts. They do not decide collision, passability, movement legality, visibility, interaction eligibility or environmental consequences.
- Query results are deterministic for the same committed spatial state and request.
- A query does not load, activate, simulate, pause or otherwise change a World lifecycle state.

## 2. Ownership and service boundary

### 2.1 Spatial Composition owns the query surface

The dedicated Spatial Composition / Spatial Index service is the natural owner because it owns cell-associated records, entity footprints and reverse occupancy indexes.

It should expose query operations over its committed state. Query methods must not be added to Entity Registry as a substitute for spatial ownership, nor should World Context be silently expanded into a cell-occupancy database.

Existing responsibilities remain unchanged:

- Entity Registry owns stable entity identity and lifecycle metadata.
- World Context owns its existing single-placement and storage/transfer contract.
- Grid Geometry defines optional grid capability, coordinates, bounds, neighbors and distance primitives.
- Spatial Composition owns cell contents, footprints and occupancy.
- Movement operations may use these queries, but movement is a separate transaction that can mutate occupancy.
- Cassandra supplies gameplay meaning and policy.
- Dev Lab supplies inspection and test tooling.
- Presentation consumes query results and is never authoritative.

### 2.2 Read-only means no hidden work with gameplay effects

A query may use internal indexes or caches, but it must not:
- Materialize an otherwise implicit cell as persistent content.
- Register, move, remove or change the lifecycle of an entity.
- Generate terrain, vacuum, environment state or world contents.
- Trigger simulation, events, callbacks with mutation authority or gameplay side effects.
- Load or activate a world implicitly.

Internal memoization is an implementation detail only if it is observationally invisible, bounded, and cannot change authoritative state or query results.

## 3. Query families

The initial API should provide a small set of explicit query families. The names below are conceptual; final exported method names and result types belong to implementation planning.

### 3.1 Cell composition query

Read all explicit spatial contents associated with one cell coordinate.

Conceptual input:
- World ID.
- Cell coordinate `{ x, y }`.
- Optional category and layer filters.

Conceptual result:
- World ID and queried coordinate.
- Zero or more matching cell-associated content records.
- Zero or more entity occupancy references intersecting that cell.
- For entity references, stable entity ID and the entity's spatial association/footprint metadata needed by the caller.

The result should make the distinction between cell-associated records and entity-backed occupancy explicit. It must not flatten them into indistinguishable generic objects.

An in-bounds untouched cell returns a valid empty result. It does not allocate a cell record.

### 3.2 Contents by category, layer or entity kind

Filtering should be explicit and composable:

- **Category ID** filters spatial content classification.
- **Layer ID** filters an optional host-defined grouping.
- **Entity kind** filters entity-backed results using Entity Registry identity metadata.

These identifiers are not interchangeable. A layer does not imply category priority; entity kind does not automatically become a spatial category.

The caller may request one or more category/layer IDs where the implementation supports it. Empty filters mean no restriction; invalid identifiers are request errors, not empty matches.

The initial contract should not prescribe a built-in category list or fixed layer order.

### 3.3 Entity occupancy query

Return the entities whose footprints occupy a given cell or intersect a specified region.

Entity-oriented results must contain each entity ID at most once, even when a multi-cell footprint intersects multiple queried cells.

Where useful, the result may include:
- Entity ID and kind.
- Anchor cell and orientation.
- Full occupied-cell set or the subset of matched cells.
- Category/layer associations relevant to the matched occupancy entries.

The caller must be able to distinguish “entity intersects this region” from “entity anchor lies inside this region.”

### 3.4 Footprint lookup

Given an entity ID, return its authoritative spatial placement:
- World ID.
- Anchor cell.
- Footprint definition/reference.
- Orientation.
- Derived occupied cells.

An entity with no grid occupancy returns a distinct not-spatially-placed result. It must not be confused with an entity whose footprint happens to contain zero cells; valid footprints are non-empty under the Spatial Composition contract.

A footprint lookup is entity-oriented and returns one record, not one result per occupied cell.

### 3.5 Region query

Support explicit, bounded geometry inputs:

- One cell coordinate.
- An axis-aligned rectangle using inclusive minimum and exclusive maximum cell bounds.
- An explicit finite set of cell coordinates.

A rectangle should use the same half-open convention as Grid Geometry: `minX <= x < maxX`, `minY <= y < maxY`.

An explicit cell set should be validated, deduplicated and normalized before execution. Duplicate coordinates must not duplicate cell-associated records in the result.

The initial API should not expose arbitrary unbounded predicates over every cell in a World. Such scans are difficult to bound and encourage accidental full-world work. Callers should first select a bounded geometry, then apply supported category/layer filters.

### 3.6 Neighbor and radius queries

Neighborhood queries should reuse the Grid Geometry definitions rather than inventing a second adjacency convention.

- 4-way / orthogonal neighbors.
- 8-way / adjacent neighbors.
- Manhattan distance for orthogonal radius.
- Chebyshev distance for 8-way radius.

The caller must name the neighborhood/metric. “Adjacent” or “radius” without a metric is ambiguous and should not be accepted as an implicit default.

A radius query is bounded by its center, non-negative integer radius and explicit metric. The result contains only in-bounds cells. No wrapping is performed.

A caller that needs a rectangular scan can use the explicit rectangle query instead.

## 4. Geometry, bounds and empty results

Query outcomes must distinguish invalid requests from valid empty results.

Recommended behavior:

- Invalid coordinate type, non-integer cell coordinate, malformed rectangle, invalid filter or negative radius: reject as an invalid query.
- Valid cell/region outside the grid: return an explicit out-of-bounds result by default; do not silently clamp or wrap.
- Valid in-bounds cell/region with no matching content: return a successful empty result.
- A query against a World without grid capability: return a distinct grid-unavailable/not-grid-world result.
- Unknown World ID: return a distinct unknown-world result.

### 4.1 Rectangle boundary policy

The default rectangle query should reject a rectangle that extends beyond the grid. This avoids silently hiding caller coordinate errors.

If a real use case needs clipping, provide an explicit clipped-query option or a separate method whose result reports both the requested and effective clipped bounds. Clipping must never happen implicitly.

### 4.2 Partial overlap

The initial contract should not return a partial success for a region that is partly outside the grid unless the caller explicitly requests clipping. This keeps query results predictable and makes boundary mistakes visible.

## 5. Inactive, unloaded and unavailable worlds

World lifecycle state and spatial data availability are separate concerns.

- A query must not activate or simulate an inactive World.
- A query must not cause an unloaded World to load.
- A query must not change the selected/focused/rendered World.
- If a World has no currently available spatial snapshot, return a distinct unavailable/not-loaded result.
- If a spatial snapshot is available for an inactive World, read-only queries may inspect it without changing lifecycle state.
- If a World is closed or its spatial data has been disposed, return a stable unavailable/closed result rather than treating it as an empty map.

The precise mapping between World Registry lifecycle states and spatial snapshot availability is an integration detail. The query contract must not infer “loaded” from Entity Registry status or from the existence of a World descriptor.

## 6. Deterministic result ordering

The same committed state and equivalent request must produce the same ordered results.

Recommended ordering:

1. Cells: row-major, `y` ascending then `x` ascending.
2. Cell-associated content within a cell: stable content ID ascending.
3. Entity references within a cell: stable entity ID ascending.
4. Entity-oriented results: stable entity ID ascending, after deduplication.
5. Explicit cell-set input: normalize to row-major order rather than preserving arbitrary caller order.

If a future host needs presentation ordering, it should sort a copy of the query result using host-owned rules. Engine must not promise category or layer draw order as a side effect of query ordering.

Locale-sensitive ordering should be avoided for stable IDs; use a deterministic code-point/ordinal comparison defined by implementation.

## 7. Category and environmental-property queries

Engine should support querying by generic category/layer identifiers without knowing what those identifiers mean.

For example, Cassandra may represent vacuum as an environmental content category and ask for those records in a bounded region. Engine treats the category as an opaque stable ID; it does not know that vacuum affects oxygen, pawn survival, sound or simulation.

The initial query contract should not require Engine to understand arbitrary fields inside opaque host payloads. In particular:

- Do not add hard-coded filters such as `isVacuum`, `isWalkable`, `isBlocking` or `isVisible`.
- Do not scan every cell in a World to evaluate arbitrary host predicates.
- If hosts need efficient property queries, they can use category indexes or a later explicit, host-defined indexed-attribute capability.
- A host may filter a bounded query result in application code when the candidate set is appropriately limited.

Whether generic indexed attributes are needed is deferred until a concrete Cassandra/Dev Lab use case demonstrates the requirement.

## 8. Empty or eligible position searches

Finding an “empty” or “eligible” position is not a single universal Engine concept.

Engine can provide the raw facts needed:
- Which cells have no explicit contents.
- Which cells have no entity occupancy.
- Which cells are within bounds.
- Which footprints intersect a candidate region.

But “empty” may mean different things to different hosts. A cell containing a floor or vacuum may still be available for a structure; a cell with a harmless effect may be available to a Pawn; an entity may be allowed to overlap selected categories.

Therefore:

- Generic queries may expose occupancy/composition facts.
- Engine must not label a cell universally “free”, “walkable”, “buildable”, “safe” or “eligible”.
- Cassandra defines candidate eligibility and placement rules.
- If a later generic candidate-search primitive is justified, it must accept an explicit bounded candidate set/region and a host-supplied policy. It must not become an unbounded world scan or mutate the world while searching.

## 9. Relationship to movement and collision

Movement and Collision may consume Spatial Queries to:
- Read current footprint and occupancy.
- Find entities intersecting the proposed target footprint.
- Inspect cell-associated contents in candidate cells.
- Supply raw facts to the host movement policy.

Queries themselves do not:
- Reserve target cells.
- Lock occupancy for future use.
- Decide whether an overlap is legal.
- Commit movement.
- Trigger collision response or gameplay effects.

A query followed by a later mutation is not automatically an atomic transaction. The movement operation must perform its own validation against the authoritative state at its commit boundary. Callers must not rely on a previously returned query result remaining current after intervening mutations.

## 10. Consistency and mutation boundaries

A synchronous query should observe one internally consistent committed spatial state.

- It must not expose half-applied footprint moves or partially updated reverse indexes.
- A mutation should have one defined commit point; queries before that point see the previous state, queries after it see the new state.
- Query results should be immutable snapshots or defensive copies so callers cannot mutate authoritative indexes through returned references.
- A long-running/asynchronous query would require an explicit snapshot/version contract and is outside the initial API.

The exact mechanism for stable operation boundaries is an implementation detail, but partial mutation visibility is not acceptable.

## 11. Performance and indexing

The contract defines observable behavior, not a mandatory data structure.

Recommended initial approach:
- Sparse storage for explicit cell contents and occupancy.
- Index by World ID and cell coordinate.
- Category/layer indexes only where they materially improve common queries.
- Entity-to-footprint reverse lookup for direct footprint queries.
- Deduplicate entity results by stable ID.
- Avoid scanning all registered entities for a local cell query.

Do not introduce chunking, quadtrees, spatial hashes, query planners or a generalized indexing framework before measurements show a need. Indexes must remain derived/rebuildable from authoritative spatial records unless a persistence design explicitly establishes otherwise.

Performance expectations should be expressed against the queried region and returned results where possible, not as a promise that arbitrary full-world queries are cheap.

## 12. Persistence and restore

Spatial queries are not persistence operations and do not create snapshots.

- The authoritative persisted data remains the Spatial Composition records and required stable identity/footprint data.
- Derived query indexes may be rebuilt during restore.
- Restored data must pass the same bounds, identity and footprint validation used by normal writes.
- A query must not repair, migrate or normalize persisted state as a side effect.
- Querying immediately after restore is allowed only once the spatial service has completed its restore/availability boundary.

Persistence participant ordering and restore readiness belong to the broader Engine persistence integration plan.

## 13. Errors and result categories

Exact error class names are implementation details. The API should nevertheless distinguish at least:

- Invalid query input/filter.
- Unknown World ID.
- World has no grid capability.
- Spatial snapshot/data unavailable or World closed.
- Out-of-bounds coordinate or region.
- Unknown entity for footprint lookup.
- Entity exists but has no spatial occupancy.

A successful query with no matches is not an error.

Error details should identify the relevant World ID, coordinate/region or entity ID where safe and useful. Error codes should be stable and machine-readable; message text is for diagnostics.

## 14. API shape — illustrative only

The following sketches communicate intent, not approved method names or exact JavaScript signatures:

```js
spatial.queryCell(worldId, { x, y }, {
  categories: ["environment", "structure"],
  layers: ["physical"]
});

spatial.queryRegion(worldId, {
  type: "rectangle",
  min: { x: 10, y: 12 },
  maxExclusive: { x: 20, y: 22 }
});

spatial.queryEntitiesInRegion(worldId, region, {
  kinds: ["pawn", "machine"]
});

spatial.getEntityFootprint(entityId);

spatial.queryNeighbors(worldId, { x: 5, y: 5 }, {
  topology: "eight-way"
});

spatial.queryRadius(worldId, { x: 5, y: 5 }, {
  radius: 3,
  metric: "manhattan"
});
```

These examples intentionally omit result class names, callback APIs, async behavior, pagination and concrete storage details. Those belong in implementation planning after the contract set is reviewed.

## 15. Ownership summary

| Concern | Owner |
|---|---|
| Grid coordinates, bounds, neighbors and distance metrics | Engine — Grid Geometry |
| Cell contents, footprints and occupancy | Engine — Spatial Composition |
| Read-only spatial query mechanisms and deterministic results | Engine — Spatial Composition query surface |
| Entity identity and kind | Engine — Entity Registry |
| Existing world/storage placement contract | Engine — World Context |
| Movement transaction and raw overlap facts | Engine — Movement & Collision |
| Vacuum meaning, terrain, buildability, passability and eligibility | Cassandra |
| Test scenarios and spatial inspectors | Dev Lab |
| Rendering, overlays and visual sorting | Presentation |

## 16. Acceptance scenarios

1. Querying an untouched in-bounds cell returns an empty result and creates no persistent cell/content record.
2. Querying a cell containing several categories returns all matching contents without assuming one object per cell.
3. Filtering by category does not accidentally filter by entity kind or layer.
4. Filtering by layer does not imply layer priority or physical exclusivity.
5. A multi-cell entity appears once in an entity-oriented region query even if several footprint cells intersect the region.
6. A cell-oriented query reports the entity occupancy at that cell and identifies the matched coordinate.
7. A footprint lookup returns the complete authoritative footprint, anchor and orientation for one entity.
8. A region query distinguishes entities whose anchors are inside the region from entities whose footprints merely intersect it.
9. A rectangle uses half-open maximum bounds consistently with Grid Geometry.
10. Duplicate coordinates in an explicit cell set do not duplicate results.
11. A malformed coordinate, rectangle, filter or radius is rejected as invalid input.
12. An out-of-bounds query is distinct from a valid empty result.
13. A rectangle partly outside the grid is rejected unless explicit clipping is requested.
14. Neighbor queries honor the caller's explicit 4-way or 8-way choice and never wrap at world edges.
15. Radius queries honor the named Manhattan or Chebyshev metric.
16. Querying a non-grid World returns a distinct grid-unavailable result.
17. Querying an inactive World with an available spatial snapshot does not activate or simulate it.
18. Querying an unavailable/unloaded World does not implicitly load it.
19. A query does not create vacuum, terrain, cell records, entities or other state.
20. Engine does not interpret a category named vacuum as a gameplay rule.
21. Engine does not return universal walkable/buildable/free/eligible decisions.
22. A query result is deterministic and ordered for the same committed state and request.
23. Returned data cannot be used to mutate authoritative spatial records by reference.
24. A query during a footprint move cannot observe a partially updated occupancy index.
25. A query result obtained before a later mutation is not treated as a reservation or guarantee for a subsequent move.
26. Querying a closed/unavailable World is not silently represented as an empty grid.
27. Derived indexes can be rebuilt from authoritative spatial data after restore without changing query semantics.
28. Local cell queries do not require scanning every Entity Registry record.

## 17. Deferred topics

The following are intentionally not part of the initial query contract:

- Arbitrary unbounded predicate scans over whole Worlds.
- Generic property/attribute indexing over opaque payload fields.
- Query subscriptions, change notifications and reactive observers.
- Asynchronous queries, pagination and streaming/chunked result delivery.
- Cross-world spatial queries.
- Pathfinding, visibility/line-of-sight, influence maps and AI perception.
- Universal free-space, passability, collision, buildability or interaction semantics.
- Query-result reservations and concurrency control beyond the movement transaction's own commit boundary.
- Rendering order and presentation-specific sorting.

These may be added when a concrete host requirement justifies them, without changing the read-only and ownership principles above.

## 18. Review status

**Implemented baseline:** Read-only, bounded, deterministic queries over Spatial Composition, with explicit geometry and filters. Unknown worlds, non-grid worlds, closed worlds, malformed geometry and out-of-bounds regions are rejected distinctly. The current runtime has no separate unloaded-snapshot state to query.

**Agreed project constraints retained:** Optional grid; sparse/implicit empty cells; multiple contents per cell; entity identity independent of footprint size; category/layer/entity kind are distinct; Engine exposes generic facts while Cassandra owns gameplay meaning.

**Technical defaults proposed:** Query families, half-open rectangles, reject-by-default bounds behavior, explicit clipping, deterministic row-major ordering, immutable consistent results, no implicit loading, and sparse/indexed implementation.

**Implemented on `work` (Slice 3):** `queryCell`, `queryRegion`, `queryEntitiesInRegion`, `getEntityFootprint`, `queryNeighbors` and `queryRadius`. Cell and region results separate content records from entity occupancy, entity-oriented results deduplicate by ID and include matched cells, category/layer/kind filters remain distinct, rectangle bounds are half-open and reject clipping implicitly, explicit cell sets are deduplicated and row-major normalized, and returned snapshots are immutable. Region queries report only occupied cells; untouched cells remain implicit. Entity-kind filters use Entity Registry metadata supplied by Core Assembly.\n\n**Deferred:** Lifecycle availability for genuinely unloaded/disposed spatial snapshots (the current in-memory Spatial Composition has no independent unloaded snapshot state), category/layer secondary indexes pending profiling, async/paginated queries, arbitrary predicates, and query subscriptions. Cassandra and Dev Lab adoption remains separate.
