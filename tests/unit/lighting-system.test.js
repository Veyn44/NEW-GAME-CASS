import test from "node:test";
import assert from "node:assert/strict";
import { LightingError, LightingSystem } from "../../engine/lighting/lighting-system.js";

function createWorldRegistry(worlds = [
  { worldId: "main", type: "colony", status: "active", dimensions: { width: 24, height: 24 }, grid: { width: 24, height: 24 }, coordinateSystem: "grid", metadata: {} },
  { worldId: "encounter", type: "encounter", status: "inactive", dimensions: { width: 24, height: 24 }, grid: { width: 24, height: 24 }, coordinateSystem: "grid", metadata: {} }
]) {
  const byId = new Map(worlds.map((world) => [world.worldId, world]));
  return { get: (id) => byId.get(id) ?? null };
}

function expectCode(operation, code) {
  assert.throws(operation, (error) => error instanceof LightingError && error.code === code);
}

function point(overrides = {}) {
  return {
    id: "torch", worldId: "main", type: "point",
    position: { x: 10.5, y: 10.5 }, enabled: true,
    intensity: 1, color: { r: 255, g: 220, b: 180 },
    radius: 14, innerRadius: 8, castsShadows: true,
    ...overrides
  };
}

test("point lights use the single quadratic falloff with a configurable bright inner radius", () => {
  const lighting = new LightingSystem({ worldRegistry: createWorldRegistry() });
  lighting.addLight(point());
  const { cells } = lighting.calculateIllumination({ worldId: "main" });
  const atTwo = cells.find((entry) => entry.cell.x === 12 && entry.cell.y === 10);
  const atTen = cells.find((entry) => entry.cell.x === 20 && entry.cell.y === 10);
  const atThirteen = cells.find((entry) => entry.cell.x === 23 && entry.cell.y === 10);
  assert.equal(atTwo.intensity, 1);
  assert.ok(atTen.intensity > 0 && atTen.intensity < 1);
  assert.ok(atThirteen.intensity > 0 && atThirteen.intensity < atTen.intensity);
  assert.equal(cells.some((entry) => entry.cell.x === 24), false);
});

test("opaque intermediate cells block illumination behind them but remain illuminated themselves", () => {
  const lighting = new LightingSystem({
    worldRegistry: createWorldRegistry(),
    occlusionQuery: ({ cell }) => cell.x === 12 && cell.y === 10
  });
  lighting.addLight(point({ innerRadius: 0 }));
  const { cells } = lighting.calculateIllumination({ worldId: "main" });
  assert.ok(cells.some((entry) => entry.cell.x === 12 && entry.cell.y === 10));
  assert.equal(cells.some((entry) => entry.cell.x === 13 && entry.cell.y === 10), false);
  assert.ok(cells.some((entry) => entry.cell.x === 11 && entry.cell.y === 10));
});

test("diagonal rays cannot leak through opaque cells touching a grid corner", () => {
  const lighting = new LightingSystem({
    worldRegistry: createWorldRegistry(),
    occlusionQuery: ({ cell }) => cell.x === 11 && cell.y === 10
  });
  lighting.addLight(point({ innerRadius: 0 }));
  const { cells } = lighting.calculateIllumination({ worldId: "main" });
  assert.equal(cells.some((entry) => entry.cell.x === 11 && entry.cell.y === 11), false);
});

test("light registry is isolated by world and supports update, disable and removal", () => {
  const lighting = new LightingSystem({ worldRegistry: createWorldRegistry() });
  lighting.addLight(point());
  lighting.addLight(point({ id: "other", worldId: "encounter" }));
  assert.deepEqual(lighting.listLights({ worldId: "main" }).map((light) => light.id), ["torch"]);
  const encounterCells = lighting.calculateIllumination({ worldId: "encounter" }).cells;
  assert.ok(encounterCells.length > 0);
  assert.ok(encounterCells.every((entry) => entry.contributions.every((item) => item.lightId === "other")));
  const mainCells = lighting.calculateIllumination({ worldId: "main" }).cells;
  assert.ok(mainCells.every((entry) => entry.contributions.every((item) => item.lightId === "torch")));
  lighting.updateLight("torch", { enabled: false });
  assert.equal(lighting.calculateIllumination({ worldId: "main" }).cells.length, 0);
  lighting.updateLight("torch", { enabled: true, position: { x: 8.5, y: 8.5 } });
  assert.ok(lighting.calculateIllumination({ worldId: "main" }).cells.length > 0);
  assert.equal(lighting.removeLight("torch"), true);
  assert.equal(lighting.removeLight("torch"), false);
});

