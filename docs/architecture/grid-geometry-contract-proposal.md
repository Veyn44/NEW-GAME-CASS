# Grid Geometry Contract — Working Proposal

**Status:** Working contract; optional-grid decision approved, technical defaults proposed
**Scope:** Generic Engine grid geometry, bounds and coordinate semantics
**Branch:** `work`
**Source audit:** 2026-11-15

This document defines the first usable grid contract for Engine. It separates geometry from cell contents, occupancy, environmental data, rendering and game rules. It is intended to let implementation proceed; technical defaults may be refined when concrete integration exposes a need.

## 1. Approved architectural direction

- A grid is an **optional capability of a World**, not a requirement for every Engine World.
- A World may exist with no grid.
- A World with a grid uses a **square, axis-aligned topology**.
- Cassandra will use grids for both its Main World and Temporary Worlds.
- Engine must not impose a fixed two-world limit.
- Do not add hexagonal, triangular, isometric-topology or other grid variants without a concrete requirement.
- Grid geometry is not the same thing as a cell's contents, entity occupancy, terrain, environment, or visual representation.

### 1.1 Grid capability ownership

**Agreed direction (2026-11-15):** The optional grid capability is declared by the World Registry descriptor.

- World Registry owns whether a World has grid capability and the immutable grid dimensions recorded at World creation.
- The grid descriptor is explicit and separate from generic World dimensions; dimensions alone do not imply grid support.
- A World without a grid remains valid and must not acquire grid behavior implicitly.
- Grid Geometry validates dimensions and provides coordinate/bounds operations but does not own World lifecycle or capability registration.
- Spatial Composition consumes the descriptor and owns the actual cell-associated contents and entity occupancy.
- Initial scope does not include changing grid dimensions or adding/removing grid capability after World creation.

The implementation uses an explicit optional `grid` field on each World Registry descriptor. `null` means the World has no grid; an object `{ width, height }` declares the immutable grid dimensions. Generic `dimensions` remain unchanged and never imply grid capability. World Registry snapshot schema is version 3; the current implementation includes scoped migrations from World Registry snapshot versions 1 and 2, adding `grid: null` to those historical non-grid records.

## 2. Coordinate contract

### 2.1 Cell coordinates

A grid cell is addressed by a pair of discrete integer coordinates:

- `x`: increases to the right.
- `y`: increases downward.
- The top-left cell is `(0, 0)`.
- Coordinates identify cells, not pixels and not viewport positions.
- Valid cell coordinates are integers; fractional values are not rounded or silently coerced.

This matches the existing Cassandra/Dev Lab viewport convention, where entity markers are centered at `(x + 0.5, y + 0.5)`.

### 2.2 World-space positions

A world-space position may be continuous and is distinct from a cell coordinate. A point maps to a cell by flooring each axis:

`cellX = floor(worldX)`, `cellY = floor(worldY)`.

The center of cell `(x, y)` is `(x + 0.5, y + 0.5)`.

The existing `WorldContext` placement contract currently accepts finite positions and enforces world bounds. It remains a placement/identity service; it is not silently redefined as the grid-cell or occupancy service by this document. Grid-aware placement and footprint validation will be integrated with the later spatial-composition capability.

## 3. Bounds and dimensions

- A grid is finite and rectangular.
- `width` and `height` are positive safe integers measured in cells.
- Valid coordinates satisfy `0 <= x < width` and `0 <= y < height`.
- Bounds are half-open: the left/top edges are included; right/bottom edges are excluded.
- A grid world may be square or rectangular. Square topology does not require equal width and height.
- Cassandra may choose square dimensions such as 128×128 or 256×256; Engine does not hard-code those sizes.
- A coordinate outside the grid is out of bounds. Engine geometry queries and placement validation must report this explicitly; they must not wrap, clamp, or create cells outside the grid.

The existing World Registry already stores world dimensions as positive finite numbers. A grid descriptor adds the stricter integer-cell requirement without forcing non-grid worlds to use grid dimensions.

## 4. Grid lifecycle and resizing

- Grid geometry is part of the World descriptor/configuration and is available independently of whether cell data is currently materialized.
- Grid dimensions are fixed for a grid instance after creation in the first implementation.
- Resizing is not part of the initial grid contract. If later required, it must be an explicit operation with defined handling for contents that fall outside the new bounds.
- Changing viewport size, zoom, camera position or display scale never changes grid geometry.

## 5. Cells are implicit; contents are separate

A coordinate does not require an allocated cell object merely because it exists inside the grid.

- The default/empty cell is neutral and may be represented implicitly.
- Querying an untouched coordinate returns the neutral default view without forcing a persistent cell allocation.
- Only non-default cell data needs explicit storage in the spatial data layer.
- The grid geometry layer itself does not decide what data makes a cell non-default.
- Vacuum is not the default cell and is not a special grid type. It is an environmental/gameplay property represented by a separate data/content system.
- One coordinate may eventually contain multiple independent spatial contents. A cell is not limited to one entity, one terrain type or one environmental state.

