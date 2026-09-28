import { useMemo, useState } from 'react'
import { Globe, Info, QrCode, Search, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
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
  protocolLabel,
  protocolLine,
  uptimeText,
} from '@/lib/format'
import { SORTS, sortLabel, useSettings, type SortKey } from '@/lib/settings'
import type { ConfigRecord, HubData } from '@/lib/types'
import { useMediaQuery } from '@/lib/use-media'
import { cn } from '@/lib/utils'

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

  const visible = useMemo(
    () => (showUnverified ? [...data.configs, ...data.unverified] : data.configs),
    [data.configs, data.unverified, showUnverified],
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
    return visible
      .filter((config) => {
        if (
          settings.latencyThreshold != null &&
          (config.latency_ms == null || config.latency_ms > settings.latencyThreshold)
        ) {
          return false
        }
        if (country && config.country_code !== country) return false
        if (transport && config.transport !== transport) return false
        if (security && config.security !== security) return false
        if (protocol && (config.protocol || 'vless') !== protocol) return false
        if (!needle) return true
        return [config.country, config.country_code, config.host, config.remark, config.protocol, config.transport, config.security, config.sni, String(config.port)]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(needle)
      })
      .sort((left, right) => compareConfigs(settings.sort, left, right))
  }, [country, protocol, query, security, settings.latencyThreshold, settings.sort, transport, visible])

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
          {sortLabel(settings.sort)}
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
          filtered.map((config, index) => (
            <ConfigRow
              key={config.id}
              config={config}
              divided={index > 0}
              checked={picked.has(config.id)}
              onToggle={() => toggle(config.id)}
              onOpen={() => setSelectedId(config)}
              onQr={() =>
                setQr({
                  title: `${flagEmoji(config.country_code)} ${configTitle(config)}`.trim(),
                  value: config.uri,
                  share: 'text',
                  actions: configImportActions(config.uri),
                })
              }
            />
          ))
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

function ConfigRow({
  config,
  divided,
  checked,
  onToggle,
  onOpen,
  onQr,
}: {
  config: ConfigRecord
  divided: boolean
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
    <div>
      {divided && <Separator />}
      <div className="flex items-center gap-2 px-3 py-3 sm:gap-3 sm:px-4">
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
              {protocolLabel(config.protocol)} · {protocolLine(config.transport)}
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
    </div>
  )
}