test("light definitions reject invalid values and unsupported falloff models", () => {
  const lighting = new LightingSystem({ worldRegistry: createWorldRegistry() });
  expectCode(() => lighting.addLight(point({ radius: 0 })), "INVALID_LIGHT");
  expectCode(() => lighting.addLight(point({ innerRadius: 14 })), "INVALID_INNER_RADIUS");
  expectCode(() => lighting.addLight(point({ color: { r: 256, g: 0, b: 0 } })), "INVALID_COLOR");
  expectCode(() => lighting.addLight(point({ type: "area" })), "UNSUPPORTED_LIGHT_TYPE");
  expectCode(() => lighting.addLight(point({ worldId: "missing" })), "UNKNOWN_WORLD");
  expectCode(() => lighting.addLight(point({ falloff: "linear" })), "UNSUPPORTED_FALLOFF");
});

test("light snapshots are detached and immutable", () => {
  const lighting = new LightingSystem({ worldRegistry: createWorldRegistry() });
  const source = point();
  const stored = lighting.addLight(source);
  source.position.x = 0;
  assert.equal(stored.position.x, 10.5);
  assert.equal(Object.isFrozen(stored), true);
  assert.equal(Object.isFrozen(lighting.listLights()), true);
});

test("bounds are validated and use half-open grid coordinates", () => {
  const lighting = new LightingSystem({ worldRegistry: createWorldRegistry() });
  lighting.addLight(point());
  assert.equal(lighting.calculateIllumination({ worldId: "main", bounds: { minX: 10, minY: 10, maxX: 12, maxY: 12 } }).cells.length, 4);
  expectCode(() => lighting.calculateIllumination({ worldId: "main", bounds: { minX: 0, minY: 0, maxX: 25, maxY: 2 } }), "INVALID_BOUNDS");
});


test("spot lights illuminate inside their cone, soften the cone edge and exclude cells behind them", () => {
  const lighting = new LightingSystem({ worldRegistry: createWorldRegistry() });
  lighting.addLight(point({
    id: "flashlight", type: "spot", position: { x: 10.5, y: 10.5 },
    direction: 0, innerAngle: Math.PI / 4, outerAngle: Math.PI / 2,
    radius: 10, innerRadius: 0
  }));
  const { cells } = lighting.calculateIllumination({ worldId: "main" });
  const cell = (x, y) => cells.find((entry) => entry.cell.x === x && entry.cell.y === y);
  assert.ok(cell(15, 10)?.intensity > 0);
  assert.equal(cell(5, 10), undefined);
  assert.equal(cell(10, 15), undefined);
  assert.ok(cell(15, 13)?.intensity > 0);
  assert.ok(cell(15, 12).intensity < cell(15, 10).intensity);
});

test("spot light direction rotates through the public update API", () => {
  const lighting = new LightingSystem({ worldRegistry: createWorldRegistry() });
  lighting.addLight(point({ type: "spot", direction: 0, innerAngle: Math.PI / 3, outerAngle: Math.PI / 2, radius: 9, innerRadius: 0 }));
  const east = lighting.calculateIllumination({ worldId: "main" }).cells;
  assert.ok(east.some((entry) => entry.cell.x > 14 && Math.abs(entry.cell.y - 10) <= 1));
  lighting.updateLight("torch", { direction: Math.PI / 2 });
  const north = lighting.calculateIllumination({ worldId: "main" }).cells;
  assert.ok(north.some((entry) => entry.cell.y > 14 && Math.abs(entry.cell.x - 10) <= 1));
  assert.equal(north.some((entry) => entry.cell.x > 14 && Math.abs(entry.cell.y - 10) <= 1), false);
});

test("spot definitions validate direction and cone angles", () => {
  const lighting = new LightingSystem({ worldRegistry: createWorldRegistry() });
  expectCode(() => lighting.addLight(point({ type: "spot", direction: 0, innerAngle: 2, outerAngle: 1 })), "INVALID_CONE_ANGLES");
  expectCode(() => lighting.addLight(point({ type: "spot", direction: 0, innerAngle: 0, outerAngle: 0 })), "INVALID_LIGHT");
  expectCode(() => lighting.addLight(point({ type: "spot", direction: NaN, innerAngle: 0, outerAngle: 1 })), "INVALID_LIGHT");
});
