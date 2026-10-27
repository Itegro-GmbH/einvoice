import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    // SaxonJS cold start (the largest SEF is ~13 MB) and veraPDF (JVM start) legitimately take
    // seconds on a loaded machine; the 5 s default is too tight.
    testTimeout: 60_000,
    hookTimeout: 300_000,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
  },
});
