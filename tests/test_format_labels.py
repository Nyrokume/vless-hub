import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_redundant_transport_is_not_repeated():
    script = r"""
import { distinctTransport, latencyBounds, latencyRange, protocolLabel, protocolLine, transportLabel } from './site/src/lib/format.ts'
import { groupLive, splitFresh, verifiedUris } from './site/src/lib/live-collect.ts'
import { parseProxy } from './site/src/lib/parse-proxy.ts'

const cases = [
  ['hysteria2', 'hysteria2', 'Hysteria2'],
  ['hy2', 'hysteria2', 'Hysteria2'],
  ['hysteria2', 'hy2', 'Hysteria2'],
  ['tcp', 'vless', 'VLESS / TCP'],
  ['ws', 'trojan', 'Trojan / WS'],
  ['tcp', 'shadowsocks', 'SS / TCP'],
  ['', 'vless', 'VLESS'],
]
for (const [transport, protocol, expect] of cases) {
  const line = protocolLine(transport, protocol)
  if (line !== expect) {
    console.error('line', transport, protocol, line, expect)
    process.exit(1)
  }
}
if (distinctTransport('hysteria2', 'hysteria2') !== null) process.exit(1)
if (distinctTransport('ws', 'vless') !== 'WS') process.exit(1)
if (protocolLabel('hysteria2') !== 'Hysteria2') process.exit(1)
if (transportLabel('hysteria2') !== 'Hysteria2') process.exit(1)
if (protocolLine('hysteria2', 'hysteria2').includes('/')) process.exit(1)

const bounds = latencyBounds([1805.4, null, 289.2, Number.NaN])
if (Math.round(bounds.min) !== 289 || Math.round(bounds.max) !== 1805) process.exit(1)
const one = latencyRange(319.9, 319.9)
if (one.kind !== 'single') process.exit(1)
const span = latencyRange(114.2, 2752.6)
if (span.kind !== 'range' || Math.round(span.min) !== 114 || Math.round(span.max) !== 2753) process.exit(1)
if (latencyRange(null, 10).kind !== 'empty') process.exit(1)
if (latencyBounds([]).min !== null) process.exit(1)

const nl = String.fromCharCode(10)
const prettyBody = '{' + nl + '  "b": 2,' + nl + '  "a": 1' + nl + '}'
const pretty = await parseProxy('vless://11111111-1111-4111-8111-111111111111@1.2.3.4:443?type=tcp&security=none&extra=' + encodeURIComponent(prettyBody) + '#y')
const compact = await parseProxy('vless://11111111-1111-4111-8111-111111111111@1.2.3.4:443?type=tcp&security=none&extra=' + encodeURIComponent('{"a":1,"b":2}') + '#x')
if (!pretty || !compact || pretty.id !== compact.id) {
  console.error('extra', pretty && pretty.id, compact && compact.id)
  process.exit(1)
}
const noted = await parseProxy('vless://11111111-1111-4111-8111-111111111111@1.2.3.4:443?type=ws&security=tls&sni=example.com&note=hello#x')
if (!noted || noted.network !== 'ws') process.exit(1)
const split = splitFresh(
  [pretty, { ...pretty, remark: 'other' }, compact, { ...noted, id: 'published' }],
  new Set(['published']),
)
if (split.unique.length !== 2 || split.fresh.length !== 1 || split.fresh[0].id !== pretty.id) {
  console.error('split', split.unique.length, split.fresh.length)
  process.exit(1)
}
function liveItem(host, remark, id) {
  return {
    id,
    uri: 'vless://' + id,
    protocol: 'vless',
    host,
    port: 443,
    network: 'tcp',
    security: 'none',
    remark,
    uuid: id,
    sni: '',
    flow: '',
    path: '',
    hostHeader: '',
    serviceName: '',
    fp: '',
    fresh: true,
  }
}
const slow = liveItem('slow.example', '🇺🇸 slow', 'slow')
const fast = liveItem('fast.example', '🇩🇪 fast', 'fast')
const plain = liveItem('plain.example', 'no flag', 'plain')
const pings = { 'fast.example:443': 51, 'slow.example:443': 900 }
const grouped = groupLive([slow, plain, fast], (item) => pings[item.host + ':' + item.port] ?? null)
if (grouped[0].code !== 'DE' || grouped[0].min !== 51) {
  console.error('group order', grouped.map((group) => group.code + ':' + group.min).join(','))
  process.exit(1)
}
if (grouped[1].code !== 'US' || grouped[2].code !== 'ZZ') process.exit(1)
if (grouped[0].max !== 51 || grouped[1].min !== 900) process.exit(1)
const catalog = [
  { host: 'fast.example', port: 443, uuid: 'fast', uri: 'vless://catalog-fast' },
]
const exported = verifiedUris([fast, slow], catalog)
if (exported.length !== 1 || exported[0] !== 'vless://catalog-fast') {
  console.error('verified export', exported)
  process.exit(1)
}
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
