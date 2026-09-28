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
  if (ms <= 600) return 'text-warning'
  return 'text-destructive'
}

export function formatElapsed(fromIso: string, now: number): string {
  const start = Date.parse(fromIso)
  if (Number.isNaN(start)) return '-- : -- : --'
  const total = Math.max(0, Math.floor((now - start) / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(hours)} : ${pad(minutes)} : ${pad(seconds)}`
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
