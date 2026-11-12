import "../adapters/presentation/dev-world-preview.js";
import { listDefinitions, getCategories } from "./database/definition-registry.js";

const views = [...document.querySelectorAll("[data-view]")];
const navButtons = [...document.querySelectorAll("[data-navigate]")];
const databaseList = document.querySelector("#database-list");
const databaseSearch = document.querySelector("#database-search");
const databaseCategory = document.querySelector("#database-category");

function showView(name) {
  for (const view of views) view.hidden = view.dataset.view !== name;
  document.body.dataset.currentView = name;
  window.scrollTo(0, 0);
  if (name === "database") renderDatabase();
  if (name === "dev-lab") window.dispatchEvent(new Event("resize"));
}

function renderDatabase() {
  const query = databaseSearch.value.trim().toLocaleLowerCase();
  const category = databaseCategory.value;
  const entries = listDefinitions().filter((entry) => {
    const matchesCategory = category === "all" || entry.category === category;
    const haystack = [entry.name, entry.description, entry.category, ...Object.keys(entry.attributes)].join(" ").toLocaleLowerCase();
    return matchesCategory && (!query || haystack.includes(query));
  });

  databaseList.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "database-empty";
    empty.innerHTML = "<strong>Database is ready.</strong><span>No registered game definitions yet. As soon as we create Pawns, enemies, materials, structures, weapons or ammunition, their real definitions will appear here.</span>";
    databaseList.append(empty);
    return;
  }

  for (const entry of entries) {
    const card = document.createElement("article");
    card.className = "database-entry";
    const heading = document.createElement("div");
    heading.className = "database-entry-heading";
    const title = document.createElement("h3");
    title.textContent = entry.name;
    const type = document.createElement("span");
    type.className = "database-type";
    type.textContent = entry.category;
    heading.append(title, type);
    const description = document.createElement("p");
    description.textContent = entry.description;
    const attributes = document.createElement("dl");
    attributes.className = "attribute-list";
    for (const [key, value] of Object.entries(entry.attributes)) {
      const term = document.createElement("dt");
      term.textContent = key;
      const detail = document.createElement("dd");
      detail.textContent = typeof value === "object" ? JSON.stringify(value) : String(value);
      attributes.append(term, detail);
    }
    card.append(heading, description, attributes);
    databaseList.append(card);
  }
}

for (const button of navButtons) {
  button.addEventListener("click", () => showView(button.dataset.navigate));
}
document.querySelectorAll("[data-back-menu]").forEach((button) => button.addEventListener("click", () => showView("menu")));
databaseSearch.addEventListener("input", renderDatabase);
databaseCategory.addEventListener("change", renderDatabase);

for (const category of getCategories()) {
  const option = document.createElement("option");
  option.value = category;
  option.textContent = category;
  databaseCategory.append(option);
}

showView("menu");
