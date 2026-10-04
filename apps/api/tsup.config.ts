import { defineConfig } from 'tsup';

// Bundle workspace packages into the server so the runtime image needs only node_modules for
// third-party deps and no TypeScript toolchain.
export default defineConfig({
  entry: { server: 'src/server.ts', seed: 'src/db/seed/run.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@wn\//],
});
