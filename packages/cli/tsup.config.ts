import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  noExternal: ['@memagent/core', 'commander'],
  // Commander is CommonJS and uses Node built-ins; provide require in ESM.
  banner: { js: "import { createRequire as __memagentCreateRequire } from 'node:module';\nconst require = __memagentCreateRequire(import.meta.url);" },
});
