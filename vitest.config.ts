import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.{test,spec}.{js,ts}'],
    exclude: ['tests/**/*.browser.{test,spec}.{js,ts}'], // Exclude browser tests for now
    testTimeout: 10000,
    globals: true
  },
  esbuild: {
    sourcemap: true
  }
})
