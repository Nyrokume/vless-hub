import { orderForProbe } from '../site/src/lib/reach.ts'

function row(host, extra) {
  return {
    id: host,
    uri: `vless://x@${host}:443`,
    remark: '',
    uuid: '11111111-1111-4111-8111-111111111111',
    host,
    port: 443,
    transport: 'tcp',
    security: 'none',
    sni: '',
    flow: '',
    path: '',
    host_header: '',
    service_name: '',
    fingerprint: '',
    country_code: null,
    country: null,
    country_source: null,
    ip_country_code: null,
    ip_country: null,
    extra: {},
    source: '',
    latency_ms: 100,
    tested_at: '',
    protocol: 'vless',
    bits: '1',
    vantage: '',
    ...extra,
  }
}

const fastCore = row('fast.example', { bits: '111', latency_ms: 40, security: 'none' })
const russia = row('ru.example', { security: 'reality', vantage: 'ru', bits: '1', latency_ms: 800 })
const hy2 = row('hy2.example', { protocol: 'hysteria2', latency_ms: 10, bits: '111' })
const ordered = orderForProbe([fastCore, hy2, russia])
if (ordered.map((item) => item.host).join(',') !== 'ru.example,fast.example') {
  console.error(ordered.map((item) => item.host))
  process.exit(1)
}
