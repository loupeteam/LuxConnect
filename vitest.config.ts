import { defineConfig } from 'vitest/config'

// Integration tests require a live mapp Connect / OPC UA server on localhost:8443.
// In CI we skip them by file pattern; locally they run as part of `npm test`.
const isCI = !!process.env.CI

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.{test,spec}.{js,ts}'],
    exclude: [
      'tests/**/*.browser.{test,spec}.{js,ts}', // Exclude browser tests for now
      ...(isCI
        ? [
            'tests/node/integration.node.test.ts',
            'tests/node/integration-simple.node.test.ts',
            'tests/node/session-persistence.node.test.ts',
          ]
        : []),
    ],
    testTimeout: 10000,
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/*.test.ts',
        'src/**/*.spec.ts'
      ],
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage'
    }
  },
  esbuild: {
    sourcemap: true
  }
})
