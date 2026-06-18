import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  // Peer deps must NEVER be bundled — otherwise class identity (e.g.
  // HttpException) diverges from the user's @nestjs/common at runtime and
  // Nest's exception filter returns 500 instead of the intended status.
  external: [
    '@nestjs/common',
    '@nestjs/core',
    '@nestjs/cache-manager',
    'cache-manager',
    'reflect-metadata',
    'rxjs',
  ],
});
