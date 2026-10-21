import { LATENCY_BANDS } from '@/lib/format'
import type { ConfigRecord } from '@/lib/types'

/**
 * Server status comes from the checker in GitHub Actions, not from the browser.
 * The page used to knock on https://<ip>:<port> itself; that never proved a
 * VLESS server works and filled the console with ERR_* lines. Now every entry
 * of configs.json carries checked_at, latency_ms and stage, and this module
 * only reads them. Older data without those fields falls back to status and
 * tested_at.
 */

export type ServerStage = 'ok' | 'tcp_fail' | 'handshake_fail' | 'http_fail'
export type ServerTier = 'fast' | 'ok' | 'slow' | 'up' | 'down' | 'unknown'

export type StatusFields = {
  checked_at?: string | null
  stage?: ServerStage | string | null
}

export type ServerStatus = {
  tier: ServerTier
  alive: boolean
  ms: number | null
  /** Short words for the row. Empty when there is nothing to say. */
  label: string
  /** One calm sentence for the details sheet. */
  hint: string
  checkedAt: string | null
}

const STAGE_TEXT: Record<Exclude<ServerStage, 'ok'>, { label: string; hint: string }> = {
  tcp_fail: { label: 'Не отвечает', hint: 'Сервер не ответил при последней проверке. Возможно, он выключен.' },
  handshake_fail: { label: 'Не пускает', hint: 'Сервер отвечает, но подключиться к нему не удалось.' },
  http_fail: { label: 'Сайты не открываются', hint: 'Подключение есть, но через него не открылись сайты.' },
}

export function tierFor(ms: number | null): ServerTier {
  if (ms == null || !Number.isFinite(ms)) return 'up'
  const whole = Math.round(ms)
  if (whole < LATENCY_BANDS.fast) return 'fast'
  if (whole <= LATENCY_BANDS.slow) return 'ok'
  return 'slow'
}

const TIER_TEXT: Record<'fast' | 'ok' | 'slow' | 'up', string> = {
  fast: 'Быстрый',
  ok: 'Нормальный',
  slow: 'Медленный',
  up: 'Работает',
}

export function serverStatus(config: ConfigRecord): ServerStatus {
  const extra = config as ConfigRecord & StatusFields
  const checkedAt = extra.checked_at || config.tested_at || null
  const ms = typeof config.latency_ms === 'number' && Number.isFinite(config.latency_ms) ? config.latency_ms : null
  const stage = typeof extra.stage === 'string' ? extra.stage : null

  if (stage && stage !== 'ok') {
    const text = STAGE_TEXT[stage as Exclude<ServerStage, 'ok'>] ?? {
      label: 'Не работает',
      hint: 'Последняя проверка не прошла.',
    }
    return { tier: 'down', alive: false, ms: null, ...text, checkedAt }
  }
  if (!stage && config.status === 'dead') {
    return { tier: 'down', alive: false, ms: null, label: 'Не работает', hint: 'Последняя проверка не прошла.', checkedAt }
  }
  if (!stage && !config.status && ms == null) {
    return { tier: 'unknown', alive: true, ms: null, label: '', hint: 'Сервер ещё не проверяли.', checkedAt }
  }
  const tier = tierFor(ms)
  const label = TIER_TEXT[tier as keyof typeof TIER_TEXT]
  const hint = config.status === 'unstable' ? 'Работает с перебоями.' : 'Последняя проверка прошла.'
  return { tier, alive: true, ms, label, hint, checkedAt }
}

/** Speed order: working by ping, working without ping, unchecked, then down. */
export function speedRank(status: ServerStatus): number {
  if (status.tier === 'down') return 4_000_000
  if (status.tier === 'unknown') return 3_000_000
  if (status.ms == null) return 2_000_000
  return status.ms
}

// ---- Shapes the screens already share. Kept so callers stay small. ----

export type ReachStatus = 'open' | 'closed' | 'skip'
export type ReachHit = { status: ReachStatus; ms: number | null; at: number }
export type ReachBook = { at: number; byEndpoint: Record<string, ReachHit> }
export type ReachTarget = {
  host: string
  port: number
  protocol?: string
  transport?: string
  path?: string
  country?: string
}

export const MIN_READY = 5
export const CORE_PASSES = 3
export const STATUS_TTL_MS = 60 * 60 * 1000

export function endpointKey(host: string, port: number): string {
  return `${host.trim().toLowerCase()}:${port}`
}

/** Every protocol is checked on the server now, so nothing is skipped. */
export function browserCanProbe(_protocol?: string | null): boolean {
  return true
}

export function emptyBook(): ReachBook {
  return { at: 0, byEndpoint: {} }
}

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

export function hitFresh(hit: ReachHit | undefined | null, now: number): boolean {
  if (!hit || typeof hit.at !== 'number' || !Number.isFinite(hit.at) || hit.at <= 0) return false
  return now - hit.at < STATUS_TTL_MS
}

/** Server verdicts keyed by host:port, so sorting and the live list keep working. */
export function bookFromConfigs(configs: ConfigRecord[]): ReachBook {
  const byEndpoint: Record<string, ReachHit> = {}
  for (const config of configs) {
    if (!config.host || !config.port) continue
    const status = serverStatus(config)
    const at = status.checkedAt ? new Date(status.checkedAt).getTime() || Date.now() : Date.now()
    byEndpoint[endpointKey(config.host, config.port)] = {
      status: status.alive ? 'open' : 'closed',
      ms: status.ms,
      at,
    }
  }
  return { at: Date.now(), byEndpoint }
}

export function reachLine(hit: ReachHit | undefined): string {
  if (!hit || hit.status === 'skip') return ''
  return hit.status === 'open' ? '' : 'Не работает'
}
