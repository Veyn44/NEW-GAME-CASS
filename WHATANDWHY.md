# WHAT AND WHY — Cassandra Design Decisions

This file is the canonical log for accepted game and presentation decisions. It records the reason and intended behavior so later systems can build on deliberate choices rather than assumptions.

## Decision: Visual identity foundation

- **WHAT:** Keep the original Deep Space foundation: dark navy background, blue-toned panels, turquoise accent and light text. Replace the original bright purple accent with dark burgundy-purple (palette D, `#812044`).
- **WHY:** The original purple felt too conventionally violet. The selected shade is richer and redder while retaining a purple undertone; it gives Cassandra a distinctive accent without competing with the turquoise.
- **BEHAVIOR:** `#812044` is a static base color. No global pulsing, glow or animation is implied by the palette. Individual elements may opt into their own light/emission/pulse behavior when their function calls for it.
- **SCOPE:** Shared presentation design tokens and future game UI/lighting accents. This does not prescribe which gameplay objects emit light or animate.
- **STATUS:** Approved and implemented in the development preview.

## Decision: Full-screen world viewport and overlay UI

- **WHAT:** The world viewport occupies the full available application screen. UI is layered over the world rather than shrinking the world viewport. Reserve a top UI region and allow a floating panel on the left.
- **WHY:** The map should remain the primary continuous spatial surface. UI should not permanently consume map dimensions or introduce browser scrollbars into the main game screen.
- **BEHAVIOR:** The application shell should fit the viewport without page-level scrolling. The world rendering layer sits beneath UI overlay layers. The top region is reserved for persistent controls/status; the left panel is floating and can overlay the world.
- **SCOPE:** Development preview shell and future application presentation layout. Individual panel content, dimensions and interaction remain undecided.
- **STATUS:** Approved and implemented in the development preview shell.

## Decision: Camera zoom anchoring

- **WHAT:** Zoom behavior depends on camera lock state.
- **WHY:** Free navigation should preserve the point of interest under the pointer, while a camera following an entity should preserve that followed entity as the zoom focus.
- **BEHAVIOR:** With no camera lock, mouse-wheel zoom anchors to the cursor's world position. With a camera lock, zoom anchors to the locked target. A drafted Pawn is one example of a locked target, not a special-case camera mode; other entities may be followed later.
- **SCOPE:** Camera/presentation behavior. The camera lock target contract must be reusable for any eligible world entity.
- **STATUS:** Approved design; cursor-anchored wheel zoom can be implemented in the empty preview now. Entity-follow integration waits until world entities/Pawns exist.

## Decision: No universal animation for the accent palette

- **WHAT:** Color tokens define static colors only; motion and emission are explicit per-element behaviors.
- **WHY:** Not every burgundy-colored object should pulse. A static Pawn color, a status light and an illuminated colony gear can have different visual behavior.
- **BEHAVIOR:** Animation, pulse rate, glow intensity and emissive treatment are assigned to individual elements or components, never inferred merely from their color token.
- **SCOPE:** Presentation styling and future visual components.
- **STATUS:** Approved design.


## Decision: Middle-button camera panning

- **WHAT:** Holding the middle mouse button and dragging pans the world camera. Left mouse button is not used for camera panning.
- **WHY:** The left button must remain available for selection, contextual interaction and future gameplay actions such as attacks.
- **BEHAVIOR:** Only a middle-button pointer drag changes camera position. Wheel zoom remains independent. Left-button input is left available to future game interaction handlers.
- **SCOPE:** World preview input and future gameplay camera controls.
- **STATUS:** Approved and implemented in the development preview.

## Decision: Vertical camera overscan

- **WHAT:** The camera may show up to 20 world tiles beyond the top and bottom world boundaries.
- **WHY:** Pawns and other important objects at extreme vertical coordinates should not be forced against the screen edge or obscured by top overlay UI. The extra camera travel also provides room for future camera-follow behavior.
- **BEHAVIOR:** Camera vertical bounds extend by at most 20 tiles beyond the world. If the viewport is too large to preserve both bounds, the camera centers vertically. Horizontal camera bounds remain constrained to the world for now.
- **SCOPE:** Camera positioning in the world preview and future follow-camera framing. This is a camera visibility margin, not additional playable world area or new world tiles.
- **STATUS:** Approved and implemented as bounded vertical camera overscan. Pawn-follow framing still requires a real Pawn and later gameplay integration.
