import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Globe, Info, QrCode, Search, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ConfigSheet } from '@/components/config-sheet'
import { FilterSheet } from '@/components/filter-sheet'
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
  configTitle,
  flagEmoji,
  formatStamp,
  latencyClass,
  latencyText,
  protocolLine,
  uptimeText,
} from '@/lib/format'
import { SORTS, sortLabel, useSettings, type SortKey } from '@/lib/settings'
import type { ConfigRecord, HubData } from '@/lib/types'
import { useMediaQuery } from '@/lib/use-media'
import { cn } from '@/lib/utils'

const HEADER_H = 56
const ROW_H = 72
const OVERSCAN = 640

type Layout = 'country' | 'flat'
type CountryOrder = 'count' | 'ping'

type CountryGroup = {
  code: string
  name: string
  count: number
  best: number | null
  configs: ConfigRecord[]
}

type ListRow =
  | { kind: 'group'; key: string; group: CountryGroup; open: boolean }
  | { kind: 'config'; key: string; config: ConfigRecord }

function latencyRank(ms: number | null, desc = false): number {
  if (ms == null) return desc ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY
  return ms
}

function compareConfigs(sort: SortKey, left: ConfigRecord, right: ConfigRecord): number {
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

function byPing(left: ConfigRecord, right: ConfigRecord): number {
  return latencyRank(left.latency_ms) - latencyRank(right.latency_ms) || left.id.localeCompare(right.id)
}

function groupByCountry(configs: ConfigRecord[], order: CountryOrder): CountryGroup[] {
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
    items.sort(byPing)
    const name = items.find((item) => item.country)?.country || (code === 'ZZ' ? 'Без страны' : code)
    let best: number | null = null
    for (const item of items) {
      if (item.latency_ms == null) continue
      if (best == null || item.latency_ms < best) best = item.latency_ms
    }
    groups.push({ code, name, count: items.length, best, configs: items })
  }
  groups.sort((left, right) => {
    if (order === 'ping') {
      return (
        latencyRank(left.best) - latencyRank(right.best) ||
        right.count - left.count ||
        left.name.localeCompare(right.name, 'ru')
      )
    }
    return right.count - left.count || left.name.localeCompare(right.name, 'ru')
  })
  return groups
}

function rowHeight(row: ListRow): number {
  return row.kind === 'group' ? HEADER_H : ROW_H
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
  const desktop = useMediaQuery('(min-width: 1024px)')
  const [query, setQuery] = useState('')
  const [country, setCountry] = useState<string | null>(null)
  const [transport, setTransport] = useState<string | null>(null)
  const [security, setSecurity] = useState<string | null>(null)
  const [protocol, setProtocol] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<ConfigRecord | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [showUnverified, setShowUnverified] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [qr, setQr] = useState<QrRequest | null>(null)
  const [layout, setLayout] = useState<Layout>('country')
  const [countryOrder, setCountryOrder] = useState<CountryOrder>('count')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const listRef = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState({ start: 0, end: 40 })

  const visible = useMemo(
    () => (showUnverified ? [...data.configs, ...data.unverified] : data.configs),
    [data.configs, data.unverified, showUnverified],
  )

  const indexed = useMemo(
    () =>
      visible.map((config) => ({
        config,
        blob: [
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
          .toLowerCase(),
      })),
    [visible],
  )

  const countries = useMemo(() => {
    const map = new Map<string, { code: string; name: string; count: number }>()
    for (const config of visible) {
      if (!config.country_code) continue
      const current = map.get(config.country_code)
      if (current) current.count += 1
      else {
        map.set(config.country_code, {
          code: config.country_code,
          name: config.country || config.country_code,
          count: 1,
        })
      }
    }
    return [...map.values()].sort(
      (left, right) => right.count - left.count || left.name.localeCompare(right.name, 'ru'),
    )
  }, [visible])

  const transports = useMemo(() => {
    const map = new Map<string, number>()
    for (const config of visible) map.set(config.transport, (map.get(config.transport) ?? 0) + 1)
    return [...map.entries()]
      .map(([id, count]) => ({ id, count }))
      .sort((left, right) => right.count - left.count)
  }, [visible])

  const protocols = useMemo(() => {
    const map = new Map<string, number>()
    for (const config of visible) {
      const id = config.protocol || 'vless'
      map.set(id, (map.get(id) ?? 0) + 1)
    }
    return [...map.entries()]
      .map(([id, count]) => ({ id, count }))
      .sort((left, right) => right.count - left.count)
  }, [visible])

  const securities = useMemo(() => {
    const map = new Map<string, number>()
    for (const config of visible) map.set(config.security, (map.get(config.security) ?? 0) + 1)
    return [...map.entries()]
      .map(([id, count]) => ({ id, count }))
      .sort((left, right) => right.count - left.count)
  }, [visible])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const threshold = settings.latencyThreshold
    const matched: ConfigRecord[] = []
    for (const item of indexed) {
      const config = item.config
      if (threshold != null && (config.latency_ms == null || config.latency_ms > threshold)) continue
      if (country && config.country_code !== country) continue
      if (transport && config.transport !== transport) continue
      if (security && config.security !== security) continue
      if (protocol && (config.protocol || 'vless') !== protocol) continue
      if (needle && !item.blob.includes(needle)) continue
      matched.push(config)
    }
    if (layout === 'flat') matched.sort((left, right) => compareConfigs(settings.sort, left, right))
    return matched
  }, [country, indexed, layout, protocol, query, security, settings.latencyThreshold, settings.sort, transport])

  const groups = useMemo(
    () => (layout === 'country' ? groupByCountry(filtered, countryOrder) : []),
    [countryOrder, filtered, layout],
  )

  const rows = useMemo(() => {
    if (layout === 'flat') {
      return filtered.map((config) => ({ kind: 'config' as const, key: config.id, config }))
    }
    const next: ListRow[] = []
    for (const group of groups) {
      const open = !collapsed.has(group.code)
      next.push({ kind: 'group', key: `g:${group.code}`, group, open })
      if (!open) continue
      for (const config of group.configs) next.push({ kind: 'config', key: config.id, config })
    }
    return next
  }, [collapsed, filtered, groups, layout])

  const prefix = useMemo(() => {
    const next = new Array<number>(rows.length + 1)
    next[0] = 0
    for (let index = 0; index < rows.length; index += 1) next[index + 1] = next[index] + rowHeight(rows[index])
    return next
  }, [rows])

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
    () => visible.filter((config) => picked.has(config.id)),
    [picked, visible],
  )
  const allFilteredPicked = filtered.length > 0 && filtered.every((config) => picked.has(config.id))
  const sessionFilters = [country, transport, security, protocol].filter(Boolean).length

  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleGroup(code: string) {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
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
      toast.error('Для QR выберите короткую подборку. Длинный список скачивается файлом.')
      return
    }
    setQr({
      title,
      value,
      share: 'text',
      actions: configs.length === 1 ? configImportActions(configs[0].uri) : undefined,
    })
  }

  const layoutNote =
    layout === 'country'
      ? `По странам · ${countryOrder === 'count' ? 'по числу' : 'по лучшему пингу'}`
      : sortLabel(settings.sort)

  return (
    <div className={cn('mx-auto w-full max-w-3xl px-4 pt-4', chosen.length > 0 && 'pb-36')}>
      <SiteHeader updated={formatStamp(data.generated_at)} />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat value={String(data.stats.published)} label="в списке" />
        <Stat value={String(data.stats.countries)} label="стран" />
        <Stat
          value={data.stats.median_latency_ms == null ? '—' : String(data.stats.median_latency_ms)}
          label="медиана, мс"
        />
        <Stat value={String(data.stats.proxy_ok ?? data.stats.published)} label="через Xray" />
      </div>
      <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">
        В списке только ответы HTTP через Xray или sing-box. Задержка и аптайм измерены сборщиком.
        Отметьте строки, чтобы выгрузить текст, base64, файл, QR, Clash или sing-box.
      </p>

      <div className="mb-3 flex flex-col gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Страна, адрес, транспорт"
            aria-label="Поиск конфигов"
            className="h-10 rounded-xl border-0 bg-card pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setFiltersOpen(true)}>
            <SlidersHorizontal />
            Фильтры
            {sessionFilters > 0 && <Badge variant="secondary">{sessionFilters}</Badge>}
          </Button>
          <button
            type="button"
            className={cn(
              'rounded-full px-3 py-1.5 text-[13px]',
              layout === 'country' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground',
            )}
            onClick={() => setLayout('country')}
          >
            По странам
          </button>
          <button
            type="button"
            className={cn(
              'rounded-full px-3 py-1.5 text-[13px]',
              layout === 'flat' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground',
            )}
            onClick={() => setLayout('flat')}
          >
            Списком
          </button>
          {layout === 'country' ? (
            <label className="text-[13px] text-muted-foreground">
              <span className="sr-only">Порядок стран</span>
              <select
                aria-label="Порядок стран"
                className="h-8 rounded-lg bg-secondary px-2 text-[13px]"
                value={countryOrder}
                onChange={(event) => setCountryOrder(event.target.value as CountryOrder)}
              >
                <option value="count">По числу</option>
                <option value="ping">По лучшему пингу</option>
              </select>
            </label>
          ) : (
            <label className="text-[13px] text-muted-foreground">
              <span className="sr-only">Сортировка</span>
              <select
                aria-label="Сортировка"
                className="h-8 rounded-lg bg-secondary px-2 text-[13px]"
                value={settings.sort}
                onChange={(event) => update({ sort: event.target.value as SortKey })}
              >
                {SORTS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {data.unverified.length > 0 && (
            <button
              type="button"
              className={cn(
                'rounded-full px-3 py-1.5 text-[13px]',
                showUnverified ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground',
              )}
              onClick={() => setShowUnverified((value) => !value)}
            >
              Непроверенные · {data.unverified.length}
            </button>
          )}
        </div>
        <p className="text-[12px] text-muted-foreground">
          {layoutNote}
          {settings.latencyThreshold != null ? ` · до ${settings.latencyThreshold} мс` : ''}
          {showUnverified ? ' · с непроверенными' : ''}
          {' · '}
          {filtered.length}
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl bg-card">
        <div className="flex items-center gap-3 px-4 py-3">
          <input
            type="checkbox"
            className="size-4"
            aria-label="Выбрать показанные"
            checked={allFilteredPicked}
            onChange={toggleFiltered}
          />
          <span className="text-[13px] font-medium tracking-wide text-muted-foreground uppercase">
            Конфиги
          </span>
          <Badge variant="secondary">{filtered.length}</Badge>
        </div>
        {filtered.length === 0 ? (
          <p className="px-4 pb-6 text-sm text-muted-foreground">Ничего не найдено.</p>
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
                <ConfigRow
                  key={row.key}
                  config={row.config}
                  checked={picked.has(row.config.id)}
                  onToggle={() => toggle(row.config.id)}
                  onOpen={() => setSelectedId(row.config)}
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

      {chosen.length > 0 && (
        <div className="fixed inset-x-0 bottom-[4.6rem] z-30 border-t border-border bg-background/95 px-3 py-2 backdrop-blur-md">
          <div className="mx-auto flex max-w-3xl flex-col gap-2">
            <div className="flex items-center justify-between text-[13px]">
              <span>Выбрано {chosen.length}</span>
              <button type="button" className="text-muted-foreground" onClick={() => setPicked(new Set())}>
                Снять
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button size="sm" variant="secondary" onClick={() => void copyText(configsToText(chosen), `Скопировано: ${chosen.length}`)}>
                Текст
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void copyText(configsToBase64(chosen), 'Base64 скопирован')}>
                Base64
              </Button>
              <Button size="sm" variant="secondary" onClick={() => downloadText('v2hub.txt', `${configsToText(chosen)}\n`)}>
                Файл
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
        config={selectedId}
        sources={data.sources}
        client={settings.client}
        desktop={desktop}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
        onQr={setQr}
      />
      <FilterSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        countries={countries}
        transports={transports}
        securities={securities}
        protocols={protocols}
        country={country}
        transport={transport}
        security={security}
        protocol={protocol}
        threshold={settings.latencyThreshold}
        onCountry={setCountry}
        onTransport={setTransport}
        onSecurity={setSecurity}
        onProtocol={setProtocol}
        onThreshold={(value) => update({ latencyThreshold: value })}
        onReset={() => {
          setCountry(null)
          setTransport(null)
          setSecurity(null)
          setProtocol(null)
        }}
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

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl bg-card px-3 py-3 text-center">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[12px] leading-tight text-muted-foreground">{label}</div>
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
      className="flex h-14 w-full items-center gap-2 border-t border-border px-3 text-left sm:px-4"
      aria-expanded={open}
      onClick={onToggle}
    >
      {open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
      <span className="grid w-6 shrink-0 place-items-center text-xl leading-none" aria-hidden>
        {flag || <Globe className="size-5 text-muted-foreground" />}
      </span>
      <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{group.name}</span>
      <Badge variant="secondary">{group.count}</Badge>
      <span className={cn('shrink-0 text-[13px] font-semibold tabular-nums', latencyClass(group.best))}>
        {latencyText(group.best)}
      </span>
    </button>
  )
}

function ConfigRow({
  config,
  checked,
  onToggle,
  onOpen,
  onQr,
}: {
  config: ConfigRecord
  checked: boolean
  onToggle: () => void
  onOpen: () => void
  onQr: () => void
}) {
  const title = configTitle(config)
  const flag = flagEmoji(config.country_code)
  const verified =
    config.verified === 'tcp' ? 'порт открыт' : config.verified === 'proxy' ? 'Xray' : ''
  return (
    <div className="flex h-[72px] items-center gap-2 border-t border-border px-3 sm:gap-3 sm:px-4">
      <input
        type="checkbox"
        className="size-4 shrink-0"
        aria-label={`Выбрать ${title}`}
        checked={checked}
        onChange={onToggle}
      />
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left sm:gap-3" onClick={onOpen}>
        <span className="grid w-6 shrink-0 place-items-center text-xl leading-none" aria-hidden>
          {flag || <Globe className="size-5 text-muted-foreground" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium sm:text-[16px]">
            {title}
            {config.country_code ? ` ${config.country_code}` : ''}
          </span>
          <span className="block truncate text-[12px] text-muted-foreground sm:text-[13px]">
            {protocolLine(config.transport, config.protocol)}
            {uptimeText(config.uptime) ? ` · ${uptimeText(config.uptime)}` : ''}
            {verified ? ` · ${verified}` : ''}
          </span>
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
