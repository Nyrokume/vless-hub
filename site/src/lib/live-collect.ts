import { LIVE_SOURCES } from '@/lib/live-sources'
import { parseProxyDocument, type ParsedProxy } from '@/lib/parse-proxy'

export type LiveProgress = {
  done: number
  total: number
  skipped: number
  parsed: number
  fresh: number
}

async function fetchText(url: string, signal: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch(url, { signal, cache: 'no-store', mode: 'cors' })
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  }
}

export async function collectFresh(
  known: Set<string>,
  onProgress: (progress: LiveProgress) => void,
  signal: AbortSignal,
): Promise<ParsedProxy[]> {
  const fetchable = LIVE_SOURCES.filter((source) => source.url)
  const skippedKnown = LIVE_SOURCES.length - fetchable.length
  const fresh: ParsedProxy[] = []
  const seen = new Set<string>()
  const progress: LiveProgress = {
    done: 0,
    total: fetchable.length,
    skipped: skippedKnown,
    parsed: 0,
    fresh: 0,
  }
  onProgress({ ...progress })
  let cursor = 0
  const workers = Array.from({ length: Math.min(3, fetchable.length) }, async () => {
    while (!signal.aborted) {
      const index = cursor
      cursor += 1
      const source = fetchable[index]
      if (!source?.url) return
      const text = await fetchText(`${source.url}${source.url.includes('?') ? '&' : '?'}t=${Date.now()}`, signal)
      if (text == null) progress.skipped += 1
      else {
        const parsed = await parseProxyDocument(text)
        progress.parsed += parsed.length
        for (const item of parsed) {
          if (known.has(item.id) || seen.has(item.id)) continue
          seen.add(item.id)
          fresh.push(item)
        }
        progress.fresh = fresh.length
      }
      progress.done += 1
      onProgress({ ...progress })
    }
  })
  await Promise.all(workers)
  return fresh
}
