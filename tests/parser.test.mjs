import { readFileSync } from 'node:fs'

const { parseVless } = await import('../site/src/lib/vless.ts')
const fixtures = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'))
const rows = []
for (const item of fixtures) {
  const parsed = await parseVless(item.uri)
  if (!parsed) {
    console.error(`failed ${item.name}`)
    process.exit(1)
  }
  rows.push({
    uri: item.uri,
    fingerprint: parsed.fingerprint,
    network: parsed.network,
    pbk: parsed.pbk,
    host: parsed.host,
  })
}
process.stdout.write(JSON.stringify(rows))
