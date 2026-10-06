import { ru } from '@/lib/ru'
import type { ConfigRecord } from '@/lib/types'

export const REACH_KEY = 'vless-hub-reach'
export const MANUAL_KEY = 'vless-hub-reach-manual'
export const LOCK_KEY = 'vless-hub-reach-lock'
export const LOCK_NAME = 'vless-hub-reach'
export const CHANNEL_NAME = 'vless-hub-reach'
export const REACH_TIMEOUT_MS = 4000
export const REACH_CONCURRENCY = 3
/**
 * A finished handshake is evidence for this visit, not for the whole afternoon.
 * Twenty minutes sits inside the 15–30 minute window and covers reloads.
 */
export const OPEN_TTL_MS = 20 * 60 * 1000
/**
 * A refusal or a timeout is often a blip. Five minutes stops a reload from
 * repeating hundreds of failures, without hiding a server that just came back.
 */
export const CLOSED_TTL_MS = 5 * 60 * 1000
/** The refresh button may look again, but not on every tap. */
export const MANUAL_GAP_MS = 2 * 60 * 1000
export const STALE_BATCH = 4
export const LOCK_LEASE_MS = 20_000

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

/** A finished fetch or socket, or a failure with how long it took. */
export type ReachSample = {
  elapsedMs: number
  aborted: boolean
  resolved: boolean
  /** True when resource timing shows a finished TLS handshake. Chrome hides this on errors. */
  tlsDone?: boolean
}

/**
 * Extra time a TLS handshake needs versus a refusal on the same host.
 * Loopback refusals are ~1 ms and a certificate error is ~2 ms, so the
 * candidate must be twice as slow. On a real network the refusal is slower
 * and one extra round trip is about 1.75×; anything closer is a refusal,
 * a DNS error, or noise.
 */
export const LOOPBACK_REFUSAL_MS = 3
export const LOOPBACK_HANDSHAKE_FACTOR = 2
export const HANDSHAKE_FACTOR = 1.75
/** A failure slower than this is a stall, not a finished handshake. */
export const HANDSHAKE_CEILING_MS = 1500

/** Two closed-port samples that disagree this much are a name lookup, not a refusal. */
export const STEADY_FACTOR = 1.75

const CONTROL_PORTS = [48123, 39281, 28447]
export const CONTROL_TIMEOUT_MS = 1200

export function controlPorts(servicePort: number): [number, number] {
  const picks = CONTROL_PORTS.filter((port) => port !== servicePort)
  return [picks[0], picks[1]]
}

export function steadyRefusal(samples: ReachSample[], timeoutMs = CONTROL_TIMEOUT_MS): number | null {
  const times = samples
    .filter((sample) => !sample.resolved && !sample.aborted && sample.elapsedMs < timeoutMs - 200 && sample.elapsedMs >= 0)
    .map((sample) => sample.elapsedMs)
  if (times.length === 0) return null
  const fastest = Math.min(...times)
  const slowest = Math.max(...times)
  if (times.length >= 2 && fastest > 0 && slowest > fastest * STEADY_FACTOR) return null
  return Math.max(1, slowest)
}

/** A refusal that takes about as long as a measured DNS failure is not a refusal. */
export function usableRefusal(refusalMs: number | null, dnsMs: number | null): number | null {
  if (refusalMs == null || refusalMs <= 0) return null
  if (dnsMs != null && dnsMs >= 30 && refusalMs >= dnsMs * 0.75 && refusalMs <= dnsMs * 1.35) return null
  return refusalMs
}

export function classifyReach(
  sample: ReachSample,
  refusalMs: number | null,
  timeoutMs = REACH_TIMEOUT_MS,
): ReachStatus {
  if (sample.resolved || sample.tlsDone) return 'open'
  if (sample.aborted || sample.elapsedMs >= timeoutMs - 200 || sample.elapsedMs > HANDSHAKE_CEILING_MS) return 'closed'
  if (refusalMs == null || refusalMs <= 0) return 'closed'
  const factor = refusalMs <= LOOPBACK_REFUSAL_MS ? LOOPBACK_HANDSHAKE_FACTOR : HANDSHAKE_FACTOR
  if (sample.elapsedMs > refusalMs && sample.elapsedMs >= refusalMs * factor) return 'open'
  return 'closed'
}

