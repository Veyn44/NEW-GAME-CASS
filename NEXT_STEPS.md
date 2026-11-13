# Next Steps and Development Handoff

> Read this file first when continuing work in a new ChatGPT conversation. It describes the current direction and the immediate next actions. Verify the live repository before making changes.

## Current project direction

We are developing **a universal 2D game engine through the Cassandra game project**.

We are not building a separate engine project alongside Cassandra. Cassandra remains the first real host game and the practical environment in which engine capabilities are discovered, implemented and validated.

The engine should support different 2D genres. Our likely center of gravity is colony simulation and top-down action/shooter, or a combination, but we do not want to prohibit other genres such as platformers merely through an early architectural decision.

## How we will build universality

1. Continue working from real Cassandra needs and the existing project direction.
2. When a capability can reasonably be general-purpose, build the reusable version first.
3. Keep Cassandra-specific rules, content and presentation in the Cassandra/game layer rather than hard-coding them into generic engine infrastructure.
4. Do not invent abstractions or systems without a concrete need. Generalize from real requirements, and keep optional capabilities optional.
5. The exact future behavior and composition of Units is still open. Do not assume that every idea in the old Phase 3 plan is approved or start implementing it without renewed design.

The goal is to reach a point where the accumulated reusable systems form a stable **Universal 2D Engine Foundation**. A later merge will be identified as the final baseline for that initial engine foundation. It will be a stable starting point for future games, not a promise that the engine can never evolve again.

## Dev Lab is a first-class development tool

Dev Lab is unusually important to this project. It may be hidden or omitted from a final player-facing build; it does not need to be part of the shipped runtime. Its value is in development.

- Dev Lab should host the same real systems that the game uses, not parallel Dev Lab-only gameplay implementations.
- It should let us create, inspect and test systems in isolation and in combination, without requiring a complete game session.
- A significant system is not considered ready merely because it works in the full Cassandra flow. It should have an appropriate repeatable test path in Dev Lab, alongside automated tests.
- Development-only controls, test data and diagnostic presentation must remain separate from the reusable runtime/gameplay logic.

## Development workflow

For each meaningful system or capability:

1. Define its responsibility, owned state, public contract, dependencies and non-responsibilities.
2. Identify which parts are reusable engine technology and which are Cassandra-specific.
3. Implement the smallest useful version.
4. Add automated unit/contract/integration coverage as appropriate.
5. Expose an appropriate Dev Lab scenario to test it directly and with related systems.
6. Verify the real Cassandra integration.
7. Record actual test evidence, known limitations and deferred items.
8. Merge completed work into `main`; preserve an archive snapshot at the agreed merge milestones.

Do not claim a test passed unless it was actually run. Keep manual browser checks separate from automated CI results.

## Immediate work — documentation and audit

**Current task: consolidate and verify project documentation before starting new implementation.**

1. This documentation cleanup reduces the project memory to three concise canonical documents:
   - [PROJECT_HISTORY.md](PROJECT_HISTORY.md) — verified history and accepted implementation outcomes.
   - [CASSANDRA_VISION.md](CASSANDRA_VISION.md) — game ideas and design inspiration.
   - [NEXT_STEPS.md](NEXT_STEPS.md) — current direction and handoff instructions.
2. The user will provide a Gemini audit only after this cleanup. Do not invent or anticipate its findings.
3. Review every Gemini observation against the actual current repository, source code, tests and accepted decisions. Classify each as confirmed, partially correct, incorrect/misunderstood, useful proposal or conflicting with an accepted decision.
4. Only after that review, agree on the revised development roadmap and the next implementation phase.
5. No source-code changes until the documentation cleanup, Gemini audit review and next-step strategy are agreed.

## Planning constraints

- Build reusable engine capabilities before Cassandra-only systems whenever that is practical.
- Dev Lab testability is a priority, not an optional finishing task.
- Do not expand Core merely for convenience. Any Core change needs a separate technical justification and review against its public contracts.
- Keep the current tested Core behavior stable unless a real requirement proves a change is necessary.
- Preserve the archived repository as a reference snapshot. Active work belongs in `Veyn44/NEW-GAME-CASS`.
- The historical `next-step/phase-2` branch is retained. Do not delete, rename or reuse it without an explicit decision. A future phase branch must be created fresh from the then-current `main`.

## Technical commands and references

The repository requires Node.js 20 or newer. Current test commands:
- `npm run test:core`
- `npm run test:host`
- `npm run test:all`

For current Core and host APIs, consult [src/core/README.md](src/core/README.md) and [src/host/README.md](src/host/README.md), then verify against source. Do not rely on old phase-specific contracts as if they were current universal-engine specifications.

## First action in the next working session

Ask the user to provide the Gemini audit. Then review it systematically against the current `main` state. Do not begin Phase 3 implementation or make speculative architectural changes before this review and roadmap agreement.
