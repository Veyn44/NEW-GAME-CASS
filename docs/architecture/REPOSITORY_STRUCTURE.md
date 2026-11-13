# Repository Structure and Merge Map

This document defines where code and documentation belong. It is a responsibility map, not a requirement to create empty directories in advance.

## Top-level layout

```text
/
├── .github/workflows/          # CI and repository automation
├── docs/
│   ├── phases/                 # Phase plans and acceptance criteria
│   ├── architecture/           # Architecture maps and repository structure
│   ├── standards/              # System and code authoring standards
│   └── testing/                # Test plans, procedures and evidence
├── src/
│   ├── core/                   # Reusable, domain-neutral runtime; protected baseline
│   ├── host/                   # Application composition and lifecycle
│   ├── adapters/
│   │   ├── input/              # Device/browser input translated into requests
│   │   ├── presentation/       # Rendering, camera, UI and debug presentation
│   │   └── storage/            # Host storage implementations
│   ├── systems/                # Gameplay systems, one responsibility per folder
│   └── worlds/                 # Reusable world definitions/assets, only when needed
└── tests/
    ├── unit/
    ├── contract/
    ├── integration/
    └── e2e/
```

## Rules

- Do not create empty folders just to reserve names. Create a directory with its first real file.
- Keep `src/core/` isolated. Gameplay code must not be placed there.
- Host composition belongs in `src/host/`; it assembles systems but does not own their domain data.
- Device/browser APIs and rendering stay in adapters, never in domain simulation code.
- Each gameplay system gets its own folder under `src/systems/<system-name>/`, with its public contract, implementation and local documentation grouped together when size warrants it.
- Shared data/configuration assets belong in `src/worlds/` only when they are genuinely reusable. A single hard-coded test-world definition does not justify an asset pipeline.
- Tests are grouped by what they prove, not by the order they were written.
- Existing Core test files currently live directly in `tests/`. Do not move them as cosmetic cleanup during Phase 2. Preserve `npm run test:core`; any future relocation must update the runner and CI in the same change and prove identical coverage.
- Documentation must have one canonical home. Do not leave duplicate, diverging copies at the repository root.

## Phase-to-main integration map

| Content | Destination in stable main | Gate |
|---|---|---|
| Phase plans | `docs/phases/` | Actual outcomes, tests and deferred work recorded |
| Architecture and ownership | `docs/architecture/` | Matches the implementation |
| System standards | `docs/standards/` | Uses real Core contracts |
| Test plans and evidence | `docs/testing/` | Commands/results reproducible |
| Host composition | `src/host/` | Startup, shutdown and failure cleanup pass |
| Input/presentation/storage | `src/adapters/` | No authoritative game state hidden in adapters |
| Gameplay systems | `src/systems/` | Ownership, contracts and tests pass |
| World definitions/assets | `src/worlds/` | Only reusable world data; no premature framework |
| Automated tests | `tests/{unit,contract,integration,e2e}/` | Included in CI and documented commands |

## Phase branch merge procedure

1. Record the exact `main` base commit from which the phase branch started.
2. Finish all substeps on the phase branch and keep the whole branch green.
3. Review the complete diff against the recorded base, not merely the last commit.
4. Confirm no unauthorized Core changes, secrets, generated junk or unrelated edits.
5. Run all Core regression tests and all phase tests.
6. Review public API boundaries, ownership, lifecycle, persistence, imports and directory placement.
7. Update documentation with actual file paths and honest test evidence.
8. Prepare a concise merge report with the phase deliverables, test results, known limitations and rollback point.
9. Obtain explicit user acceptance.
10. Merge the complete phase into `main`, then verify the resulting main CI run.

A completed phase is normally merged with a merge commit so its milestone history remains visible. Do not merge unfinished phase work into main. Do not start the next phase until the accepted result is on main.

## Change policy

A folder structure is not an excuse to fragment code. Keep small cohesive modules together; split a system only when ownership, lifecycle, public API or test boundaries justify it. The goal is clear responsibility and safe evolution, not maximum file count.