export function judgeReach(
  service: ReachSample,
  controls: ReachSample[],
  dnsMs: number | null,
  timeoutMs = REACH_TIMEOUT_MS,
): ReachStatus {
  if (service.resolved || service.tlsDone) return 'open'
  if (service.aborted || service.elapsedMs >= timeoutMs - 200) return 'closed'
  if (dnsMs != null && dnsMs >= 30 && service.elapsedMs >= dnsMs * 0.75 && service.elapsedMs <= dnsMs * 1.35) {
    return 'closed'
  }
  return classifyReach(service, usableRefusal(steadyRefusal(controls), dnsMs), timeoutMs)
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

export function probeUrl(host: string, port: number): string {
  const bare = host.trim().replace(/^\[|\]$/g, '')
  const literal = bare.includes(':') ? `[${bare}]` : bare
  return `https://${literal}:${port}/`
}

function socketUrl(host: string, port: number, path?: string): string {
  const bare = host.trim().replace(/^\[|\]$/g, '')
  const literal = bare.includes(':') ? `[${bare}]` : bare
  const suffix = path && path.startsWith('/') ? path : `/${(path || '').replace(/^\/+/, '')}`
  return `wss://${literal}:${port}${suffix}`
}

function wantsSocket(transport?: string): boolean {
  const name = (transport || '').trim().toLowerCase()
  return name === 'ws' || name === 'websocket'
}

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && (error as { name?: string }).name === 'AbortError'
}

function tlsDone(url: string): boolean {
  const entries = performance.getEntriesByType('resource')
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry.name !== url) continue
    const timing = entry as PerformanceResourceTiming
    return timing.secureConnectionStart > 0 && timing.connectEnd >= timing.secureConnectionStart
  }
  return false
}

export async function timedFetch(url: string, timeoutMs: number): Promise<ReachSample> {
  const started = performance.now()
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: controller.signal })
    return { elapsedMs: Math.round(performance.now() - started), aborted: false, resolved: true, tlsDone: true }
  } catch (error) {
    const elapsedMs = Math.round(performance.now() - started)
    return {
      elapsedMs,
      aborted: isAbort(error) || elapsedMs >= timeoutMs - 200,
      resolved: false,
      tlsDone: tlsDone(url),
    }
  } finally {
    window.clearTimeout(timer)
  }
}

function probeSocket(url: string, timeoutMs: number): Promise<ReachSample> {
  return new Promise((resolve) => {
    const started = performance.now()
    let socket: WebSocket
    try {
      socket = new WebSocket(url)
    } catch {
      resolve({ elapsedMs: 0, aborted: false, resolved: false })
      return
    }
    let settled = false
    const finish = (sample: ReachSample) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      try {
        socket.close()
      } catch {
        // The socket is already gone.
      }
      resolve(sample)
    }
    const timer = window.setTimeout(
      () => finish({ elapsedMs: Math.round(performance.now() - started), aborted: true, resolved: false }),
      timeoutMs,
    )
    socket.addEventListener('open', () =>
      finish({ elapsedMs: Math.round(performance.now() - started), aborted: false, resolved: true, tlsDone: true }),
    )
    socket.addEventListener('close', () =>
      finish({ elapsedMs: Math.round(performance.now() - started), aborted: false, resolved: false }),
    )
  })
}

const refusalCache = new Map<string, Promise<number | null>>()
let dnsClock: Promise<number | null> | null = null

async function dnsFailureMs(): Promise<number | null> {
  if (!dnsClock) {
    const nonce = Math.random().toString(36).slice(2)
    dnsClock = Promise.all([
      timedFetch(`https://${nonce}-a.example/`, 2000),
      timedFetch(`https://${nonce}-b.example/`, 2000),
    ]).then(([left, right]) => {
      const times = [left, right].filter((sample) => !sample.aborted && !sample.resolved).map((sample) => sample.elapsedMs)
      if (times.length === 0) return null
      return Math.max(...times)
    })
  }
  return dnsClock
}

function refusalFor(host: string, servicePort: number): Promise<number | null> {
  const key = host.trim().toLowerCase()
  const cached = refusalCache.get(key)
  if (cached) return cached
  const pending = (async () => {
    const [first, second] = controlPorts(servicePort)
    const samples = await Promise.all([
      timedFetch(probeUrl(host, first), CONTROL_TIMEOUT_MS),
      timedFetch(probeUrl(host, second), CONTROL_TIMEOUT_MS),
    ])
    return steadyRefusal(samples)
  })()
  refusalCache.set(key, pending)
  return pending
}

export type ProbeHints = {
  transport?: string
  path?: string
}

export async function probeEndpoint(
  host: string,
  port: number,
  timeoutMs = REACH_TIMEOUT_MS,
  hints?: ProbeHints,
): Promise<ReachHit> {
  if (wantsSocket(hints?.transport)) {
    const socket = await probeSocket(socketUrl(host, port, hints?.path), timeoutMs)
    if (socket.resolved) return { status: 'open', ms: socket.elapsedMs, at: Date.now() }
  }
  const url = probeUrl(host, port)
  const refusalPromise = refusalFor(host, port)
  const dnsPromise = dnsFailureMs()
  const sample = await timedFetch(url, timeoutMs)
  const dnsMs = await dnsPromise
  if (sample.resolved || sample.tlsDone) {
    return { status: 'open', ms: sample.elapsedMs, at: Date.now() }
  }
  if (sample.aborted || sample.elapsedMs >= timeoutMs - 200 || sample.elapsedMs > HANDSHAKE_CEILING_MS) {
    return { status: 'closed', ms: null, at: Date.now() }
  }
  if (dnsMs != null && dnsMs >= 30 && sample.elapsedMs >= dnsMs * 0.75 && sample.elapsedMs <= dnsMs * 1.35) {
    return { status: 'closed', ms: null, at: Date.now() }
  }
  const judged = classifyReach(sample, usableRefusal(await refusalPromise, dnsMs), timeoutMs)
  return { status: judged, ms: judged === 'open' ? sample.elapsedMs : null, at: Date.now() }
}

