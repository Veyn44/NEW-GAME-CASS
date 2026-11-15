# Engine Spatial Capabilities

This directory contains reusable, application-neutral spatial primitives.

## Current contents

- `grid-geometry.js` — pure validation and coordinate helpers for finite, square-topology grids with rectangular dimensions.\n- `spatial-movement.js` — synchronous host-policy movement transaction over complete entity footprints.

Grid geometry does not register a grid on a World, store cell contents, own entity placement, decide overlap legality, or implement gameplay rules.

## Ownership

- World Registry declares whether a World has the optional grid capability and owns its immutable dimensions.
- Grid Geometry validates and interprets that descriptor.
- Spatial Composition owns grid-backed contents, footprints, occupancy and read-only spatial queries.
- Cassandra owns terrain, environment, passability, collision policy and movement behavior.
- Presentation consumes spatial state and never becomes its authority.

## Constraints

- Cell coordinates are safe integers with origin at the top-left; x increases right and y increases down.
- Bounds are half-open: `0 <= x < width`, `0 <= y < height`.
- Continuous world positions map to cells using floor semantics.
- A grid anchor maps to the center of its anchor cell at `(x + 0.5, y + 0.5)`.
- Neighbor queries do not wrap and return deterministic order.
- Non-grid Worlds remain valid and do not acquire grid behavior from generic dimensions alone.

See `docs/architecture/grid-geometry-contract-proposal.md` and `docs/architecture/phase-3-implementation-plan.md` for the full contract and implementation sequence.


## Spatial Composition

`spatial-composition.js` implements sparse cell-associated content for grid-enabled worlds and pure footprint geometry helpers. Content uses host-defined category/layer IDs and detached JSON-like payloads. Empty cells remain implicit; content IDs stay reserved after removal and are retained in snapshots.

Entity-backed occupancy is changed only through Placement Coordinator. World Context stores the anchor-cell center `(x + 0.5, y + 0.5)`; Spatial Composition stores one canonical anchor/footprint/orientation record and derives the cell index. Multiple entities may overlap at Engine level; legality is host policy. Grid-to-grid, grid-to-world, grid-to-storage, storage-to-grid and retirement use a synchronous prepared commit. Core Persistence restores World Context and Spatial Composition through one composite participant. Read-only query methods include `queryCell`, `queryRegion`, `queryEntitiesInRegion`, `getEntityFootprint`, `queryNeighbors` and `queryRadius`. Rectangle regions use half-open bounds; explicit cell sets are deduplicated and row-major normalized. Region results contain only occupied cells, avoiding materialization of untouched cells. Entity-kind filters read Entity Registry metadata; categories and layers filter only cell-associated content.\n\n`SpatialMovement` accepts a synchronous host policy per move. It supplies immutable current/target footprint facts, cell contents and deduplicated geometric overlaps. A policy may accept or reject; only an accepted decision reaches Placement Coordinator. Rejected, invalid and out-of-bounds moves preserve the current placement. Same-position moves return `unchanged`. Spatial Composition writes and Placement Coordinator commits/restore rollbacks are blocked during policy evaluation. Engine does not interpret overlaps as blockers or apply gameplay consequences. The Core service is available as `core.spatial-movement`; hosts pass their policy to each `moveEntity` call.
