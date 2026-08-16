import { rm } from 'node:fs/promises'
import { glob } from 'node:fs/promises'

for await (const entry of glob('packages/*/lib')) {
  await rm(entry, { recursive: true, force: true })
}
for await (const entry of glob('packages/*/lib-types')) {
  await rm(entry, { recursive: true, force: true })
}
for await (const entry of glob('packages/*/*.tsbuildinfo')) {
  await rm(entry, { force: true })
}
await rm('artifacts', { recursive: true, force: true })
