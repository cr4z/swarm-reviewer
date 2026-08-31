// Bundles each composite action's entry point to a single committed dist/index.js,
// so consuming repositories never run `npm install` at use time (Principle V).
import { build } from "esbuild";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const actionsDir = new URL("../actions/", import.meta.url).pathname;

const actionNames = readdirSync(actionsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

if (actionNames.length === 0) {
  console.error("No actions found under actions/");
  process.exit(1);
}

for (const name of actionNames) {
  const entry = join(actionsDir, name, "src", "index.ts");
  if (!existsSync(entry)) {
    console.warn(`Skipping "${name}": no src/index.ts yet`);
    continue;
  }
  const outfile = join(actionsDir, name, "dist", "index.js");
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
    sourcemap: false,
    minify: false,
  });
  console.log(`Built ${name} -> ${outfile}`);
}
