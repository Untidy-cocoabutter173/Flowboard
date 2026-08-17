import { defineConfig } from 'tsdown'

const DSH_HOST_EXTERNALS = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-typert-protocol',
]

export default defineConfig({
  name: '@flowboard/dsh',
  entry: ['packages/dsh/lib/types/index.js'],
  outDir: 'packages/dsh/lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: {
    neverBundle: DSH_HOST_EXTERNALS,
    alwaysBundle: id => DSH_HOST_EXTERNALS.includes(id) ? undefined : true,
  },
})
