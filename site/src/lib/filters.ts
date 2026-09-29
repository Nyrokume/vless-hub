import { CLIENTS, type ClientId } from '@/lib/clients'

/** Bump when saved keys change. Older blobs are migrated, unknown values dropped. */
export const SETTINGS_VERSION = 2
export const LIST_VERSION = 2
export const LIST_STORAGE_KEY = 'vless-hub-list'

const SORTS = ['latency-asc', 'latency-desc', 'country', 'transport', 'reach'] as const
const VIEWS = ['country', 'flat', 'compact', 'cards'] as const
const THRESHOLDS = [150, 300, 600, 1000] as const

const SORT_ALIASES: Record<string, (typeof SORTS)[number]> = {
  'latency-asc': 'latency-asc',
  'latency-desc': 'latency-desc',
  country: 'country',
  transport: 'transport',
  ping: 'latency-asc',
  latency: 'latency-asc',
  fast: 'latency-asc',
  slow: 'latency-desc',
  network: 'transport',
  reach: 'reach',
  mine: 'reach',
}

const VIEW_ALIASES: Record<string, (typeof VIEWS)[number]> = {
  country: 'country',
  countries: 'country',
  group: 'country',
  groups: 'country',
  grouped: 'country',
  flat: 'flat',
  list: 'flat',
  compact: 'compact',
  cards: 'cards',
}

export type StoredSettings = {
  sort: (typeof SORTS)[number]
  view: (typeof VIEWS)[number]
  latencyThreshold: number | null
  client: ClientId
  publicBase: string
  onlyReachable: boolean
}

export type ListState = {
  version: number
  query: string
  country: string | null
  transport: string | null
  security: string | null
  protocol: string | null
  showUnverified: boolean
  showUnstable: boolean
}

export type ActiveFilters = {
  query: string
  country: string | null
  transport: string | null
  security: string | null
  protocol: string | null
  threshold: number | null
}

export type FacetField = 'protocol' | 'transport' | 'security' | 'country'

export type FacetItem = {
  protocol: string
  transport: string
  security: string
  country: string
  latency: number | null
  blob: string
}

export function protocolKey(value: string | null | undefined): string {
  const raw = (value || 'vless').trim().toLowerCase()
  if (raw === 'ss' || raw === 'shadowsocks') return 'shadowsocks'
  if (raw === 'hy2' || raw === 'hysteria2') return 'hysteria2'
  if (raw === 'vless') return 'vless'
  if (raw === 'trojan') return 'trojan'
  return raw
}

export function transportKey(value: string | null | undefined): string {
  const raw = (value || 'tcp').trim().toLowerCase()
  if (raw === 'hy2' || raw === 'hysteria2') return 'hysteria2'
  return raw
}

export function securityKey(value: string | null | undefined): string {
  const raw = (value || 'none').trim().toLowerCase()
  if (!raw || raw === 'none' || raw === 'null') return 'none'
  return raw
}

export function countryKey(value: string | null | undefined): string {
  if (!value) return ''
  const upper = value.trim().toUpperCase()
  if (upper === 'UK') return 'GB'
  return /^[A-Z]{2}$/.test(upper) ? upper : ''
}

export function normalizeThreshold(value: unknown): number | null {
  if (value == null || value === '' || value === 'all') return null
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return THRESHOLDS.some((item) => item === number) ? number : null
}

function choice(field: FacetField, value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'all' || trimmed === '*') return null
  if (field === 'protocol') return protocolKey(trimmed)
  if (field === 'transport') return transportKey(trimmed)
  if (field === 'security') return securityKey(trimmed)
  const country = countryKey(trimmed)
  return country || null
}

