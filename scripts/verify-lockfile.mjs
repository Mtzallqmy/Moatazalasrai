import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const lockfile = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
const root = lockfile?.packages?.[""];

if (!root || lockfile.lockfileVersion !== 3) {
  throw new Error("package-lock.json must use npm lockfileVersion 3 and contain the root package entry.");
}

function compareSection(name) {
  const expected = packageJson[name] ?? {};
  const actual = root[name] ?? {};
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) {
    throw new Error(`${name} keys differ between package.json and package-lock.json. Run npm install --package-lock-only.`);
  }
  for (const key of expectedKeys) {
    if (expected[key] !== actual[key]) {
      throw new Error(`${name}.${key} differs between package.json (${expected[key]}) and package-lock.json (${actual[key]}).`);
    }
  }
}

compareSection("dependencies");
compareSection("devDependencies");

if ((packageJson.version ?? null) !== (root.version ?? null)) {
  throw new Error(`Package version differs: package.json=${packageJson.version} package-lock.json=${root.version}.`);
}
if ((packageJson.engines?.node ?? null) !== (root.engines?.node ?? null)) {
  throw new Error(`Node engine differs: package.json=${packageJson.engines?.node} package-lock.json=${root.engines?.node}.`);
}

console.log(JSON.stringify({
  level: "info",
  event: "lockfile.verified",
  dependencies: Object.keys(root.dependencies ?? {}).length,
  devDependencies: Object.keys(root.devDependencies ?? {}).length,
  node: root.engines?.node,
}));