The actual storage of cell contents, categories/layers, entity footprints, overlap rules and occupancy indexes belongs to the subsequent Spatial Composition contract, not this geometry layer.

## 6. Neighborhoods and distances

Provide explicit square-grid neighborhood queries:

- **Orthogonal / 4-way:** north, east, south, west.
- **Adjacent / 8-way:** the four orthogonal neighbors plus four diagonals.

The caller chooses which neighborhood it needs; neither is silently treated as the universal meaning of adjacency.

Distance helpers, when exposed, use named metrics:
- Manhattan distance for orthogonal movement/range.
- Chebyshev distance for 8-way adjacency/range.

No pathfinding, passability, collision or movement policy is implied. Those are separate capabilities and host/game rules.

Neighbor queries return only in-bounds coordinates by default. If callers need boundary directions as well, that should be an explicit boundary-aware query rather than fabricated wrapped neighbors.

## 7. Ownership boundaries

**Engine owns**
- Optional grid capability and its immutable geometry descriptor.
- Integer cell-coordinate validation.
- Bounds checks and coordinate conversion helpers.
- Orthogonal/diagonal neighbor enumeration and named distance primitives.
- Generic, deterministic geometry semantics.

**Cassandra owns**
- Which worlds receive a grid and their chosen dimensions.
- Asteroid shape, rock, cavities, buildable regions and world-generation rules.
- Meaning of vacuum, terrain, hazards and environmental conditions.
- Which contents may coexist and what placement is legal.
- Movement, passability, collision and gameplay consequences.

**Dev Lab owns**
- Grid creation/editing controls and geometry inspection UI.
- Visual overlays, coordinate readouts and test scenarios.

**Presentation/viewport**
- Converts world/cell positions to screen pixels and back.
- Must not become the authority for world bounds, occupancy or cell existence.

## 8. Compatibility and migration notes

- Do not reinterpret the existing World Registry `dimensions` field as proof that a world has a grid. Non-grid worlds remain valid.
- Add grid metadata/capability explicitly rather than inferring it from dimensions or world type.
- Do not change existing `WorldContext` fractional-position behavior as a side effect of introducing integer cell coordinates.
- Grid geometry is not occupancy. Multiple entities at one coordinate and multi-cell entity footprints will be handled by the next spatial contract.
- Existing viewport constants (including 64, 128 and 256 world-size options) are presentation/application defaults, not Engine-wide limits.

## 9. Acceptance scenarios

1. Register and load a World without a grid; all non-grid behavior remains valid.
2. Register and load a World with a finite square grid.
3. Register a rectangular grid world; square topology still works.
4. Accept integer coordinates on all four included edges.
5. Reject negative coordinates and coordinates at `x = width` or `y = height`.
6. Reject fractional cell coordinates without rounding.
7. Convert continuous world positions to cells using floor semantics, including negative positions (which remain out of bounds).
8. Return a neutral default for an untouched in-bounds cell without materializing a stored cell.
9. Enumerate 4-way and 8-way neighbors with correct boundary clipping.
10. Return consistent Manhattan and Chebyshev distances.
11. Confirm viewport zoom, camera and canvas dimensions do not mutate geometry.
12. Confirm a world without a grid does not accidentally acquire one because it has width/height metadata.

## 10. Explicitly deferred

- Cell content schema and spatial occupancy/composition.
- Multi-cell footprints, rotation and overlap validation.
- Terrain, asteroid geometry, rock/cavity generation and environmental data.
- Movement, collision, pathfinding and passability.
- Grid resizing and world wrapping.
- Chunking, streaming and advanced sparse-storage optimizations.
- Cassandra's exact Main World dimensions and edge/gameplay rules.

## 11. Current source facts

The `work` source audit shows:

- `WorldRegistry` now records an explicit optional `grid` descriptor (`null` for non-grid worlds); generic positive-finite world `dimensions` do not imply grid capability.
- Grid dimensions are validated by the pure `Grid Geometry` module and stored as immutable positive safe integers.
- World Registry snapshot schema is version 3, with explicit version-1 and version-2 migration paths that preserve historical worlds as non-grid.
- `WorldContext` stores one placement per entity as finite `x/y` values and validates those positions against world dimensions. It has no cell model or occupancy index.
- The current Dev Lab viewport already uses a square tile grid, sizes 64/128/256, integer tile addressing and marker centers at `x + 0.5, y + 0.5`.
- The viewport is presentation code; it must not become the Engine's spatial authority.

This proposal does not authorize changing existing source behavior by itself. Implementation should add the optional grid geometry capability in a focused step and preserve the existing placement contract until the spatial model is ready.
