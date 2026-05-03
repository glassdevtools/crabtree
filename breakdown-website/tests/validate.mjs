import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Script, createContext } from "node:vm";

const repoRoot = new URL("../..", import.meta.url).pathname;
const siteRoot = join(repoRoot, "breakdown-website");
const dataFiles = [
  "data/product-surface.js",
  "data/website.js",
  "data/desktop-app.js",
];

const context = createContext({
  window: {},
});

for (const dataFile of dataFiles) {
  const source = readFileSync(join(siteRoot, dataFile), "utf8");
  new Script(source, { filename: dataFile }).runInContext(context);
}

const data = context.window.breakdownWebsiteData;
const sections = [data.productSurface, data.website, data.desktopApp];
const requiredKeys = [
  "id",
  "title",
  "summary",
  "sourceFiles",
  "highLevelVariables",
  "variableTypes",
  "flowchart",
  "backgroundStates",
  "backendProducts",
  "features",
  "decisions",
];

for (const section of sections) {
  for (const key of requiredKeys) {
    assert.ok(section[key] !== undefined, `${section.id} is missing ${key}`);
  }

  assert.ok(section.sourceFiles.length > 0, `${section.id} needs source files`);
  for (const sourceFile of section.sourceFiles) {
    assert.ok(
      existsSync(join(repoRoot, sourceFile)),
      `${section.id} references missing source file ${sourceFile}`,
    );
  }

  assert.ok(
    section.highLevelVariables.length > 0,
    `${section.id} needs high level variables`,
  );
  assert.ok(
    section.variableTypes.length > 0,
    `${section.id} needs type states`,
  );
  assert.ok(
    section.flowchart.startsWith("flowchart TD"),
    `${section.id} flowchart must be a Mermaid flowchart`,
  );
  assert.ok(
    section.backgroundStates.length > 0,
    `${section.id} needs background states`,
  );
  assert.ok(
    section.backendProducts.length > 0,
    `${section.id} needs backend products`,
  );
  assert.ok(section.features.length > 0, `${section.id} needs features`);
  assert.ok(section.decisions.length > 0, `${section.id} needs decisions`);

  for (const feature of section.features) {
    assert.ok(
      feature.stateChanges.length > 0,
      `${section.id} feature ${feature.feature} needs state changes`,
    );
    assert.ok(
      feature.backendResponses.length > 0,
      `${section.id} feature ${feature.feature} needs backend responses`,
    );
  }
}

const html = readFileSync(join(siteRoot, "index.html"), "utf8");
for (const dataFile of dataFiles) {
  assert.ok(html.includes(dataFile), `index.html must load ${dataFile}`);
}
