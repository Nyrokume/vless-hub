import { reasonLabel, statusLabel } from '@/lib/ru'

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
  hysteria2: 'Hysteria2',
  hy2: 'Hysteria2',
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

export function protocolLabel(protocol: string | undefined): string {
  const key = (protocol || 'vless').toLowerCase()
  if (key === 'shadowsocks' || key === 'ss') return 'SS'
  if (key === 'trojan') return 'Trojan'
  if (key === 'hysteria2' || key === 'hy2') return 'Hysteria2'
  if (key === 'vless') return 'VLESS'
  return key.toUpperCase()
}

/** Transport adds nothing when it is empty or the same thing as the protocol. */
export function distinctTransport(transport: string, protocol?: string): string | null {
  const raw = (transport || '').trim()
  if (!raw) return null
  const proto = protocolLabel(protocol)
  const via = transportLabel(raw)
  const left = (protocol || 'vless').toLowerCase()
  const right = raw.toLowerCase()
  if (left === right || proto.toLowerCase() === via.toLowerCase()) return null
  if ((left === 'hysteria2' && right === 'hy2') || (left === 'hy2' && right === 'hysteria2')) return null
  return via
}

export function protocolLine(transport: string, protocol?: string): string {
  const proto = protocolLabel(protocol)
  const via = distinctTransport(transport, protocol)
  return via ? `${proto} / ${via}` : proto
}

export function stabilityText(rate: number | null | undefined): string {
  if (rate == null || Number.isNaN(rate)) return ''
  return `${Math.round(rate * 100)}%`
}

export function speedText(kbps: number | null | undefined): string {
  if (kbps == null || kbps <= 0) return ''
  if (kbps >= 1024) return `${(kbps / 1024).toFixed(1)} МБ/с`
  return `${Math.round(kbps)} КБ/с`
}

export const FAILURE_LABELS: Record<string, string> = {
  parse_error: reasonLabel('parse_error'),
  invalid_field: reasonLabel('invalid_field'),
  tcp_refused: reasonLabel('tcp_refused'),
  timeout: reasonLabel('timeout'),
  tls_fail: reasonLabel('tls_fail'),
  reality_fail: reasonLabel('reality_fail'),
  handshake_fail: reasonLabel('handshake_fail'),
  http_fail: reasonLabel('http_fail'),
  no_data: reasonLabel('no_data'),
  exit_ip_leak: reasonLabel('exit_ip_leak'),
  mtproto_fail: reasonLabel('mtproto_fail'),
  socks_fail: reasonLabel('socks_fail'),
  dead: reasonLabel('dead'),
}

export { reasonLabel, statusLabel }

export function flagCode(text: string | null | undefined): string {
  let letters = ''
  for (const char of text || '') {
    const code = char.codePointAt(0) ?? 0
    if (code >= 0x1f1e6 && code <= 0x1f1ff) {
      letters += String.fromCharCode(code - 0x1f1e6 + 65)
      if (letters.length === 2) return letters === 'UK' ? 'GB' : letters
    } else if (letters) {
      letters = ''
    }
  }
  return ''
}

export function countryName(code: string | null | undefined): string {
  if (!code || !/^[a-z]{2}$/i.test(code)) return ''
  const upper = code.toUpperCase() === 'UK' ? 'GB' : code.toUpperCase()
  try {
    return new Intl.DisplayNames(['ru'], { type: 'region' }).of(upper) || upper
  } catch {
    return upper
  }
}

export function flagEmoji(code: string | null | undefined): string {
  if (!code || !/^[a-z]{2}$/i.test(code)) return ''
  const upper = code.toUpperCase() === 'UK' ? 'GB' : code.toUpperCase()
  return String.fromCodePoint(
    ...[...upper].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65),
  )
}

/** Displayed ping: green below fast, yellow through slow, red above. */
export const LATENCY_BANDS = { fast: 300, slow: 800 } as const

export function latencyClass(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return 'text-muted-foreground'
  const whole = Math.round(ms)
  if (whole < LATENCY_BANDS.fast) return 'text-latency-fast'
  if (whole <= LATENCY_BANDS.slow) return 'text-latency-mid'
  return 'text-latency-slow'
}

export function latencyText(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return '—'
  return `${Math.round(ms)} мс`
}

/** Working pings when any exist, otherwise every finite ping in the list. */
export function displayedLatencyBounds(
  items: Array<{ status?: string | null; latency_ms: number | null | undefined }>,
): { min: number | null; max: number | null } {
  const working = items.map((item) => {
    if (item.status && item.status !== 'working') return null
    if (item.latency_ms == null || Number.isNaN(item.latency_ms)) return null
    return item.latency_ms
  })
  return latencyBounds(working.some((value) => value != null) ? working : items.map((item) => item.latency_ms))
}

export function latencyBounds(values: Array<number | null | undefined>): { min: number | null; max: number | null } {
  let min: number | null = null
  let max: number | null = null
  for (const value of values) {
    if (value == null || Number.isNaN(value)) continue
    if (min == null || value < min) min = value
    if (max == null || value > max) max = value
  }
  return { min, max }
}

/** One number when the country has a single whole-millisecond ping, otherwise min ~ max. */
export function latencyRange(
  min: number | null,
  max: number | null,
): { kind: 'empty' } | { kind: 'single'; ms: number } | { kind: 'range'; min: number; max: number } {
  if (min == null || max == null || Number.isNaN(min) || Number.isNaN(max)) return { kind: 'empty' }
  if (Math.round(min) === Math.round(max)) return { kind: 'single', ms: min }
  return { kind: 'range', min, max }
}

export function uptimeText(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return ''
  return `${Math.round(value * 100)}%`
}

export function checkedAge(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const minutes = Math.max(0, Math.round((now - then) / 60000))
  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} ч назад`
  return `${Math.floor(hours / 24)} дн назад`
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
