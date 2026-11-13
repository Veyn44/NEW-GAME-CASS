# Cassandra — Game Vision and Design Notes

> This is an inspiration and design-memory document for the Cassandra game. It is not the specification of the universal engine, and ideas below are not automatically approved for implementation. The user keeps much of Cassandra's full vision in their head; this file intentionally preserves only useful anchors from earlier discussions.

## Overall direction

Cassandra is envisioned as a 2D game with a strong colony-simulation foundation and room for top-down shooter/action elements. The intention is not to lock the game into one narrow genre. Colony management, direct control, exploration and action may coexist where the design calls for them.

The engine being built through Cassandra should remain more general than this particular game. Cassandra's rules and content belong to its game layer, not to generic engine infrastructure.

## World and play structure ideas

- A persistent home/base world represents the continuing colony state.
- Temporary worlds may support activities such as expeditions or encounters. Earlier design direction allowed at most one active temporary world at a time, with the persistent world retaining its state while inactive. The detailed gameplay lifecycle remains future work.
- The first gameplay test world used a 128 × 128 tile extent. This was a test configuration, not a final base-world size or a universal engine limit.
- Earlier ideas include an asteroid/base setting, exploration beyond the home world and distinct environments for different activities. Their final content and rules remain open.

## Units, Pawns and player control

Earlier Cassandra design work established useful vocabulary:

- **Entity** is the generic identity/lifecycle concept supplied by Core.
- **Unit** is a Cassandra gameplay instance backed by a Core Entity.
- **Pawn** is a Unit that belongs in some way to player control. It does not necessarily mean continuous direct manual control.
- Colony leadership, Pawn membership and direct Draft are separate concepts. The colony can have a leader reference, while Draft identifies the Unit currently receiving direct player input.

The first implemented slice used Johny as the initial controllable Unit and Colony Leader. Future biological beings, robots, stationary devices and other intelligent entities are design possibilities, not a finalized Unit schema.

## Application and development experience

Ideas recorded during early Cassandra design include:

- A main application shell with separate modes such as New Game and Dev Lab.
- A full-screen world viewport, with interface panels layered above it rather than reducing the world canvas.
- A shared Database/catalog for browsing and inspecting canonical game definitions, with the possibility of categories such as Pawns, enemies, structures, materials, weapons and ammunition as those game systems exist.
- Dev Lab as a development environment that hosts the same underlying gameplay systems intended for the actual game. Its diagnostic UI, test content and developer controls should not leak into the player-facing game.
- The option of making Dev Lab available to players in a future build was previously considered, but no player-access or permission model was committed.

## Presentation and controls

Earlier accepted Cassandra presentation decisions included:

- A dark navy / blue-toned visual foundation, turquoise accent, light text and a dark burgundy-purple accent (`#812044`).
- Color tokens remain static; glow, emission and animation are explicit behaviors of individual elements rather than automatic consequences of color.
- The world viewport remains the primary spatial surface, with floating UI overlays.
- Middle mouse drag pans the camera; the wheel zooms. In free-camera mode zoom anchors around the pointer; a future camera-follow mode should anchor around its target.
- Camera overscan was allowed up to 20 world tiles beyond each boundary as a framing margin, not as additional playable world.

These notes preserve the direction and reasoning behind the early prototype. They do not require every future game or engine host to use Cassandra's visual style, controls or world model.

## Design status rule

Treat this document as a source of remembered ideas, not as a binding implementation contract. Before turning an idea into work:
1. Confirm that it still fits the current Cassandra vision.
2. Decide whether it is game-specific or a genuinely reusable engine capability.
3. Record the decision in the active development plan before implementation.
