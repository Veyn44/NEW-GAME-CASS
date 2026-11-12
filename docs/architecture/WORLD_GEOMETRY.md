# World Geometry — Initial Decisions

**Status:** Approved design constraints for the first world-preview harness. These decisions do not define the final asteroid shape or base layout.

## World dimensions

- Every world uses a square coordinate extent: width equals height.
- Primary supported sizes are 64 × 64, 128 × 128 and 256 × 256 fields.
- The architecture should not inherently cap worlds at 256; larger square worlds such as 512 × 512 may be supported later.
- If an implementation requires a finite set of guaranteed presets, the primary set remains 64, 128 and 256.
- The home/base world size is deliberately undecided and may be changed after visual/gameplay evaluation.

## Coordinates and existence

- World positions use integer tile coordinates: X increases left-to-right, Y increases top-to-bottom.
- The square coordinate extent defines the possible address range; it does not mean every field must contain world content.
- Irregular content shapes (for example an asteroid, caves or open space) can occupy only part of the square extent.
- The grid is a presentation overlay. Hiding it must not remove or mutate world coordinates or world data.

## Camera and viewport

- World dimensions, tile size, viewport dimensions and camera zoom are separate concepts.
- The initial development preview uses a 2:1 viewport.
- At 100% preview zoom, the target visible area is 64 × 32 fields.
- Zoom changes only the visible field count, not the world dimensions.
- The camera can be panned with the middle mouse button; the left mouse button remains available for game interaction.
- The camera may overscan up to 20 tiles beyond each of the four world boundaries so edge-positioned entities can remain visible with breathing room. This does not create additional world tiles.
- If the viewport is too large to preserve both overscan bounds on an axis, the camera centers on that axis.
- Zoom uses the mouse wheel. In free-camera mode it anchors to the cursor; future camera-lock mode will anchor to its followed target.
- These preview values are provisional visual test settings, not a final art or Pawn scale decision.

## Initial browser preview

The first development harness intentionally contains only:
- a square empty world extent;
- an optional grid overlay;
- world-size selection for the three primary presets;
- camera pan, zoom and reset;
- a small diagnostic readout of world and visible dimensions.

It does not create an asteroid, terrain, Pawn, buildings, encounter content or final game UI.

## Deferred decisions

- Home/base world size.
- Actual tile dimensions and pixel-art scale.
- Pawn dimensions and camera-follow behavior.
- Asteroid outline, internal voids and surrounding-space proportions.
- Irregular/nonexistent world areas and their data representation.
- Encounter-specific dimensions and rules.
