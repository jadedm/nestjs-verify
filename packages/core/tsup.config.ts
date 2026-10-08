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
  // missing. A plain ES module has no require, which silently turned metrics
  // off for ESM apps (#48). The ESM build gets a function that makes one from
  // this file. The loader tries it first, inside its try, and falls back to
  // require: nothing runs at load, so a bundle that rewrites import.meta
  // (esbuild to CommonJS) cannot crash at startup. Bundlers that inline the
  // ESM build may warn about it (webpack: "the request of a dependency is an
  // expression"; esbuild to CJS from outside node_modules: empty import.meta).
  banner: ({ format }) =>
    format === 'esm'
      ? { js: "import { createRequire as __verifyCreateRequire } from 'node:module';\nconst __VERIFY_ESM_REQUIRE__ = (id) => __verifyCreateRequire(import.meta.url)(id);" }
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
