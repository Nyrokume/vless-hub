import { ru } from '@/lib/ru'
import type { ConfigRecord } from '@/lib/types'

export const REACH_KEY = 'vless-hub-reach'
export const REACH_TIMEOUT_MS = 4000
export const REACH_CONCURRENCY = 6

export type ReachStatus = 'open' | 'closed' | 'skip'

export type ReachHit = {
  status: ReachStatus
  ms: number | null
  at: number
}

export type ReachBook = {
  at: number
  byEndpoint: Record<string, ReachHit>
}

export function endpointKey(host: string, port: number): string {
  return `${host.trim().toLowerCase()}:${port}`
}

export function browserCanProbe(protocol: string | null | undefined): boolean {
  const name = (protocol || 'vless').trim().toLowerCase()
  return name !== 'hysteria2' && name !== 'hy2' && name !== 'tuic'
}

export function classifyReach(elapsedMs: number, aborted: boolean, timeoutMs = REACH_TIMEOUT_MS): ReachStatus {
  if (aborted || elapsedMs >= timeoutMs - 200) return 'closed'
  return 'open'
}

export function emptyBook(): ReachBook {
  return { at: 0, byEndpoint: {} }
}

export function loadReach(): ReachBook {
  try {
    const raw = localStorage.getItem(REACH_KEY)
    if (!raw) return emptyBook()
    const parsed = JSON.parse(raw) as ReachBook
    if (!parsed || typeof parsed !== 'object' || !parsed.byEndpoint) return emptyBook()
    return { at: Number(parsed.at) || 0, byEndpoint: parsed.byEndpoint }
  } catch {
    return emptyBook()
  }
}

export function saveReach(book: ReachBook): void {
  try {
    localStorage.setItem(REACH_KEY, JSON.stringify(book))
  } catch {
    // The phone can refuse storage. The marks still stay for this visit.
  }
}

export function reachLine(hit: ReachHit | undefined): string {
  if (!hit) return ''
  if (hit.status === 'skip') return ru.reachSkip
  if (hit.status === 'open') return hit.ms != null ? `${ru.reachOpen} · ${hit.ms} мс` : ru.reachOpen
  return ru.reachClosed
}

function probeUrl(host: string, port: number): string {
  const bare = host.trim().replace(/^\[|\]$/g, '')
  const literal = bare.includes(':') ? `[${bare}]` : bare
  return `https://${literal}:${port}/`
}

export async function probeEndpoint(host: string, port: number, timeoutMs = REACH_TIMEOUT_MS): Promise<ReachHit> {
  const started = performance.now()
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    await fetch(probeUrl(host, port), { mode: 'no-cors', cache: 'no-store', signal: controller.signal })
    return { status: 'open', ms: Math.round(performance.now() - started), at: Date.now() }
  } catch (error) {
    const elapsed = Math.round(performance.now() - started)
    const aborted =
      typeof error === 'object' && error !== null && 'name' in error && (error as { name?: string }).name === 'AbortError'
    return {
      status: classifyReach(elapsed, aborted, timeoutMs),
      ms: aborted ? null : elapsed,
      at: Date.now(),
    }
  } finally {
    window.clearTimeout(timer)
  }
}

export type ReachTarget = {
  host: string
  port: number
  protocol?: string
}

export const MIN_READY = 5
export const CORE_PASSES = 3

export function passStreak(bits: string | null | undefined): number {
  const value = bits || ''
  let streak = 0
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (value[index] !== '1') break
    streak += 1
  }
  return streak
}

export function isCore(bits: string | null | undefined): boolean {
  return passStreak(bits) >= CORE_PASSES
}

/** Browser-checkable configs, stable core first, then the quicker measured ones. */
export function orderForProbe(configs: ConfigRecord[]): ConfigRecord[] {
  return configs
    .filter((config) => config.host && config.port && browserCanProbe(config.protocol))
    .slice()
    .sort((left, right) => {
      const core = Number(isCore(right.bits)) - Number(isCore(left.bits))
      if (core !== 0) return core
      return (left.latency_ms ?? 9_999_999) - (right.latency_ms ?? 9_999_999)
    })
}

export function targetsFrom(configs: ConfigRecord[]): ReachTarget[] {
  const seen = new Set<string>()
  const targets: ReachTarget[] = []
  for (const config of configs) {
    if (!config.host || !config.port) continue
    const key = endpointKey(config.host, config.port)
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({ host: config.host, port: config.port, protocol: config.protocol })
  }
  return targets
}
