// Regenerates tests/golden/templates.json from the current compiler.
// Run: npm run golden
// Golden data is PROTECTED (see CLAUDE.md): only regenerate for an intended
// physics change, in its own commit, and explain why in the PR.
import { writeFileSync } from "node:fs";
import { runnerImport } from "vite";

const { module: lib } = await runnerImport("/scripts/golden-lib.ts");
const data = await lib.generate();
const path = new URL("../tests/golden/templates.json", import.meta.url);
// One sample per line keeps diffs readable.
const lines = Object.entries(data.templates).map(
  ([id, samples]) => `  ${JSON.stringify(id)}: [\n${samples.map((s) => `   ${JSON.stringify(s)}`).join(",\n")}\n  ]`,
);
const text = `{\n "script": ${JSON.stringify(data.script)},\n "sampleEvery": ${data.sampleEvery},\n "templates": {\n${lines.join(",\n")}\n }\n}\n`;
JSON.parse(text); // sanity
writeFileSync(path, text);
console.log(`wrote ${Object.keys(data.templates).length} trajectories to tests/golden/templates.json`);
process.exit(0);
