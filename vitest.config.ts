import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@flowboard\/contracts$/, replacement: resolve('packages/contracts/src/index.ts') },
      { find: /^@flowboard\/server$/, replacement: resolve('packages/server/src/index.ts') },
      { find: /^@flowboard\/dsh-service$/, replacement: resolve('packages/dsh-service/src/index.ts') },
    ],
  },
  test: {
    include: ['packages/*/tests/**/*.spec.ts', 'packages/*/tests/**/*.spec.tsx'],
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
    },
  },
})
