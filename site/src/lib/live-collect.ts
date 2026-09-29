import { countryName, flagCode, latencyBounds } from '@/lib/format'
import { LIVE_SOURCES } from '@/lib/live-sources'
import { parseProxyDocument, type ParsedProxy } from '@/lib/parse-proxy'
import { ru } from '@/lib/ru'

export type LiveLine = {
  name: string
  ok: boolean
  count: number
  error: string
}

export type LiveStage = 'download' | 'parse'

export type LiveProgress = {
  stage: LiveStage
  done: number
  total: number
  lines: LiveLine[]
}

export type LiveItem = ParsedProxy & { fresh: boolean }

export type LiveResult = {
  items: LiveItem[]
  lines: LiveLine[]
}

export type LiveGroup = {
  code: string
  name: string
  items: LiveItem[]
  min: number | null
  max: number | null
}

const POOL = 4

/** Collapse repeats of one fingerprint, then drop configs already in the published list. */
export function splitFresh(items: ParsedProxy[], known: Set<string>): { unique: ParsedProxy[]; fresh: ParsedProxy[] } {
  const seen = new Set<string>()
  const unique: ParsedProxy[] = []
  const fresh: ParsedProxy[] = []
  for (const item of items) {
    if (!item.id || seen.has(item.id)) continue
    seen.add(item.id)
    unique.push(item)
    if (!known.has(item.id)) fresh.push(item)
  }
  return { unique, fresh }
}

export function endpointIdentity(host: string, port: number, uuid: string): string {
  return `${host.trim().toLowerCase()}|${port}|${uuid.trim()}`
}

/** Subscription text may contain only links that already passed the server check. */
export function verifiedUris(
  items: { host: string; port: number; uuid: string }[],
  configs: { host: string; port: number; uuid: string; uri: string }[],
): string[] {
  const byUri = new Map(configs.map((config) => [endpointIdentity(config.host, config.port, config.uuid), config.uri]))
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const uri = byUri.get(endpointIdentity(item.host, item.port, item.uuid))
    if (!uri || seen.has(uri)) continue
    seen.add(uri)
    out.push(uri)
  }
  return out
}

export function groupLive(items: LiveItem[], pingOf: (item: LiveItem) => number | null): LiveGroup[] {
  const map = new Map<string, LiveItem[]>()
  for (const item of items) {
    const code = flagCode(item.remark) || 'ZZ'
    const list = map.get(code)
    if (list) list.push(item)
    else map.set(code, [item])
  }
  const groups: LiveGroup[] = []
  for (const [code, rows] of map) {
    rows.sort((left, right) => {
      const a = pingOf(left)
      const b = pingOf(right)
      if (a == null && b == null) return left.host.localeCompare(right.host) || left.port - right.port
      if (a == null) return 1
      if (b == null) return -1
      return a - b || left.host.localeCompare(right.host)
    })
    const bounds = latencyBounds(rows.map((item) => pingOf(item)))
    groups.push({
      code,
      name: code === 'ZZ' ? ru.noCountry : countryName(code) || code,
      items: rows,
      min: bounds.min,
      max: bounds.max,
    })
  }
  groups.sort((left, right) => {
    if (left.min == null && right.min == null) return left.name.localeCompare(right.name, 'ru')
    if (left.min == null) return 1
    if (right.min == null) return -1
    return left.min - right.min || left.name.localeCompare(right.name, 'ru')
  })
  return groups
}

async function fetchText(url: string, signal: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch(url, { signal, cache: 'no-store', mode: 'cors' })
    if (!response.ok) return null
    return await response.text()
  } catch (error) {
    if (signal.aborted) throw error
    return null
  }
}

export async function collectFresh(
  known: Set<string>,
  onProgress: (progress: LiveProgress) => void,
  signal: AbortSignal,
): Promise<LiveResult> {
  const fetchable = LIVE_SOURCES.filter((source) => source.url)
  const lines: LiveLine[] = LIVE_SOURCES.filter((source) => !source.url).map((source) => ({
    name: source.name,
    ok: false,
    count: 0,
    error: source.skip || ru.live.skipClosed,
  }))
  const report = (stage: LiveStage, done: number, total: number) => {
    onProgress({ stage, done, total, lines: lines.slice() })
  }
  if (fetchable.length === 0) {
    report('parse', 0, 0)
    return { items: [], lines }
  }
  report('download', 0, fetchable.length)

  const blobs: Array<{ name: string; text: string | null } | undefined> = new Array(fetchable.length)
  let done = 0
  let cursor = 0
  const workers = Array.from({ length: Math.min(POOL, fetchable.length) }, async () => {
    for (;;) {
      if (signal.aborted) return
      const index = cursor
      cursor += 1
      const source = fetchable[index]
      if (!source?.url) return
      let text: string | null = null
      try {
        text = await fetchText(`${source.url}${source.url.includes('?') ? '&' : '?'}t=${Date.now()}`, signal)
      } catch {
        return
      }
      blobs[index] = { name: source.name, text }
      if (text == null) lines.push({ name: source.name, ok: false, count: 0, error: ru.live.skipClosed })
      done += 1
      report('download', done, fetchable.length)
    }
  })
  try {
    await Promise.all(workers)
  } catch {
    // Aborted. Parse whatever already arrived.
  }

  const ready = blobs.filter((blob): blob is { name: string; text: string | null } => Boolean(blob))
  report('parse', 0, ready.length)
  const seen = new Set<string>()
  const items: LiveItem[] = []
  let parsed = 0
  for (const blob of ready) {
    if (signal.aborted) break
    if (blob.text) {
      const rows = await parseProxyDocument(blob.text)
      let kept = 0
      for (const item of rows) {
        if (!item.id || seen.has(item.id)) continue
        seen.add(item.id)
        kept += 1
        items.push({ ...item, source: blob.name, fresh: !known.has(item.id) })
      }
      lines.push({ name: blob.name, ok: true, count: kept, error: '' })
    }
    parsed += 1
    report('parse', parsed, ready.length)
  }
  return { items, lines }
}