function flag(value: unknown): boolean {
  return value === true || value === 1 || value === 'true' || value === '1'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function defaultListState(): ListState {
  return {
    version: LIST_VERSION,
    query: '',
    country: null,
    transport: null,
    security: null,
    protocol: null,
    showUnverified: false,
    showUnstable: false,
  }
}

export function migrateSettings(raw: unknown, fallback: StoredSettings): StoredSettings {
  const parsed = asRecord(raw) ?? {}
  const sortRaw = typeof parsed.sort === 'string' ? parsed.sort.trim().toLowerCase() : ''
  const viewRaw = typeof parsed.view === 'string' ? parsed.view.trim().toLowerCase() : ''
  const client = CLIENTS.some((item) => item.id === parsed.client) ? (parsed.client as ClientId) : fallback.client
  const publicBase =
    typeof parsed.publicBase === 'string' && parsed.publicBase.trim()
      ? parsed.publicBase.trim().replace(/\/+$/, '')
      : fallback.publicBase
  return {
    sort: SORT_ALIASES[sortRaw] ?? fallback.sort,
    view: VIEW_ALIASES[viewRaw] ?? fallback.view,
    latencyThreshold: normalizeThreshold(parsed.latencyThreshold),
    client,
    publicBase,
    onlyReachable: flag(parsed.onlyReachable),
  }
}

function readChoices(source: Record<string, unknown> | null, keepQuery: boolean): ListState {
  const base = defaultListState()
  if (!source) return base
  return {
    version: LIST_VERSION,
    query: keepQuery && typeof source.query === 'string' ? source.query.slice(0, 200) : '',
    country: choice('country', source.country),
    transport: choice('transport', source.transport),
    security: choice('security', source.security),
    protocol: choice('protocol', source.protocol),
    showUnverified: flag(source.showUnverified),
    showUnstable: flag(source.showUnstable),
  }
}

/** Current list blob wins. Older blobs drop free-text search and unknown keys are removed later. */
export function migrateListState(listRaw: unknown, legacySettings?: unknown): ListState {
  const list = asRecord(listRaw)
  if (list && list.version === LIST_VERSION) return readChoices(list, true)
  if (list && ('protocol' in list || 'transport' in list || 'security' in list || 'country' in list || 'query' in list)) {
    return readChoices(list, false)
  }
  const legacy = asRecord(legacySettings)
  if (legacy && ('protocol' in legacy || 'transport' in legacy || 'security' in legacy || 'country' in legacy)) {
    return readChoices(legacy, false)
  }
  return defaultListState()
}

export function toFacet(config: {
  protocol?: string
  transport?: string
  security?: string
  country_code?: string | null
  latency_ms?: number | null
  blob: string
}): FacetItem {
  return {
    protocol: protocolKey(config.protocol),
    transport: transportKey(config.transport),
    security: securityKey(config.security),
    country: countryKey(config.country_code),
    latency: typeof config.latency_ms === 'number' && !Number.isNaN(config.latency_ms) ? config.latency_ms : null,
    blob: config.blob,
  }
}

export function matches(item: FacetItem, filters: ActiveFilters, ignore?: FacetField): boolean {
  if (filters.threshold != null && (item.latency == null || item.latency > filters.threshold)) return false
  if (ignore !== 'country' && filters.country && item.country !== filters.country) return false
  if (ignore !== 'transport' && filters.transport && item.transport !== filters.transport) return false
  if (ignore !== 'security' && filters.security && item.security !== filters.security) return false
  if (ignore !== 'protocol' && filters.protocol && item.protocol !== filters.protocol) return false
  const needle = filters.query.trim().toLowerCase()
  if (needle && !item.blob.includes(needle)) return false
  return true
}

export function countMatches(items: FacetItem[], filters: ActiveFilters): number {
  let count = 0
  for (const item of items) if (matches(item, filters)) count += 1
  return count
}

export function facetCounts(
  items: FacetItem[],
  filters: ActiveFilters,
  field: FacetField,
): { id: string; count: number }[] {
  const map = new Map<string, number>()
  for (const item of items) {
    if (!matches(item, filters, field)) continue
    const id = item[field]
    if (!id) continue
    map.set(id, (map.get(id) ?? 0) + 1)
  }
  return [...map.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((left, right) => right.count - left.count || left.id.localeCompare(right.id))
}

/** Drop a saved choice that is not on any current chip, so it cannot hide the whole list. */
export function sanitizeListState(state: ListState, items: FacetItem[]): ListState {
  const present = {
    protocol: new Set(items.map((item) => item.protocol)),
    transport: new Set(items.map((item) => item.transport)),
    security: new Set(items.map((item) => item.security)),
    country: new Set(items.map((item) => item.country).filter(Boolean)),
  }
  return {
    ...state,
    version: LIST_VERSION,
    protocol: state.protocol && present.protocol.has(state.protocol) ? state.protocol : null,
    transport: state.transport && present.transport.has(state.transport) ? state.transport : null,
    security: state.security && present.security.has(state.security) ? state.security : null,
    country: state.country && present.country.has(state.country) ? state.country : null,
  }
}

export type FilterDraft = {
  country: string | null
  transport: string | null
  security: string | null
  protocol: string | null
  threshold: number | null
  sort: StoredSettings['sort']
  view: StoredSettings['view']
  showUnverified: boolean
  showUnstable: boolean
  onlyReachable: boolean
}

export function draftFilters(draft: FilterDraft, query: string): ActiveFilters {
  return {
    query,
    country: draft.country,
    transport: draft.transport,
    security: draft.security,
    protocol: draft.protocol,
    threshold: normalizeThreshold(draft.threshold),
  }
}

export function sameListState(left: ListState, right: ListState): boolean {
  return (
    left.query === right.query &&
    left.country === right.country &&
    left.transport === right.transport &&
    left.security === right.security &&
    left.protocol === right.protocol &&
    left.showUnverified === right.showUnverified &&
    left.showUnstable === right.showUnstable
  )
}
