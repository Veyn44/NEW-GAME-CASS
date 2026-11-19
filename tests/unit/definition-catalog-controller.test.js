import test from "node:test";
import assert from "node:assert/strict";
import { createDefinitionCatalogController } from "../../shared/application/definition-catalog-controller.js";

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor() {
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.textContent = "";
    this.children = [];
    this.listeners = new Map();
    this.attributes = {};
    this.classList = new FakeClassList();
  }
  addEventListener(type, callback) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(callback);
    this.listeners.set(type, listeners);
  }
  async emit(type) {
    const results = [];
    for (const callback of this.listeners.get(type) ?? []) results.push(await callback({ type, target: this }));
    return results.at(-1);
  }
  async click() { return this.emit("click"); }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = [...items]; }
  setAttribute(name, value) { this.attributes[name] = value; }
  querySelectorAll(selector) {
    if (selector.startsWith(".")) {
      const className = selector.slice(1);
      return this.children.filter((child) => child.className?.split(" ").includes(className));
    }
    return [];
  }
  get childElementCount() { return this.children.length; }
}

const definitions = [
  { id: "pawn.johny", name: "Johny", category: "PERSONNEL", description: "Crew member", spawnableAs: ["unit"] },
  { id: "enemy.raider", name: "Raider", category: "HOSTILE", description: "Hostile unit" },
  { id: "wall.aluminium", name: "Aluminium Wall", category: "STRUCTURE", description: "Ship wall" }
];

function createHarness({ loadDetail, canSelect = (definition) => Boolean(definition.spawnableAs?.length), onSelect = () => {}, allowBrowseSelection = false } = {}) {
  const elements = {
    list: new FakeElement(),
    search: new FakeElement(),
    category: new FakeElement(),
    inspector: new FakeElement(),
    selectButton: new FakeElement()
  };
  elements.category.value = "all";
  const detailCalls = [];
  const controller = createDefinitionCatalogController({
    elements,
    documentRef: { createElement: () => new FakeElement() },
    listDefinitionIndex: () => definitions,
    getCategories: () => ["HOSTILE", "PERSONNEL", "STRUCTURE"],
    loadDefinitionDetail: loadDetail ?? (async (id) => definitions.find((item) => item.id === id) ?? null),
    canSelectDefinition: canSelect,
    onSelectDefinition: onSelect,
    allowBrowseSelection
  });
  return { controller, elements, detailCalls };
}

test("catalog renders registered definitions and filters by search and category", async () => {
  const { controller, elements } = createHarness();
  controller.open("browse");
  assert.equal(elements.list.children.length, 3);
  assert.deepEqual(elements.category.children.map((option) => option.value), ["all", "HOSTILE", "PERSONNEL", "STRUCTURE"]);

  elements.search.value = "aluminium";
  await elements.search.emit("input");
  assert.equal(elements.list.children.length, 1);
  assert.equal(elements.list.children[0].children[0].textContent, "Aluminium Wall");

  elements.search.value = "";
  elements.category.value = "HOSTILE";
  await elements.category.emit("change");
  assert.equal(elements.list.children.length, 1);
  assert.equal(elements.list.children[0].children[0].textContent, "Raider");
});

test("Dev Lab can spawn explicitly spawnable definitions from the database and keeps informational entries read-only", async () => {
  let selected = null;
  const { controller, elements } = createHarness({
    allowBrowseSelection: true,
    onSelect: (definition) => { selected = definition; }
  });
  controller.open("browse");
  await elements.list.children[0].click();
  assert.equal(controller.getSelectedDefinitionId(), "pawn.johny");
  assert.equal(elements.inspector.children[0].children[1].textContent, "Johny");
  assert.equal(elements.selectButton.hidden, false);
  assert.equal(elements.selectButton.disabled, false);
  await elements.selectButton.click();
  assert.equal(selected.id, "pawn.johny");

  await elements.list.children[1].click();
  assert.equal(elements.selectButton.hidden, true);
  assert.equal(selected.id, "pawn.johny");
});

test("catalog ignores stale asynchronous detail results after a newer selection", async () => {
  let resolveFirst;
  const first = new Promise((resolve) => { resolveFirst = resolve; });
  const { controller, elements } = createHarness({
    loadDetail: async (id) => id === "pawn.johny" ? first : definitions.find((item) => item.id === id)
  });
  controller.open("browse");
  const firstRequest = elements.list.children[0].click();
  await elements.list.children[1].click();
  resolveFirst({ ...definitions[0], name: "Stale Johny" });
  await firstRequest;
  assert.equal(controller.getSelectedDefinitionId(), "enemy.raider");
  assert.equal(elements.inspector.children[0].children[1].textContent, "Raider");
});

test("catalog reports missing details and registry errors without leaving a loading state", async () => {
  const { controller, elements } = createHarness({
    loadDetail: async (id) => {
      if (id === "pawn.johny") throw new Error("registry offline");
      return null;
    }
  });
  controller.open("browse");
  await elements.list.children[0].click();
  assert.match(elements.inspector.children[0].textContent, /registry offline/);
  await elements.list.children[1].click();
  assert.equal(elements.inspector.children[0].textContent, "Definition details are not available.");
});
