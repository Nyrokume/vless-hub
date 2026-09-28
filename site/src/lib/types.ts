export type ConfigRecord = {
  id: string
  uri: string
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
  latency_ms: number
  tested_at: string
}

export type SubscriptionInfo = {
  id: string
  name: string
  description: string
  file: string
  b64: string
  count: number
}

export type SourceReport = {
  id: string
  name: string
  url: string
  ok: boolean
  fetched: number
  error: string | null
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
    countries: number
    median_latency_ms: number | null
    transports: Record<string, number>
  }
  subscriptions: SubscriptionInfo[]
  configs: ConfigRecord[]
}
