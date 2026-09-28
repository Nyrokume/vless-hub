const WORKFLOW_RUNS =
  'https://api.github.com/repos/Nyrokume/vless-hub/actions/workflows/update.yml/runs?per_page=1'

export const WORKFLOW_PAGE = 'https://github.com/Nyrokume/vless-hub/actions/workflows/update.yml'

const CACHE_KEY = 'v2hub-workflow-run'
const CACHE_MS = 10 * 60 * 1000

export type RunStatus = 'success' | 'failure' | 'running' | 'unknown'

export type CollectorRun = {
  at: string | null
  status: RunStatus
  source: 'github' | 'data'
}

type CacheEntry = {
  savedAt: number
  run: CollectorRun
}

export function nextScheduledRun(now = new Date()): Date {
  const cursor = new Date(now.getTime())
  cursor.setUTCSeconds(0, 0)
  cursor.setUTCMilliseconds(0)
  for (let step = 0; step < 24 * 60; step += 1) {
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1)
    if (cursor.getUTCMinutes() === 17 && cursor.getUTCHours() % 3 === 0) return cursor
  }
  return cursor
}

export function runStatusLabel(status: RunStatus): string {
  if (status === 'success') return 'успешно'
  if (status === 'failure') return 'ошибка'
  if (status === 'running') return 'выполняется'
  return 'нет статуса'
}

function mapStatus(status: unknown, conclusion: unknown): RunStatus {
  if (status === 'in_progress' || status === 'queued' || status === 'waiting' || status === 'pending' || status === 'requested') {
    return 'running'
  }
  if (conclusion === 'success') return 'success'
  if (conclusion === 'failure' || conclusion === 'timed_out' || conclusion === 'startup_failure') return 'failure'
  return 'unknown'
}

function readCache(): CollectorRun | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheEntry
    if (!parsed?.run || Date.now() - parsed.savedAt > CACHE_MS) return null
    return parsed.run
  } catch {
    return null
  }
}

function writeCache(run: CollectorRun) {
  try {
    const entry: CacheEntry = { savedAt: Date.now(), run }
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry))
  } catch {
    // Private mode can reject sessionStorage. The screen still shows the fallback.
  }
}

export async function loadCollectorRun(fallbackIso: string | null): Promise<CollectorRun> {
  const cached = readCache()
  if (cached) return cached
  const fallback: CollectorRun = { at: fallbackIso, status: 'unknown', source: 'data' }
  try {
    const response = await fetch(WORKFLOW_RUNS, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!response.ok) {
      writeCache(fallback)
      return fallback
    }
    const body = (await response.json()) as {
      workflow_runs?: { status?: string; conclusion?: string | null; run_started_at?: string; created_at?: string; updated_at?: string }[]
    }
    const run = body.workflow_runs?.[0]
    if (!run) {
      writeCache(fallback)
      return fallback
    }
    const result: CollectorRun = {
      at: run.run_started_at || run.updated_at || run.created_at || fallbackIso,
      status: mapStatus(run.status, run.conclusion),
      source: 'github',
    }
    writeCache(result)
    return result
  } catch {
    return fallback
  }
}
