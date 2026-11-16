# Phase 3 — Manual acceptance checklist

> **Current status (2026-11-16):** The user confirms that the deployed GitHub Pages Cassandra application behaves as expected for the currently exposed game workflow and that its `.cass` save/load path works. This is a positive manual acceptance of the Pages-hosted application path, not a claim that every diagnostic, edge-case or performance item below was individually exercised.
>
> **Application boundaries:** The Pages-hosted Cassandra application (including its embedded Dev Lab view) uses the Cassandra `.cass` workspace. The separate standalone Dev Lab uses `.dlcass`; that separate entry point is not part of the user's reported Pages test. Campaign has no player-facing create/open workflow or authoritative domain model yet. Its IndexedDB and Change Package infrastructure is intentionally dormant until the Campaign model is designed.
>
> Automated CI covers deterministic Core/host contracts. Checks requiring a separate application entry point, a not-yet-defined Campaign workflow, an authoritative external environment host, or performance baselines are recorded as deferred validation rather than silently treated as passed.

## Pages-hosted Cassandra — current manual acceptance

- [x] User confirms the currently exposed GitHub Pages game workflow behaves as expected.
- [x] User confirms the Pages `.cass` save/load workflow works.
- [ ] Detailed spatial diagnostic acceptance (1×1/2×2 entities, cell/neighbor/radius/footprint inspection, region filters and movement history) is not separately recorded.
- [ ] Main/Temporary World edge-case acceptance (world-size switching, boundary movement, retained Temporary World lifecycle and scoped projection round-trip) is not separately recorded.
- [ ] Browser teardown/restart verification for stale listeners, world references, overlays and pending input state is not separately recorded.

## Separate standalone Dev Lab — deferred

The standalone Dev Lab is a separate application entry point and uses `.dlcass`, while the Dev Lab view embedded in Cassandra Pages uses the Cassandra `.cass` workspace.

- [ ] Pause the standalone simulation and spawn both 1×1 and 2×2 test entities.
- [ ] Inspect a cell, 4-way/8-way neighbors, Manhattan/Chebyshev radius and an entity footprint.
- [ ] Query a rectangular region using category, layer and Entity-kind filters.
- [ ] Attempt a move into an occupied footprint; verify exact overlapping cells and diagnostic output.
- [ ] Open movement history and verify ordered attempts and outcomes.
- [ ] Remove a test entity; reset the workspace; verify occupancy and movement history are cleared.
- [ ] Save/reopen a current-format standalone Dev Lab `.dlcass` workspace and verify markers/footprints rebuild without stale selection.
- [ ] Import an unsupported historical `.dlcass` file and verify rejection does not replace the selected save or in-memory workspace.
- [ ] Verify standalone Dev Lab rejects Cassandra `.cass` files and Cassandra rejects Dev Lab `.dlcass` files.

These are acceptance checks for the standalone Dev Lab entry point, not blockers for the user's currently tested Pages-hosted Cassandra workflow.

## Campaign persistence and Change Package — deferred until Campaign is defined

Campaign does not yet have player-facing creation/selection UI, authoritative aggregate models, production domain operation handlers or a complete expedition workflow. The current code provides storage/session and Change Package infrastructure only. It is therefore not meaningful to ask the user to perform the following through the game UI now.

- [ ] In a real browser that reports strict IndexedDB transaction durability, create and reopen a campaign snapshot.
- [ ] Open the same campaign from two tabs and verify compare-and-swap rejects the stale writer.
- [ ] Verify a disjoint retry preserves both campaign changes.
- [ ] Stage and apply a Change Package; verify Major State, aggregate revisions and Applied ledger promote atomically.
- [ ] Retry the same package and verify idempotency.
- [ ] Verify stale baselines, corrupted checkpoints and invalid identity maps fail closed.
- [ ] Simulate interruption around promotion and verify reopening yields either the prior pending snapshot or the complete applied snapshot.
- [ ] Verify Temporary World disposal is allowed only after the exact package ID/digest is durably present in the Applied ledger.

These checks belong to the future Campaign implementation/acceptance phase. Their absence is an explicit scope limitation, not a defect in the currently exposed Pages workflow.

## Environment regression and performance — deferred validation

- [ ] Re-run the previously validated environment simulation in its authoritative host and compare with its existing baseline. No environment simulation source was changed in this Phase 3 work branch, and the authoritative module/host was not located in the audited repository tree.
- [ ] Measure representative 128×128 and 256×256 world setup, region query, movement and viewport costs. Record measurements before considering optimization.

These checks remain outstanding for the relevant integration/performance release; no environment behavior or performance result is claimed by the current Engine CI.

## Post-merge acceptance and remaining gates

- [x] Phase 3 implementation history merged into `main` through PR #7 (`0a879ed0ef955110b069b9e89bb420ead4f58737`).
- [x] Exact merge-commit Core/Host CI passed: [43940567950](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43940567950).
- [x] User confirmed the currently exposed Pages-hosted Cassandra workflow and `.cass` save/load path.
- [ ] Complete the remaining browser acceptance items above in the application/feature scope to which they belong.
- [ ] Decide together whether browser-readiness work should be part of a future phase; this checklist does not select or authorize that phase or any new gameplay rules.

A successful merge and CI run do not convert deferred manual/browser checks into passed items. Keep each remaining check open until it is actually performed and recorded.