export type ReachTarget = {
  host: string
  port: number
  protocol?: string
  transport?: string
  path?: string
  country?: string
}

export const MIN_READY = 5
/** Stop once the list has five open addresses and a few spare. */
export const REACH_STOP_AT = MIN_READY + 3
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
    targets.push({
      host: config.host,
      port: config.port,
      protocol: config.protocol,
      transport: config.transport,
      path: config.path,
      country: config.country || undefined,
    })
  }
  return targets
}

export function hitFresh(hit: ReachHit | undefined | null, now: number): boolean {
  if (!hit || typeof hit !== 'object') return false
  if (typeof hit.at !== 'number' || !Number.isFinite(hit.at) || hit.at <= 0) return false
  const ttl = hit.status === 'open' || hit.status === 'skip' ? OPEN_TTL_MS : CLOSED_TTL_MS
  return now - hit.at < ttl
}

export type ReachPlan = {
  splash: boolean
  gate: 'scan' | 'ready' | 'short'
  pending: ReachTarget[]
  freshOpen: number
  freshAny: boolean
}

/**
 * What to show and what to probe.
 * A fresh cache never asks for the splash. Enough open addresses recheck only
 * a handful of expired rows; a short list still looks for more.
 */
export function planReach(targets: ReachTarget[], book: ReachBook, now: number, force = false): ReachPlan {
  const seen = new Set<string>()
  const freshOpenTargets: ReachTarget[] = []
  const freshOther: ReachTarget[] = []
  const stale: ReachTarget[] = []
  const missing: ReachTarget[] = []
  for (const target of targets) {
    if (!target?.host || !target.port) continue
    const key = endpointKey(target.host, target.port)
    if (seen.has(key)) continue
    seen.add(key)
    const hit = book.byEndpoint?.[key]
    if (!hitFresh(hit, now)) {
      if (hit) stale.push(target)
      else missing.push(target)
      continue
    }
    if (hit!.status === 'open') freshOpenTargets.push(target)
    else freshOther.push(target)
  }
  const freshOpen = freshOpenTargets.length
  const freshAny = freshOpen + freshOther.length > 0
  const gate: ReachPlan['gate'] = !freshAny ? 'scan' : freshOpen > 0 ? 'ready' : 'short'
  let pending: ReachTarget[]
  if (force) pending = [...freshOpenTargets, ...freshOther, ...stale, ...missing]
  else if (freshOpen >= REACH_STOP_AT) pending = stale.slice(0, STALE_BATCH)
  else if (freshOpen >= MIN_READY) pending = [...missing, ...stale.slice(0, STALE_BATCH)]
  else pending = [...missing, ...stale]
  return { splash: !freshAny, gate, pending, freshOpen, freshAny }
}

export function gateFromBook(book: ReachBook, now: number): 'idle' | 'ready' | 'short' {
  let opens = 0
  let any = false
  for (const hit of Object.values(book.byEndpoint || {})) {
    if (!hitFresh(hit, now)) continue
    any = true
    if (hit.status === 'open') opens += 1
  }
  if (opens > 0) return 'ready'
  if (any) return 'short'
  return 'idle'
}

export function manualDue(last: number | null, now: number): boolean {
  if (last == null || !Number.isFinite(last) || last <= 0) return true
  return now - last >= MANUAL_GAP_MS
}

export type LockRecord = { owner: string; until: number }

export function parseLock(raw: string | null | undefined): LockRecord | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as LockRecord
    if (!parsed || typeof parsed.owner !== 'string' || typeof parsed.until !== 'number') return null
    if (!Number.isFinite(parsed.until)) return null
    return { owner: parsed.owner, until: parsed.until }
  } catch {
    return null
  }
}

/** True when some other tab still owns the lock. */
export function lockHeld(record: LockRecord | null | undefined, now: number, me: string): boolean {
  if (!record || record.until <= now) return false
  return record.owner !== me
}

export type ProbeMode = 'find' | 'topup' | 'force'
export type ProbeKind = 'find' | 'stale' | 'force'

export function shouldProbeMore(mode: ProbeMode, kind: ProbeKind, freshOpen: number, started: number): boolean {
  if (mode === 'topup') return kind === 'stale'
  if (mode === 'force') return started < REACH_STOP_AT
  return freshOpen < REACH_STOP_AT
}
