import { defineConfig } from "tsup";
export default defineConfig({
  entry: { cli: "src/cli.ts", mcp: "src/mcp.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  splitting: true,
  clean: true,
  minify: false,
  sourcemap: false,
  shims: false,
});
