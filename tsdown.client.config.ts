import { defineConfig } from 'tsdown'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { transform } from 'lightningcss'

const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-api-remotes/client',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-ui-conversation/client',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-slots',
]

const CSS_PREFIX = '\0flowboard-css:'
const CSS_SUFFIX = '.mjs'

function sourceCssPath(source: string, importer: string): string {
  const emitted = resolve(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const marker = '/lib/types/'
  const boundary = emitted.indexOf(marker)
  return boundary < 0 ? emitted : resolve(emitted.slice(0, boundary), 'src', emitted.slice(boundary + marker.length))
}

function cssModulesPlugin() {
  return {
    name: 'flowboard-css-modules-inline',
    resolveId(source: string, importer?: string) {
      if (!source.endsWith('.module.css')) return null
      return `${CSS_PREFIX}${importer === undefined ? source : sourceCssPath(source, importer)}${CSS_SUFFIX}`
    },
    async load(id: string) {
      if (!id.startsWith(CSS_PREFIX)) return null
      const file = id.slice(CSS_PREFIX.length, -CSS_SUFFIX.length)
      const source = await readFile(file)
      const result = transform({ filename: file, code: source, cssModules: { pattern: '[hash]_[local]' }, minify: true })
      const classes: Record<string, string> = {}
      for (const [local, value] of Object.entries(result.exports ?? {})) classes[local] = value.name
      return [
        `const text=${JSON.stringify(result.code.toString())};`,
        'const selector=\'style[data-plugin-css="@flowboard/dsh-client"]\';',
        'if(typeof document!==\'undefined\'&&document.querySelector(selector)===null){',
        'const style=document.createElement(\'style\');style.dataset.plugin=\'@flowboard/dsh-client\';',
        'style.dataset.pluginCss=\'@flowboard/dsh-client\';style.textContent=text;document.head.appendChild(style);}',
        `export default ${JSON.stringify(classes)};`,
      ].join('\n')
    },
  }
}

export default defineConfig([
  {
    name: '@flowboard/dsh-client',
    entry: ['packages/dsh-client/lib/types/index.js'],
    outDir: 'packages/dsh-client/lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    name: '@flowboard/dsh-client/client',
    entry: { client: 'packages/dsh-client/lib/types/client/index.js' },
    outDir: 'packages/dsh-client/lib',
    format: ['cjs'],
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    deps: {
      neverBundle: CLIENT_EXTERNALS,
      alwaysBundle: id => CLIENT_EXTERNALS.includes(id) ? undefined : true,
    },
    plugins: [cssModulesPlugin()],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "@flowboard/dsh-client", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
