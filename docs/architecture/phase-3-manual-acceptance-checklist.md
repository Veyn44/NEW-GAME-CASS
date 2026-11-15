# Phase 3 — Manual acceptance checklist

**Status:** Prepared, not executed. This checklist is intentionally reserved for the final phase review; it is not a request for user testing while implementation is still in progress.

Automated CI currently covers the deterministic Core/host contracts. The following checks require a real browser, the actual application UI, or the target persistence platform.

## Dev Lab UI

- [ ] Pause the simulation and spawn both 1×1 and 2×2 test entities.
- [ ] Inspect a cell, 4-way/8-way neighbors, Manhattan/Chebyshev radius and an entity footprint.
- [ ] Query a rectangular region using category, layer and Entity-kind filters.
- [ ] Attempt a move into an occupied footprint; verify the exact overlapping cells are highlighted and the diagnostic shows source, target, result and overlapping Entity IDs.
- [ ] Open movement history and verify ordered attempts and outcomes.
- [ ] Remove a test entity; reset the workspace; verify occupancy and movement history are cleared.
- [ ] Save/reopen a current-format Dev Lab .cass workspace and verify markers/footprints rebuild without stale selection.
- [ ] Import an unsupported historical .cass file and verify it is rejected without replacing the currently selected save or in-memory workspace.

## Cassandra Main / Temporary World

- [ ] Switch Main World between 64×64, 128×128 and 256×256; verify grid bounds and camera framing.
- [ ] Move a Unit cardinally and diagonally; verify continuous movement progress changes while Engine occupancy changes only at cell boundaries.
- [ ] Move a Unit against a world edge; verify clamping and occupancy consistency.
- [ ] Start a Temporary World; verify Main World local time pauses and Temporary World time advances.
- [ ] Return to Main World and re-enter the retained Temporary World; verify clocks and active-world selection.
- [ ] Verify a second Temporary World cannot be created while the first is retained.
- [ ] Save/reload with projected Units present; verify scoped Engine identities, Unit placements and campaign↔Temporary identity mappings restore together.

## Campaign persistence and Change Package

- [ ] In a browser that reports strict IndexedDB transaction durability, create and reopen a campaign snapshot.
- [ ] Open the same campaign from two tabs; let both read the same storage revision; commit from the first; verify the second writer receives a compare-and-swap conflict rather than overwriting the first result.
- [ ] Reload the second tab and retry a disjoint package; verify both campaign changes are preserved.
- [ ] Stage a Change Package; verify the pending package, expedition-start checkpoint and identity map are durable before promotion.
- [ ] Apply the package; verify Major State, touched aggregate revisions and Applied ledger change in one snapshot promotion.
- [ ] Retry the same package; verify it returns alreadyApplied and does not duplicate results.
- [ ] Force a stale aggregate baseline; verify conflict leaves Major State unchanged.
- [ ] Corrupt the checkpoint or resolved identity map; verify application fails closed.
- [ ] Apply a no-op outcome package; verify only the Major State revision and Applied ledger advance.
- [ ] Simulate a browser/tab interruption around promotion and verify reopening yields either the prior pending snapshot or the complete applied snapshot, never a partial mixture.
- [ ] After the exact package is durably applied, complete Temporary World disposal; verify scoped Units/Entities and spatial contents are retired, the World Registry entry is removed, the projection mapping is cleared, and persistent Main World entities remain unchanged.
- [ ] Attempt disposal with a package ID/digest that is not in the Applied ledger; verify disposal is rejected and the Temporary World, its placements, contents and projection mapping remain intact.

## Regression and performance

- [ ] Re-run the previously validated environment simulation in its authoritative host and compare behavior with its existing baseline. No environment simulation source was changed in this Phase 3 work branch; the integration target must be identified before this can be checked here.
- [ ] Measure representative 128×128 and 256×256 world setup, region query, movement and viewport costs. Record measurements before considering optimization.
- [ ] Verify browser teardown/restart leaves no stale listeners, world references, overlays or pending input state.

## Release gate

- [ ] All automated Core and host tests pass on the final work head.
- [ ] Every remaining manual item is either passed or explicitly accepted as a known limitation.
- [ ] The integration audit and Phase 3 plan match the final code.
- [ ] The user reviews the completed Phase 3 result.
- [ ] Merge to main occurs only after explicit user approval.
