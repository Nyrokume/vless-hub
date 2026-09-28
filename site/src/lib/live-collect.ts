import { LIVE_SOURCES } from '@/lib/live-sources'
import { parseProxyDocument, type ParsedProxy } from '@/lib/parse-proxy'

export type LiveSkip = {
  name: string
  reason: string
}

export type LiveProgress = {
  done: number
  total: number
  parsed: number
  unique: number
  fresh: number
  skips: LiveSkip[]
}

export type LiveResult = {
  items: ParsedProxy[]
  parsed: number
  unique: number
  fresh: number
  skips: LiveSkip[]
}

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
  const skips: LiveSkip[] = LIVE_SOURCES.filter((source) => !source.url).map((source) => ({
    name: source.name,
    reason: source.skip || '',
  }))
  const fresh: ParsedProxy[] = []
  const seen = new Set<string>()
  let parsed = 0
  const progress = (): LiveProgress => ({
    done: progressDone,
    total: fetchable.length,
    parsed,
    unique: seen.size,
    fresh: fresh.length,
    skips: skips.slice(),
  })
  let progressDone = 0
  onProgress(progress())
  let cursor = 0
  const workers = Array.from({ length: Math.min(3, fetchable.length) }, async () => {
    while (!signal.aborted) {
      const index = cursor
      cursor += 1
      const source = fetchable[index]
      if (!source?.url) return
      let text: string | null
      try {
        text = await fetchText(`${source.url}${source.url.includes('?') ? '&' : '?'}t=${Date.now()}`, signal)
      } catch {
        return
      }
      if (text == null) skips.push({ name: source.name, reason: '' })
      else {
        const rows = await parseProxyDocument(text)
        parsed += rows.length
        for (const item of rows) {
          if (!item.id || seen.has(item.id)) continue
          seen.add(item.id)
          if (known.has(item.id)) continue
          fresh.push({ ...item, source: source.name })
        }
      }
      progressDone += 1
      onProgress(progress())
    }
  })
  try {
    await Promise.all(workers)
  } catch {
    // The caller aborted the run. Keep whatever was already unique.
  }
  return { items: fresh, parsed, unique: seen.size, fresh: fresh.length, skips }
}
