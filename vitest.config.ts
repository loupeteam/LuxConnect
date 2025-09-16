import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.{test,spec}.{js,ts}'],
    exclude: ['tests/**/*.browser.{test,spec}.{js,ts}'], // Exclude browser tests for now
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
