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
  // The optional peer prom-client is loaded with require() so it can be
  // missing. In an ES module `require` does not exist, and tsup's __require
  // stub then throws, which silently turned metrics off for ESM apps (#48).
  // Give the ESM build a real require, resolved from this file.
  banner: ({ format }) =>
    format === 'esm'
      ? { js: "import { createRequire as __verifyCreateRequire } from 'node:module';\nconst require = __verifyCreateRequire(import.meta.url);" }
      : {},
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
