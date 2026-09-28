const TRANSPORTS: Record<string, string> = {
  tcp: 'TCP',
  ws: 'WS',
  grpc: 'gRPC',
  http: 'HTTP',
  h2: 'HTTP/2',
  quic: 'QUIC',
  httpupgrade: 'HTTPUpgrade',
  xhttp: 'XHTTP',
  kcp: 'mKCP',
}

export function transportLabel(value: string): string {
  return TRANSPORTS[value] ?? value.toUpperCase()
}

export function securityLabel(value: string): string {
  if (!value || value === 'none') return 'Без TLS'
  if (value === 'tls') return 'TLS'
  if (value === 'reality') return 'Reality'
  return value
}

export function protocolLine(transport: string): string {
  return `VLESS / ${transportLabel(transport)}`
}

export function flagEmoji(code: string | null | undefined): string {
  if (!code || !/^[a-z]{2}$/i.test(code)) return ''
  const upper = code.toUpperCase() === 'UK' ? 'GB' : code.toUpperCase()
  return String.fromCodePoint(
    ...[...upper].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65),
  )
}

export function latencyClass(ms: number): string {
  if (ms <= 300) return 'text-success'
  if (ms <= 800) return 'text-warning'
  return 'text-destructive'
}

export function recordDelay(item: { delay_ms?: number | null; latency_ms?: number | null }): number {
  if (typeof item.delay_ms === 'number') return item.delay_ms
  return item.latency_ms ?? 0
}

export function medianNumber(values: number[]): number | null {
  if (values.length === 0) return null
  const ordered = [...values].sort((left, right) => left - right)
  const mid = Math.floor(ordered.length / 2)
  if (ordered.length % 2) return ordered[mid]
  return Math.round((ordered[mid - 1] + ordered[mid]) / 2)
}

export function delayText(item: { delay_ms?: number | null; latency_ms?: number | null; check?: string }): string {
  const value = recordDelay(item)
  return item.check === 'tcp' ? `${value} мс TCP` : `${value} мс`
}

export function formatStamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const day = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
  const time = new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
  return `${day} ${time}`
}

export function configTitle(config: {
  country: string | null
  country_code: string | null
  host: string
}): string {
  if (config.country) return config.country
  if (config.country_code) return config.country_code
  return config.host
}
