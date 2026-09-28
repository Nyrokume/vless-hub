import { ru } from '@/lib/ru'
import type { ConfigRecord, HubData } from '@/lib/types'

export async function loadHub(bust = false): Promise<HubData> {
  const stamp = bust ? `?t=${Date.now()}` : ''
  const url = `${import.meta.env.BASE_URL}data/configs.json${stamp}`
  const response = await fetch(url, { cache: 'no-store' })
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
