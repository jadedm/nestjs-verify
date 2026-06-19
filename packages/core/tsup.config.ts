import { defineConfig } from 'tsup';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('./package.json') as { version: string };

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  // Inject the published version at build time so TELEMETRY.DEFAULT_TRACER_VERSION
  // never drifts from package.json.
  define: {
    __PACKAGE_VERSION__: JSON.stringify(pkg.version),
  },
  // Peer deps must NEVER be bundled. Bundling causes class identity (e.g.
  // HttpException) to diverge from the user's @nestjs/common at runtime
  // and Nest's exception filter returns 500 instead of the intended status.
  external: [
    '@nestjs/common',
    '@nestjs/core',
    '@nestjs/swagger',
    '@opentelemetry/api',
    'cache-manager',
    'class-transformer',
    'class-validator',
    'prom-client',
    'reflect-metadata',
    'rxjs',
  ],
});
