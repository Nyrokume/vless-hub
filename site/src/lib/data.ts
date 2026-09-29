import { ru } from '@/lib/ru'
import type { ConfigRecord, HubData } from '@/lib/types'

function freshUrl(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/')
  return `${base}${path}?t=${Date.now()}`
}

const freshInit: RequestInit = {
  cache: 'no-store',
  headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
}

export async function loadVersion(): Promise<string> {
  const response = await fetch(freshUrl('data/version.json'), freshInit)
  if (!response.ok) throw new Error(`${ru.loadFailed} (${response.status})`)
  const data = (await response.json()) as { generated_at?: string }
  if (!data?.generated_at) throw new Error(ru.dataBroken)
  return data.generated_at
}

export async function loadHub(bust = false): Promise<HubData> {
  const url = bust ? freshUrl('data/configs.json') : `${import.meta.env.BASE_URL}data/configs.json`
  const response = await fetch(url, bust ? freshInit : { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`${ru.loadFailed} (${response.status})`)
  }
  const data = (await response.json()) as HubData
  if (!data || !Array.isArray(data.configs) || !Array.isArray(data.subscriptions)) {
    throw new Error(ru.dataBroken)
  }
  data.catalog ??= []
  data.unstable ??= []
  data.unverified ??= []
  data.proxies ??= []
  data.unstable_proxies ??= []
  data.stats ??= {
    fetched: 0,
    unique: 0,
    tested: 0,
    alive: 0,
    published: data.configs.length,
    countries: 0,
    median_latency_ms: null,
    transports: {},
  }
  return data
}

export function publicFileUrl(publicBase: string, path: string): string {
  const base = publicBase.replace(/\/+$/, '')
  return `${base}/${path.replace(/^\/+/, '')}`
}

export function subscriptionUrl(publicBase: string, file: string): string {
  const base = publicBase.replace(/\/+$/, '')
  return `${base}/data/${file.replace(/^\/+/, '')}`
}

export function membersOf(subId: string, configs: ConfigRecord[], fastMs: number): ConfigRecord[] {
  if (subId === 'all') return configs
  if (subId === 'fast') {
    return configs.filter((item) => item.latency_ms != null && item.latency_ms <= fastMs)
  }
  if (subId === 'reality' || subId === 'tls') {
    return configs.filter((item) => item.security === subId)
  }
  return configs.filter((item) => item.transport === subId)
}
