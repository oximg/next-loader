import { defineConfig } from "tsdown";

// Plain ESM config (not .ts) so tsdown can load it on any supported Node
// version without a TypeScript loader — Node 20 has no native type
// stripping, and relying on tsdown's optional loader broke CI there.
export default defineConfig({
  entry: ["src/index.ts", "src/sign.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  treeshake: true,
  // The `sign` entry pulls in node:crypto; `platform: node` externalizes
  // it correctly. The main entry imports no Node builtins, so it stays
  // portable to the browser (where Next.js runs the loader for srcset).
  platform: "node",
});
