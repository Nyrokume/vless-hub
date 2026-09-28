import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_saved_filters_migrate_and_chip_counts_match_results():
    script = r"""
import {
  countMatches,
  defaultListState,
  facetCounts,
  migrateListState,
  migrateSettings,
  protocolKey,
  sanitizeListState,
  toFacet,
  transportKey,
} from './site/src/lib/filters.ts'

const fallback = {
  sort: 'latency-asc',
  view: 'country',
  latencyThreshold: null,
  client: 'happ',
  publicBase: 'https://nyrokume.github.io/vless-hub',
}
const settings = migrateSettings({
  sort: 'ping',
  view: 'groups',
  latencyThreshold: 40,
  client: 'old-app',
  publicBase: 'https://example.test/',
  protocol: 'hy2',
}, fallback)
if (settings.sort !== 'latency-asc' || settings.view !== 'country') process.exit(1)
if (settings.latencyThreshold !== null || settings.client !== 'happ') process.exit(1)
if (settings.publicBase !== 'https://example.test') process.exit(1)
if (migrateSettings({ latencyThreshold: '150', sort: 'slow' }, fallback).latencyThreshold !== 150) process.exit(1)
if (migrateSettings({ latencyThreshold: 'all' }, fallback).latencyThreshold !== null) process.exit(1)

const legacy = migrateListState(null, {
  protocol: 'hy2',
  transport: 'HY2',
  security: 'None',
  country: 'uk',
  query: 'should-not-survive',
  showUnverified: 'true',
})
if (legacy.protocol !== 'hysteria2' || legacy.transport !== 'hysteria2') process.exit(1)
if (legacy.security !== 'none' || legacy.country !== 'GB' || legacy.query !== '') process.exit(1)
if (legacy.showUnverified !== true) process.exit(1)

const oldList = migrateListState({
  version: 1,
  protocol: 'ss',
  transport: 'no-such-transport',
  security: 'nope',
  country: 'ZZ',
  query: 'nomatch-zzz',
}, null)
if (oldList.protocol !== 'shadowsocks' || oldList.query !== '') process.exit(1)

const kept = migrateListState({ version: 2, protocol: 'vless', query: 'berlin', transport: null }, null)
if (kept.query !== 'berlin' || kept.protocol !== 'vless') process.exit(1)

const raw = [
  { protocol: 'hy2', transport: 'hy2', security: '', country_code: 'us', latency_ms: 100, blob: 'alpha us' },
  { protocol: 'hysteria2', transport: 'hysteria2', security: 'tls', country_code: 'UK', latency_ms: 180, blob: 'beta gb' },
  { protocol: 'ss', transport: 'tcp', security: 'none', country_code: 'de', latency_ms: 400, blob: 'gamma de' },
  { protocol: 'vless', transport: 'ws', security: 'reality', country_code: 'DE', latency_ms: 90, blob: 'delta de' },
  { protocol: 'trojan', transport: 'grpc', security: 'tls', country_code: 'nl', latency_ms: 250, blob: 'epsilon nl' },
]
const items = raw.map(toFacet)
if (protocolKey('SS') !== 'shadowsocks' || transportKey('HY2') !== 'hysteria2') process.exit(1)

const open = { query: '', country: null, transport: null, security: null, protocol: null, threshold: null }
for (const field of ['protocol', 'transport', 'security', 'country']) {
  for (const row of facetCounts(items, open, field)) {
    const next = { ...open, [field]: row.id }
    const got = countMatches(items, next)
    if (got !== row.count) {
      console.error('count', field, row.id, row.count, got)
      process.exit(1)
    }
  }
}
const hysteria = facetCounts(items, open, 'protocol').find((row) => row.id === 'hysteria2')
if (!hysteria || hysteria.count !== 2) {
  console.error('hysteria', hysteria)
  process.exit(1)
}
if (countMatches(items, { ...open, protocol: 'hysteria2' }) !== 2) process.exit(1)
const shadowsocks = facetCounts(items, open, 'protocol').find((row) => row.id === 'shadowsocks')
if (!shadowsocks || shadowsocks.count !== 1) process.exit(1)

const narrowed = { ...open, country: 'DE', threshold: 300 }
for (const row of facetCounts(items, narrowed, 'protocol')) {
  if (countMatches(items, { ...narrowed, protocol: row.id }) !== row.count) process.exit(1)
}

const stale = sanitizeListState({
  ...defaultListState(),
  protocol: 'vmess',
  transport: 'mystery',
  security: 'nope',
  country: 'ZZ',
  query: 'alpha',
}, items)
if (stale.protocol || stale.transport || stale.security || stale.country) {
  console.error('stale', stale)
  process.exit(1)
}
if (stale.query !== 'alpha') process.exit(1)
if (countMatches(items, { ...open, query: stale.query }) !== 1) process.exit(1)
const fresh = sanitizeListState({ ...oldList, protocol: 'shadowsocks' }, items)
if (fresh.protocol !== 'shadowsocks' || fresh.transport || fresh.country || fresh.security) process.exit(1)
if (countMatches(items, { ...open, protocol: fresh.protocol }) !== 1) process.exit(1)
"""
    result = subprocess.run(
        [
            "node",
            "--experimental-strip-types",
            "--import",
            "./tests/register-alias.mjs",
            "--input-type=module",
            "-e",
            script,
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr