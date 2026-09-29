import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { ChevronDown, ChevronRight, Globe, Info, MoreVertical, QrCode, Search, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ConfigSheet } from '@/components/config-sheet'
import { EmptyState } from '@/components/empty-state'
import { Freshness } from '@/components/freshness'
import { LatencyRange } from '@/components/latency-range'
import { FilterSheet } from '@/components/filter-sheet'
import { LiveParseSheet } from '@/components/live-parse-sheet'
import { QrDialog, type QrRequest } from '@/components/qr-dialog'
import { SiteHeader } from '@/components/site-header'
import { configImportActions } from '@/lib/clients'
import {
  configsToBase64,
  configsToClash,
  configsToSingbox,
  configsToText,
  downloadText,
} from '@/lib/bundle'
import { copyText } from '@/lib/copy'
import {
  LIST_STORAGE_KEY,
  defaultListState,
  draftFilters,
  facetCounts,
  matches,
  migrateListState,
  sameListState,
  sanitizeListState,
  toFacet,
  type FacetItem,
  type FilterDraft,
  type ListState,
} from '@/lib/filters'
import {
  configTitle,
  displayedLatencyBounds,
  flagEmoji,
  formatStamp,
  latencyClass,
  latencyText,
  protocolLine,
  speedText,
  stabilityText,
} from '@/lib/format'
import { formatCount } from '@/lib/plural'
import { endpointKey, reachLine, type ReachBook, type ReachHit } from '@/lib/reach'
import { useReach } from '@/lib/reach-context'
import { ru, statusLabel } from '@/lib/ru'
import { useServerCheck } from '@/lib/server-check-context'
import { STORAGE_KEY, useSettings, type SortKey, type ViewMode } from '@/lib/settings'
import type { ConfigRecord, HubData } from '@/lib/types'
import { cn } from '@/lib/utils'

const HEADER_H = 56
const ROW_H = 72
const COMPACT_H = 44
const CARD_H = 112
const OVERSCAN = 640

type CountryGroup = {
  code: string
  name: string
  count: number
  min: number | null
  max: number | null
  configs: ConfigRecord[]
}

type ListRow =
  | { kind: 'group'; key: string; group: CountryGroup; open: boolean }
  | { kind: 'config'; key: string; config: ConfigRecord }

function configBlob(config: ConfigRecord): string {
  return [
    config.country,
    config.country_code,
    config.host,
    config.remark,
    config.protocol,
    config.transport,
    config.security,
    config.sni,
    String(config.port),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function readListState(): ListState {
  try {
    const listRaw = localStorage.getItem(LIST_STORAGE_KEY)
    const settingsRaw = localStorage.getItem(STORAGE_KEY)
    return migrateListState(listRaw ? JSON.parse(listRaw) : null, settingsRaw ? JSON.parse(settingsRaw) : null)
  } catch {
    return defaultListState()
  }
}

function indexConfigs(configs: ConfigRecord[]): { config: ConfigRecord; facet: FacetItem }[] {
  return configs.map((config) => ({
    config,
    facet: toFacet({
      protocol: config.protocol,
      transport: config.transport,
      security: config.security,
      country_code: config.country_code,
      latency_ms: config.latency_ms,
      blob: configBlob(config),
    }),
  }))
}

function latencyRank(ms: number | null, desc = false): number {
  if (ms == null) return desc ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY
  return ms
}

function reachRank(config: ConfigRecord, book: ReachBook): number {
  const hit = book.byEndpoint[endpointKey(config.host, config.port)]
  if (!hit) return 2_000_000
  if (hit.status === 'open') return hit.ms ?? 100_000
  if (hit.status === 'skip') return 3_000_000
  return 4_000_000
}

function compareConfigs(sort: SortKey, left: ConfigRecord, right: ConfigRecord, book: ReachBook): number {
  if (sort === 'reach') {
    return reachRank(left, book) - reachRank(right, book) || left.id.localeCompare(right.id)
  }
  if (sort === 'latency-desc') {
    return latencyRank(right.latency_ms, true) - latencyRank(left.latency_ms, true) || left.id.localeCompare(right.id)
  }
  if (sort === 'country') {
    return (
      (left.country ?? 'яяя').localeCompare(right.country ?? 'яяя', 'ru') ||
      latencyRank(left.latency_ms) - latencyRank(right.latency_ms)
    )
  }
  if (sort === 'transport') {
    return left.transport.localeCompare(right.transport) || latencyRank(left.latency_ms) - latencyRank(right.latency_ms)
  }
  return latencyRank(left.latency_ms) - latencyRank(right.latency_ms) || left.id.localeCompare(right.id)
}

function groupByCountry(configs: ConfigRecord[], sort: SortKey, book: ReachBook): CountryGroup[] {
  const map = new Map<string, ConfigRecord[]>()
  for (const config of configs) {
    const code =
      config.country_code && /^[a-z]{2}$/i.test(config.country_code)
        ? config.country_code.toUpperCase()
        : 'ZZ'
    const list = map.get(code)
    if (list) list.push(config)
    else map.set(code, [config])
  }
  const groups: CountryGroup[] = []
  for (const [code, items] of map) {
    items.sort((left, right) =>
      sort === 'reach'
        ? compareConfigs(sort, left, right, book)
        : latencyRank(left.latency_ms) - latencyRank(right.latency_ms) || left.id.localeCompare(right.id),
    )
    const name = items.find((item) => item.country)?.country || (code === 'ZZ' ? ru.noCountry : code)
    const bounds = displayedLatencyBounds(items)
    groups.push({ code, name, count: items.length, min: bounds.min, max: bounds.max, configs: items })
  }
  groups.sort((left, right) =>
    sort === 'reach'
      ? compareConfigs(sort, left.configs[0], right.configs[0], book) || left.name.localeCompare(right.name, 'ru')
      : latencyRank(left.min) - latencyRank(right.min) || left.name.localeCompare(right.name, 'ru'),
  )
  return groups
}

function rowHeight(row: ListRow, view: ViewMode): number {
  if (row.kind === 'group') return HEADER_H
  if (view === 'compact') return COMPACT_H
  if (view === 'cards') return CARD_H
  return ROW_H
}

function lowerBound(prefix: number[], target: number): number {
  let lo = 0
  let hi = prefix.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (prefix[mid] < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function ConfigsScreen({ data }: { data: HubData }) {
  const { settings, update } = useSettings()
  const { book, progress, setTargets } = useReach()
  const { phase: serverPhase } = useServerCheck()
  const [list, setList] = useState<ListState>(readListState)
  const [draft, setDraft] = useState<FilterDraft | null>(null)
  const [selectedId, setSelectedId] = useState<ConfigRecord | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [liveOpen, setLiveOpen] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [qr, setQr] = useState<QrRequest | null>(null)
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  const listRef = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState({ start: 0, end: 40 })

  const poolFor = useCallback(
    (showUnstable: boolean, showUnverified: boolean) => {
      const rows = [...data.configs]
      if (showUnstable) rows.push(...(data.unstable ?? []))
      if (showUnverified) rows.push(...data.unverified)
      return indexConfigs(rows)
    },
    [data.configs, data.unstable, data.unverified],
  )

  useEffect(() => {
    const ids = new Set(data.configs.map((item) => item.id))
    const uris = new Set(data.configs.map((item) => item.uri))
    setPicked((current) => {
      let changed = false
      const next = new Set<string>()
      for (const id of current) {
        if (ids.has(id)) next.add(id)
        else changed = true
      }
      return changed ? next : current
    })
    setQr((current) => {
      if (!current || current.share !== 'text') return current
      return uris.has(current.value) ? current : null
    })
  }, [data])

  const appliedIndexed = useMemo(
    () => poolFor(list.showUnstable, list.showUnverified),
    [list.showUnstable, list.showUnverified, poolFor],
  )
  const safeList = useMemo(
    () => sanitizeListState(list, appliedIndexed.map((item) => item.facet)),
    [appliedIndexed, list],
  )

  useEffect(() => {
    localStorage.setItem(LIST_STORAGE_KEY, JSON.stringify(safeList))
    if (!sameListState(list, safeList)) setList(safeList)
  }, [list, safeList])

  const appliedFilters = useMemo(
    () => ({
      query: safeList.query,
      country: safeList.country,
      transport: safeList.transport,
      security: safeList.security,
      protocol: safeList.protocol,
      threshold: settings.latencyThreshold,
    }),
    [safeList, settings.latencyThreshold],
  )

  const filtered = useMemo(() => {
    let matched = appliedIndexed
      .filter((item) => matches(item.facet, appliedFilters))
      .map((item) => item.config)
    if (settings.onlyReachable) {
      matched = matched.filter((config) => book.byEndpoint[endpointKey(config.host, config.port)]?.status === 'open')
    }
    if (settings.view !== 'country') matched.sort((left, right) => compareConfigs(settings.sort, left, right, book))
    return matched
  }, [appliedFilters, appliedIndexed, book, settings.onlyReachable, settings.sort, settings.view])

  useEffect(() => {
    setTargets(filtered)
  }, [filtered, setTargets])

  const sheetDraft = draft ?? {
    country: safeList.country,
    transport: safeList.transport,
    security: safeList.security,
    protocol: safeList.protocol,
    threshold: settings.latencyThreshold,
    sort: settings.sort,
    view: settings.view,
    showUnverified: safeList.showUnverified,
    showUnstable: safeList.showUnstable,
    onlyReachable: settings.onlyReachable,
  }
  const draftIndexed = useMemo(
    () => poolFor(sheetDraft.showUnstable, sheetDraft.showUnverified),
    [poolFor, sheetDraft.showUnstable, sheetDraft.showUnverified],
  )
  const draftActive = useMemo(() => draftFilters(sheetDraft, safeList.query), [safeList.query, sheetDraft])
  const draftCount = useMemo(() => {
    const matched = draftIndexed.filter((item) => matches(item.facet, draftActive))
    if (!sheetDraft.onlyReachable) return matched.length
    return matched.filter((item) => book.byEndpoint[endpointKey(item.config.host, item.config.port)]?.status === 'open')
      .length
  }, [book, draftActive, draftIndexed, sheetDraft.onlyReachable])
  const draftFacets = useMemo(() => {
    const items = draftIndexed.map((item) => item.facet)
    const names = new Map<string, string>()
    for (const item of draftIndexed) {
      if (item.facet.country && item.config.country) names.set(item.facet.country, item.config.country)
    }
    return {
      protocols: facetCounts(items, draftActive, 'protocol'),
      transports: facetCounts(items, draftActive, 'transport'),
      securities: facetCounts(items, draftActive, 'security'),
      countries: facetCounts(items, draftActive, 'country').map((row) => ({
        code: row.id,
        name: names.get(row.id) || row.id,
        count: row.count,
      })),
    }
  }, [draftActive, draftIndexed])

  const groups = useMemo(
    () =>
      settings.view === 'country' ? groupByCountry(filtered, settings.sort, book) : [],
    [book, filtered, settings.sort, settings.view],
  )

  const rows = useMemo(() => {
    if (settings.view !== 'country') {
      return filtered.map((config) => ({ kind: 'config' as const, key: config.id, config }))
    }
    const next: ListRow[] = []
    for (const group of groups) {
      const open = openGroups.has(group.code)
      next.push({ kind: 'group', key: `g:${group.code}`, group, open })
      if (!open) continue
      for (const config of group.configs) next.push({ kind: 'config', key: config.id, config })
    }
    return next
  }, [filtered, groups, openGroups, settings.view])

  const prefix = useMemo(() => {
    const next = new Array<number>(rows.length + 1)
    next[0] = 0
    for (let index = 0; index < rows.length; index += 1) {
      next[index + 1] = next[index] + rowHeight(rows[index], settings.view)
    }
    return next
  }, [rows, settings.view])

  useEffect(() => {
    const node = listRef.current
    if (!node || rows.length === 0) return
    let frame = 0
    const update = () => {
      frame = 0
      const top = node.getBoundingClientRect().top + window.scrollY
      const viewStart = Math.max(0, window.scrollY - top - OVERSCAN)
      const viewEnd = window.scrollY + window.innerHeight - top + OVERSCAN
      const start = Math.max(0, lowerBound(prefix, viewStart) - 1)
      const end = Math.min(rows.length, Math.max(start + 1, lowerBound(prefix, viewEnd)))
      setRange((current) => (current.start === start && current.end === end ? current : { start, end }))
    }
    const schedule = () => {
      if (frame) return
      frame = window.requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [prefix, rows.length])

  const start = Math.min(range.start, rows.length)
  const end = Math.min(Math.max(range.end, start), rows.length)
  const slice = rows.slice(start, end)
  const totalHeight = prefix[rows.length] ?? 0

  const chosen = useMemo(
    () => appliedIndexed.filter((item) => picked.has(item.config.id)).map((item) => item.config),
    [appliedIndexed, picked],
  )
  const allFilteredPicked = filtered.length > 0 && filtered.every((config) => picked.has(config.id))
  const filtersNarrow =
    Boolean(safeList.country || safeList.transport || safeList.security || safeList.protocol) ||
    settings.latencyThreshold != null ||
    settings.onlyReachable ||
    safeList.query.trim() !== ''

  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function enterSelect(id?: string) {
    setSelecting(true)
    if (id) {
      setPicked((current) => new Set(current).add(id))
    }
  }

  function exitSelect() {
    setSelecting(false)
    setPicked(new Set())
  }

  function toggleGroup(code: string) {
    setOpenGroups((current) => {
      const next = new Set(current)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  function expandGroups() {
    setOpenGroups(new Set(groups.map((group) => group.code)))
  }

  function collapseGroups() {
    setOpenGroups(new Set())
  }

  function toggleFiltered() {
    setPicked((current) => {
      const next = new Set(current)
      if (allFilteredPicked) {
        for (const config of filtered) next.delete(config.id)
      } else {
        for (const config of filtered) next.add(config.id)
      }
      return next
    })
  }

  function openQrFor(configs: ConfigRecord[], title: string) {
    const value = configsToText(configs)
    if (new TextEncoder().encode(value).length > 1200) {
      toast.error(ru.qrTooLong)
      return
    }
    setQr({
      title,
      value,
      share: 'text',
      actions: configs.length === 1 ? configImportActions(configs[0].uri) : undefined,
    })
  }

  const statsLine = ru.listSummary(data.stats.published, data.stats.countries)
  const opened = selectedId
  const liveOpened = opened
    ? (data.configs.find((item) => item.id === opened.id) ??
      data.unstable?.find((item) => item.id === opened.id) ??
      data.unverified.find((item) => item.id === opened.id) ??
      null)
    : null
  const sheetConfig = liveOpened ?? opened
  const sheetMissing = Boolean(opened) && !liveOpened
  const filtersOn =
    Boolean(safeList.country || safeList.transport || safeList.security || safeList.protocol) ||
    settings.latencyThreshold != null ||
    settings.onlyReachable

  function openFilters() {
    setDraft({
      country: safeList.country,
      transport: safeList.transport,
      security: safeList.security,
      protocol: safeList.protocol,
      threshold: settings.latencyThreshold,
      sort: settings.sort,
      view: settings.view,
      showUnverified: safeList.showUnverified,
      showUnstable: safeList.showUnstable,
      onlyReachable: settings.onlyReachable,
    })
    setFiltersOpen(true)
  }

  function applyDraft() {
    if (!draft) return
    const next = sanitizeListState(
      {
        ...safeList,
        country: draft.country,
        transport: draft.transport,
        security: draft.security,
        protocol: draft.protocol,
        showUnverified: draft.showUnverified,
        showUnstable: draft.showUnstable,
      },
      draftIndexed.map((item) => item.facet),
    )
    setList(next)
    update({
      latencyThreshold: draft.threshold,
      sort: draft.sort,
      view: draft.view,
      onlyReachable: draft.onlyReachable,
    })
    setDraft(null)
    setFiltersOpen(false)
  }

  function resetDraft() {
    setDraft((current) => ({
      country: null,
      transport: null,
      security: null,
      protocol: null,
      threshold: null,
      sort: current?.sort ?? settings.sort,
      view: current?.view ?? settings.view,
      showUnverified: false,
      showUnstable: false,
      onlyReachable: false,
    }))
  }

  function resetAllFilters() {
    setList(defaultListState())
    update({ latencyThreshold: null, onlyReachable: false })
    setDraft(null)
  }
  const knownIds = useMemo(() => {
    const ids = new Set<string>()
    for (const item of [...data.configs, ...(data.unstable ?? []), ...data.unverified]) ids.add(item.id)
    return ids
  }, [data])

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Меню">
          <MoreVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={() => (selecting ? exitSelect() : enterSelect())}>
          {selecting ? ru.doneSelecting : ru.select}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setLiveOpen(true)}>{ru.liveParse}</DropdownMenuItem>
        {data.unverified.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={safeList.showUnverified}
              onCheckedChange={(value) => setList((current) => ({ ...current, showUnverified: value }))}
            >
              {ru.showUnverified}
            </DropdownMenuCheckboxItem>
          </>
        )}
        {(data.unstable?.length ?? 0) > 0 && (
          <DropdownMenuCheckboxItem
            checked={safeList.showUnstable}
            onCheckedChange={(value) => setList((current) => ({ ...current, showUnstable: value }))}
          >
            {ru.showUnstable}
          </DropdownMenuCheckboxItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div className={cn('mx-auto w-full max-w-3xl px-4 pt-4', selecting && chosen.length > 0 && 'pb-36')}>
      <SiteHeader updated={formatStamp(data.generated_at)} menu={menu} />
      <LiveParseSheet
        open={liveOpen}
        known={knownIds}
        onOpenChange={setLiveOpen}
      />
      <p className="mb-3 text-[13px] text-muted-foreground">
        {statsLine}
        {' · '}
        <Freshness iso={data.generated_at} />
      </p>
      {(progress.running || progress.done > 0) && (
        <p data-reach-progress className="mb-1 text-[13px]">
          {progress.running ? ru.reachProgress(progress.done, progress.total) : ru.reachSummary(progress.open, progress.total)}
        </p>
      )}
      {(progress.running || progress.done > 0) && (
        <p className="mb-3 text-[12px] leading-snug text-muted-foreground">{ru.reachNote}</p>
      )}
      {serverPhase === 'running' && <p className="mb-3 text-[13px]">{ru.serverCheckRunning}</p>}

      <div className="mb-3 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={safeList.query}
            onChange={(event) => setList((current) => ({ ...current, query: event.target.value }))}
            placeholder={ru.searchConfigsPlaceholder}
            aria-label={ru.searchConfigs}
            className="h-10 rounded-xl border-0 bg-card pl-9"
          />
        </div>
        <Button
          variant={filtersOn ? 'secondary' : 'ghost'}
          size="icon"
          aria-label="Фильтры"
          onClick={openFilters}
        >
          <SlidersHorizontal />
        </Button>
      </div>

      <div className={settings.view === 'cards' ? '' : 'overflow-hidden rounded-2xl bg-card'}>
        {selecting && (
          <div className="flex items-center gap-3 px-4 py-2">
            <input
              type="checkbox"
              className="size-4"
              aria-label="Выбрать показанные"
              checked={allFilteredPicked}
              onChange={toggleFiltered}
            />
            <span className="text-[13px] text-muted-foreground">Выбрать показанные</span>
          </div>
        )}
        {filtered.length === 0 ? (
          <EmptyState
            text={ru.nothingFound}
            action={filtersNarrow ? { label: ru.resetFilters, onClick: resetAllFilters } : undefined}
          />
        ) : (
          <div ref={listRef} style={{ height: totalHeight, position: 'relative' }}>
            <div style={{ height: prefix[start] ?? 0 }} />
            {slice.map((row) =>
              row.kind === 'group' ? (
                <CountryHeader
                  key={row.key}
                  group={row.group}
                  open={row.open}
                  onToggle={() => toggleGroup(row.group.code)}
                />
              ) : (
                <ConfigItem
                  key={row.key}
                  view={settings.view}
                  config={row.config}
                  selecting={selecting}
                  checked={picked.has(row.config.id)}
                  onToggle={() => toggle(row.config.id)}
                  onOpen={() => (selecting ? toggle(row.config.id) : setSelectedId(row.config))}
                  onLongPress={() => enterSelect(row.config.id)}
                  onQr={() =>
                    setQr({
                      title: `${flagEmoji(row.config.country_code)} ${configTitle(row.config)}`.trim(),
                      value: row.config.uri,
                      share: 'text',
                      actions: configImportActions(row.config.uri),
                    })
                  }
                />
              ),
            )}
            <div style={{ height: Math.max(0, totalHeight - (prefix[end] ?? 0)) }} />
          </div>
        )}
      </div>

      {selecting && chosen.length > 0 && (
        <div className="fixed inset-x-0 bottom-[4.6rem] z-30 border-t border-border bg-background/95 px-3 py-2 backdrop-blur-md">
          <div className="mx-auto flex max-w-3xl flex-col gap-2">
            <div className="flex items-center justify-between text-[13px]">
              <span>{ru.selected(chosen.length)}</span>
              <button type="button" className="text-muted-foreground" onClick={exitSelect}>
                {ru.clear}
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button size="sm" variant="secondary" onClick={() => void copyText(configsToText(chosen), ru.copiedCount(chosen.length))}>
                {ru.text}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void copyText(configsToBase64(chosen), ru.encodedCopied)}>
                {ru.encoded}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => downloadText('v2hub.txt', `${configsToText(chosen)}\n`)}>
                {ru.file}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => openQrFor(chosen, `V2Hub · ${chosen.length}`)}>
                QR
              </Button>
              <Button size="sm" variant="secondary" onClick={() => downloadText('v2hub-clash.yaml', configsToClash(chosen), 'application/yaml')}>
                Clash
              </Button>
              <Button size="sm" variant="secondary" onClick={() => downloadText('v2hub-singbox.json', configsToSingbox(chosen), 'application/json')}>
                sing-box
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfigSheet
        config={sheetConfig}
        missing={sheetMissing}
        sources={data.sources}
        client={settings.client}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
        onQr={setQr}
      />
      <FilterSheet
        open={filtersOpen}
        onOpenChange={(open) => {
          setFiltersOpen(open)
          if (!open) setDraft(null)
        }}
        countries={draftFacets.countries}
        transports={draftFacets.transports}
        securities={draftFacets.securities}
        protocols={draftFacets.protocols}
        draft={sheetDraft}
        onDraft={(patch) => setDraft((current) => ({ ...(current ?? sheetDraft), ...patch }))}
        unverifiedCount={data.unverified.length}
        unstableCount={data.unstable?.length ?? 0}
        resultCount={draftCount}
        onApply={applyDraft}
        onExpandGroups={expandGroups}
        onCollapseGroups={collapseGroups}
        onReset={resetDraft}
      />
      <QrDialog
        request={qr}
        onOpenChange={(open) => {
          if (!open) setQr(null)
        }}
      />
    </div>
  )
}

function CountryHeader({
  group,
  open,
  onToggle,
}: {
  group: CountryGroup
  open: boolean
  onToggle: () => void
}) {
  const flag = flagEmoji(group.code)
  return (
    <button
      type="button"
      className="flex h-14 w-full items-center gap-2 overflow-hidden border-t border-border px-3 text-left whitespace-nowrap sm:px-4"
      aria-expanded={open}
      onClick={onToggle}
    >
      {open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
      <span className="grid w-6 shrink-0 place-items-center text-xl leading-none" aria-hidden>
        {flag || <Globe className="size-5 text-muted-foreground" />}
      </span>
      <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{group.name}</span>
      <Badge variant="secondary">{formatCount(group.count)}</Badge>
      <LatencyRange min={group.min} max={group.max} />
    </button>
  )
}

function StatusDot({ status }: { status?: string }) {
  if (status !== 'working' && status !== 'unstable') return null
  const unstable = status === 'unstable'
  return (
    <span
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        unstable ? 'border border-foreground' : 'bg-foreground',
      )}
      title={statusLabel(status)}
      aria-label={statusLabel(status)}
    />
  )
}

function useRowHit(config: ConfigRecord): ReachHit | undefined {
  const { book } = useReach()
  return book.byEndpoint[endpointKey(config.host, config.port)]
}

function rowMeta(config: ConfigRecord, hit: ReachHit | undefined): string {
  const parts: string[] = []
  const local = reachLine(hit)
  if (local) parts.push(local)
  if (config.vantage === 'ru' || config.vantage === 'multi') parts.push(ru.fromRussia)
  parts.push(protocolLine(config.transport, config.protocol))
  const stability = stabilityText(config.stability)
  const speed = speedText(config.speed_kbps)
  if (stability) parts.push(stability)
  if (speed) parts.push(speed)
  if (config.verified === 'tcp') parts.push(ru.portOpen)
  return parts.join(' · ')
}

function usePress(onOpen: () => void, onLongPress: () => void) {
  const timer = useRef(0)
  const held = useRef(false)
  return {
    onPointerDown: () => {
      held.current = false
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        held.current = true
        onLongPress()
      }, 480)
    },
    onPointerUp: () => window.clearTimeout(timer.current),
    onPointerCancel: () => window.clearTimeout(timer.current),
    onPointerLeave: () => window.clearTimeout(timer.current),
    onClick: (event: MouseEvent) => {
      if (held.current) {
        event.preventDefault()
        held.current = false
        return
      }
      onOpen()
    },
    onContextMenu: (event: MouseEvent) => {
      event.preventDefault()
      onLongPress()
    },
  }
}

function ConfigItem({
  view,
  ...props
}: {
  view: ViewMode
  config: ConfigRecord
  selecting: boolean
  checked: boolean
  onToggle: () => void
  onOpen: () => void
  onLongPress: () => void
  onQr: () => void
}) {
  if (view === 'compact') return <CompactRow {...props} />
  if (view === 'cards') return <CardRow {...props} />
  return <ConfigRow {...props} />
}

function ConfigRow({
  config,
  selecting,
  checked,
  onToggle,
  onOpen,
  onLongPress,
  onQr,
}: {
  config: ConfigRecord
  selecting: boolean
  checked: boolean
  onToggle: () => void
  onOpen: () => void
  onLongPress: () => void
  onQr: () => void
}) {
  const title = configTitle(config)
  const flag = flagEmoji(config.country_code)
  const press = usePress(onOpen, onLongPress)
  const hit = useRowHit(config)
  const meta = rowMeta(config, hit)
  return (
    <div className="flex h-[72px] items-center gap-2 border-t border-border px-3 sm:gap-3 sm:px-4">
      {selecting && (
        <input
          type="checkbox"
          className="size-4 shrink-0"
          aria-label={`Выбрать ${title}`}
          checked={checked}
          onChange={onToggle}
        />
      )}
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left sm:gap-3" {...press}>
        <span className="grid w-6 shrink-0 place-items-center text-xl leading-none" aria-hidden>
          {flag || <Globe className="size-5 text-muted-foreground" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2 text-[15px] font-medium sm:text-[16px]">
            <StatusDot status={config.status} />
            <span className="truncate">
              {title}
              {config.country_code ? ` ${config.country_code}` : ''}
            </span>
          </span>
          <span className="block truncate text-[12px] text-muted-foreground sm:text-[13px]">{meta}</span>
        </span>
      </button>
      <span className={cn('shrink-0 text-[14px] font-semibold tabular-nums', latencyClass(config.latency_ms))}>
        {latencyText(config.latency_ms)}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`QR-код ${title}`} onClick={onQr}>
            <QrCode />
          </Button>
        </TooltipTrigger>
        <TooltipContent>QR-код</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Подробности ${title}`} onClick={onOpen}>
            <Info />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Подробности</TooltipContent>
      </Tooltip>
    </div>
  )
}

function CompactRow({
  config,
  selecting,
  checked,
  onToggle,
  onOpen,
  onLongPress,
  onQr,
}: {
  config: ConfigRecord
  selecting: boolean
  checked: boolean
  onToggle: () => void
  onOpen: () => void
  onLongPress: () => void
  onQr: () => void
}) {
  const title = configTitle(config)
  const flag = flagEmoji(config.country_code)
  const press = usePress(onOpen, onLongPress)
  const hit = useRowHit(config)
  const meta = rowMeta(config, hit)
  return (
    <div className="flex h-11 items-center gap-2 border-t border-border px-3">
      {selecting && (
        <input
          type="checkbox"
          className="size-4 shrink-0"
          aria-label={`Выбрать ${title}`}
          checked={checked}
          onChange={onToggle}
        />
      )}
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" {...press}>
        <span className="w-5 shrink-0 text-center text-[16px] leading-none" aria-hidden>
          {flag || <Globe className="size-4 text-muted-foreground" />}
        </span>
        <StatusDot status={config.status} />
        <span className="min-w-0 flex-1 truncate text-[14px]">
          {title}
          {config.country_code ? ` ${config.country_code}` : ''}
          <span className="text-muted-foreground"> · {meta}</span>
        </span>
      </button>
      <span className={cn('shrink-0 text-[13px] font-semibold tabular-nums', latencyClass(config.latency_ms))}>
        {latencyText(config.latency_ms)}
      </span>
      <Button variant="ghost" size="icon-sm" aria-label={`QR-код ${title}`} onClick={onQr}>
        <QrCode />
      </Button>
    </div>
  )
}

function CardRow({
  config,
  selecting,
  checked,
  onToggle,
  onOpen,
  onLongPress,
  onQr,
}: {
  config: ConfigRecord
  selecting: boolean
  checked: boolean
  onToggle: () => void
  onOpen: () => void
  onLongPress: () => void
  onQr: () => void
}) {
  const title = configTitle(config)
  const flag = flagEmoji(config.country_code)
  const press = usePress(onOpen, onLongPress)
  const hit = useRowHit(config)
  const meta = rowMeta(config, hit)
  return (
    <div className="h-28 px-1 py-1.5">
      <div className="flex h-full items-center gap-2 rounded-2xl bg-card px-3">
        {selecting && (
          <input
            type="checkbox"
            className="size-4 shrink-0"
            aria-label={`Выбрать ${title}`}
            checked={checked}
            onChange={onToggle}
          />
        )}
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" {...press}>
          <span className="grid w-6 shrink-0 place-items-center text-xl leading-none" aria-hidden>
            {flag || <Globe className="size-5 text-muted-foreground" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2 text-[15px] font-medium">
              <StatusDot status={config.status} />
              <span className="truncate">
                {title}
                {config.country_code ? ` ${config.country_code}` : ''}
              </span>
            </span>
            <span className="block truncate text-[12px] text-muted-foreground">{meta}</span>
          </span>
        </button>
        <span className={cn('shrink-0 text-[14px] font-semibold tabular-nums', latencyClass(config.latency_ms))}>
          {latencyText(config.latency_ms)}
        </span>
        <Button variant="ghost" size="icon-sm" aria-label={`QR-код ${title}`} onClick={onQr}>
          <QrCode />
        </Button>
      </div>
    </div>
  )
}
