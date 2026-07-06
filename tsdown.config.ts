import { defineConfig } from "tsdown";

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
