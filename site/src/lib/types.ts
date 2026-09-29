export type ConfigRecord = {
  id: string
  uri: string
  protocol?: string
  encryption?: string
  remark: string
  uuid: string
  host: string
  port: number
  transport: string
  security: string
  sni: string
  flow: string
  path: string
  host_header: string
  service_name: string
  fingerprint: string
  country_code: string | null
  country: string | null
  country_source: 'remark' | 'geoip' | null
  ip_country_code: string | null
  ip_country: string | null
  extra: Record<string, string>
  source: string
  latency_ms: number | null
  handshake_ms?: number | null
  status?: 'working' | 'unstable' | 'dead' | string
  stability?: number | null
  exit_ip?: string
  tested_at: string
  uptime?: number
  checks_ok?: number
  checks_fail?: number
  bits?: string
  verified?: string
  speed_kbps?: number | null
  core?: string
  vantage?: string
}

export type SubscriptionInfo = {
  id: string
  name: string
  description: string
  file: string
  b64: string
  count: number
}

export type CatalogEntry = {
  path: string
  kind: string
  format: string
  count: number
  country?: string
  security?: string
  network?: string
  protocol?: string
  top?: number | null
}

export type SourceReport = {
  id: string
  name: string
  url: string
  ok: boolean
  fetched: number
  kept?: number
  tested?: number
  verified?: number
  yield?: number | null
  deprioritized?: boolean
  disabled?: boolean
  error: string | null
}

export type TelegramStats = {
  collected: number
  tested: number
  published: number
  mtproto: number
  socks: number
  median_latency_ms: number | null
}

export type ProxyRecord = {
  id: string
  kind: 'mtproto' | 'socks' | string
  host: string
  port: number
  secret: string
  mode: string
  domain: string
  user: string
  country: string
  country_name: string
  ip?: string
  latency_ms: number | null
  status?: 'working' | 'unstable' | 'dead' | string
  stability?: number | null
  uptime: number
  checks_ok: number
  checks_fail: number
  bits: string
  tg: string
  https: string
  sources: string[]
}

export type HubData = {
  version: number
  collector_version: string
  generated_at: string
  duration_sec: number
  probe: string
  fast_threshold_ms: number
  sources: SourceReport[]
  stats: {
    fetched: number
    unique: number
    tested: number
    alive: number
    published: number
    working?: number
    unstable?: number
    countries: number
    median_latency_ms: number | null
    transports: Record<string, number>
    unverified?: number
    proxy_tested?: number
    proxy_ok?: number
    rejected?: Record<string, number>
    by_protocol?: Record<string, number>
    telegram?: TelegramStats
  }
  subscriptions: SubscriptionInfo[]
  catalog: CatalogEntry[]
  configs: ConfigRecord[]
  unstable?: ConfigRecord[]
  unverified: ConfigRecord[]
  proxies: ProxyRecord[]
  unstable_proxies?: ProxyRecord[]
}
