import { defineConfig, type UserConfig } from 'tsdown'
import { typertPlugin } from '@deepseek-ai/dsh-typert-generator/tsdown'

function nodePackage(name: string, root: string, entries: string[], external: string[], plugins: UserConfig['plugins'] = []): UserConfig {
  return {
    name,
    entry: entries.map(entry => `${root}/lib/types/${entry}.js`),
    outDir: `${root}/lib`,
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: external },
    plugins,
  }
}

export default defineConfig([
  nodePackage('@flowboard/contracts', 'packages/contracts', ['index'], ['zod']),
  nodePackage('@flowboard/server', 'packages/server', ['index', 'cli', 'worker-cli'], ['@flowboard/contracts', 'fastify']),
  nodePackage('@flowboard/dsh-service', 'packages/dsh-service', ['index', 'invariant'], [
    '@flowboard/contracts', '@deepseek-ai/cordis', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-typert-protocol', 'zod',
  ], [
    typertPlugin({ mode: 'package', faces: ['host'] }),
  ]),
  nodePackage('@flowboard/dsh', 'packages/dsh', ['index'], ['@flowboard/dsh-client', '@flowboard/dsh-service']),
])
