import { useMemo, useState } from 'react'
import {
  Cable,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  EllipsisVertical,
  Globe,
  Info,
  Layers,
  List,
  Lock,
  Plus,
  QrCode,
  Radio,
  Search,
  Shield,
  SlidersHorizontal,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ConfigSheet } from '@/components/config-sheet'
import { FilterSheet } from '@/components/filter-sheet'
import { IconTile } from '@/components/icon-tile'
import { QrDialog } from '@/components/qr-dialog'
import { SubscriptionSheet } from '@/components/subscription-sheet'
import { copyText } from '@/lib/copy'
import { subscriptionUrl } from '@/lib/data'
import {
  configTitle,
  flagEmoji,
  formatElapsed,
  formatStamp,
  latencyClass,
  protocolLine,
} from '@/lib/format'
import { SORTS, sortLabel, useSettings, type SortKey } from '@/lib/settings'
import type { ConfigRecord, HubData, SubscriptionInfo } from '@/lib/types'
import { useMediaQuery } from '@/lib/use-media'
import { useNow } from '@/lib/use-now'
import { cn } from '@/lib/utils'

function featuredSubscriptions(subscriptions: SubscriptionInfo[]): SubscriptionInfo[] {
  const featured = subscriptions.filter((item) => item.id === 'all' || item.id === 'fast')
  return featured.length > 0 ? featured : subscriptions.slice(0, 2)
}

function subscriptionIcon(id: string): LucideIcon {
  switch (id) {
    case 'fast':
      return Zap
    case 'reality':
      return Shield
    case 'tls':
      return Lock
    case 'tcp':
      return Cable
    case 'ws':
      return Radio
    case 'grpc':
      return Workflow
    case 'xhttp':
      return Layers
    default:
      return List
  }
}

function compareConfigs(sort: SortKey, left: ConfigRecord, right: ConfigRecord): number {
  if (sort === 'latency-desc') return right.latency_ms - left.latency_ms || left.id.localeCompare(right.id)
  if (sort === 'country') {
    return (
      (left.country ?? 'яяя').localeCompare(right.country ?? 'яяя', 'ru') ||
      left.latency_ms - right.latency_ms
    )
  }
  if (sort === 'transport') {
    return left.transport.localeCompare(right.transport) || left.latency_ms - right.latency_ms
  }
  return left.latency_ms - right.latency_ms || left.id.localeCompare(right.id)
}

export function ConnectionScreen({
  data,
  onReload,
  onOpenSettings,
}: {
  data: HubData
  onReload: () => void
  onOpenSettings: () => void
}) {
  const { settings, update } = useSettings()
  const now = useNow()
  const desktop = useMediaQuery('(min-width: 1024px)')
  const [query, setQuery] = useState('')
  const [country, setCountry] = useState<string | null>(null)
  const [transport, setTransport] = useState<string | null>(null)
  const [security, setSecurity] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(true)
  const [selected, setSelected] = useState<ConfigRecord | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [subsOpen, setSubsOpen] = useState(false)
  const [activeSub, setActiveSub] = useState<SubscriptionInfo | null>(null)
  const [qr, setQr] = useState<{ title: string; value: string } | null>(null)

  const mainSub = data.subscriptions.find((item) => item.id === 'all') ?? data.subscriptions[0]
  const mainUrl = mainSub ? subscriptionUrl(settings.publicBase, mainSub.file) : ''

  const countries = useMemo(() => {
    const map = new Map<string, { code: string; name: string; count: number }>()
    for (const config of data.configs) {
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
  }, [data.configs])

  const transports = useMemo(() => {
    const map = new Map<string, number>()
    for (const config of data.configs) map.set(config.transport, (map.get(config.transport) ?? 0) + 1)
    return [...map.entries()]
      .map(([id, count]) => ({ id, count }))
      .sort((left, right) => right.count - left.count)
  }, [data.configs])

  const securities = useMemo(() => {
    const map = new Map<string, number>()
    for (const config of data.configs) map.set(config.security, (map.get(config.security) ?? 0) + 1)
    return [...map.entries()]
      .map(([id, count]) => ({ id, count }))
      .sort((left, right) => right.count - left.count)
  }, [data.configs])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return data.configs
      .filter((config) => {
        if (settings.latencyThreshold != null && config.latency_ms > settings.latencyThreshold) return false
        if (country && config.country_code !== country) return false
        if (transport && config.transport !== transport) return false
        if (security && config.security !== security) return false
        if (!needle) return true
        const haystack = [
          config.country,
          config.country_code,
          config.host,
          config.remark,
          config.transport,
          config.security,
          config.sni,
          String(config.port),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return haystack.includes(needle)
      })
      .sort((left, right) => compareConfigs(settings.sort, left, right))
  }, [country, data.configs, query, security, settings.latencyThreshold, settings.sort, transport])

  function openSubscription(subscription: SubscriptionInfo | null) {
    setActiveSub(subscription)
    setSubsOpen(true)
  }

  function openQr(title: string, value: string) {
    setQr({ title, value })
  }

  const sessionFilters = [country, transport, security].filter(Boolean).length

  return (
    <div className="mx-auto w-full max-w-6xl px-4 lg:px-6">
      <div className="mb-2 flex items-center justify-end gap-1 pt-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Подписки"
          onClick={() => openSubscription(null)}
        >
          <Plus className="size-6" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Меню">
              <EllipsisVertical className="size-6" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Сортировка</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={settings.sort}
              onValueChange={(value) => update({ sort: value as SortKey })}
            >
              {SORTS.map((item) => (
                <DropdownMenuRadioItem key={item.value} value={item.value}>
                  {item.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setFiltersOpen(true)}>
              <SlidersHorizontal />
              Фильтры
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                void copyText(
                  filtered.map((item) => item.uri).join('\n'),
                  `Скопировано конфигов: ${filtered.length}`,
                )
              }
            >
              <Copy />
              Копировать список
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onReload}>Обновить данные</DropdownMenuItem>
            <DropdownMenuItem onSelect={onOpenSettings}>Настройки</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:items-start lg:gap-8">
        <div>
          <div className="px-2 pt-4 text-center lg:pt-2">
            <p className="text-[17px] font-medium">С обновления</p>
            <p className="mt-1 font-light text-[44px] leading-none tracking-wide text-foreground tabular-nums">
              {formatElapsed(data.generated_at, now)}
            </p>
          </div>

          <div className="mt-6 flex flex-col items-center">
            <button
              type="button"
              className="grid size-[104px] place-items-center rounded-[32px] bg-card transition active:scale-95 disabled:opacity-50"
              disabled={!mainUrl}
              aria-label="Скопировать ссылку подписки"
              onClick={() => mainUrl && void copyText(mainUrl, 'Ссылка подписки скопирована')}
            >
              <span className="grid size-[72px] place-items-center rounded-full bg-good text-white dark:text-black">
                <Copy className="size-8" />
              </span>
            </button>
            <p className="mt-3 text-[13px] text-muted-foreground">Ссылка подписки</p>
            <button
              type="button"
              className="mt-3 inline-flex items-center gap-1 rounded-full bg-card px-4 py-2 text-[15px] font-medium"
              onClick={() => mainSub && openSubscription(mainSub)}
            >
              {data.stats.published} рабочих
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>
          </div>

          <div className="mx-auto mt-5 grid max-w-md grid-cols-3 gap-2 rounded-2xl bg-card px-2 py-3 text-center">
            <Stat value={String(data.stats.published)} label="в списке" />
            <Stat value={String(data.stats.countries)} label="стран" />
            <Stat
              value={data.stats.median_latency_ms == null ? '—' : String(data.stats.median_latency_ms)}
              label="медиана, мс"
            />
          </div>

          <div className="mx-auto mt-5 flex max-w-md flex-col gap-1">
            {featuredSubscriptions(data.subscriptions).map((subscription) => {
              const Icon = subscriptionIcon(subscription.id)
              return (
                <div key={subscription.id} className="mb-2">
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-2xl bg-card px-4 py-3.5 text-left"
                    onClick={() => openSubscription(subscription)}
                  >
                    <IconTile>
                      <Icon className="size-4" />
                    </IconTile>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[17px] font-medium">{subscription.name}</span>
                      <span className="block text-[13px] text-muted-foreground">
                        {subscription.count} конфигов
                      </span>
                    </span>
                    <ChevronRight className="size-5 text-muted-foreground/70" />
                  </button>
                  <div className="mt-1.5 flex items-center gap-1.5 px-1 text-[13px] text-muted-foreground">
                    <Clock className="size-3.5" />
                    <span>{formatStamp(data.generated_at)}</span>
                  </div>
                </div>
              )
            })}
            {data.subscriptions.length > featuredSubscriptions(data.subscriptions).length && (
              <button
                type="button"
                className="mb-2 flex w-full items-center justify-between rounded-2xl bg-card px-4 py-3 text-left text-[15px] text-primary"
                onClick={() => openSubscription(null)}
              >
                Все подписки
                <span className="text-muted-foreground">{data.subscriptions.length}</span>
              </button>
            )}
          </div>
        </div>

        <div className="mt-2 lg:sticky lg:top-3 lg:mt-0">
          <Collapsible open={expanded} onOpenChange={setExpanded}>
            <div className="overflow-hidden rounded-2xl bg-card">
              <div className="flex items-center gap-2 px-4 py-3">
                <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <span className="text-[13px] font-medium tracking-wide text-muted-foreground uppercase">
                    Конфигурации
                  </span>
                  <Badge variant="secondary">{filtered.length}</Badge>
                  <ChevronDown
                    className={cn(
                      'size-4 text-muted-foreground transition-transform',
                      expanded ? 'rotate-180' : '',
                    )}
                  />
                </CollapsibleTrigger>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="relative"
                  aria-label="Фильтры"
                  onClick={() => setFiltersOpen(true)}
                >
                  <SlidersHorizontal />
                  {sessionFilters > 0 && (
                    <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
                  )}
                </Button>
              </div>
              <CollapsibleContent>
                <div className="px-3 pb-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Страна, адрес, транспорт"
                      aria-label="Поиск конфигов"
                      className="h-10 rounded-xl border-0 bg-secondary pl-9"
                    />
                  </div>
                  <p className="px-1 pt-2 text-[12px] text-muted-foreground">
                    {sortLabel(settings.sort)}
                    {settings.latencyThreshold != null ? ` · до ${settings.latencyThreshold} мс` : ''}
                  </p>
                </div>
                <div className="lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto">
                  {filtered.length === 0 ? (
                    <p className="px-4 pb-6 text-sm text-muted-foreground">Ничего не найдено.</p>
                  ) : (
                    filtered.map((config, index) => (
                      <ConfigRow
                        key={config.id}
                        config={config}
                        divided={index > 0}
                        onOpen={() => setSelected(config)}
                        onQr={() =>
                          openQr(
                            `${flagEmoji(config.country_code)} ${configTitle(config)}`.trim(),
                            config.uri,
                          )
                        }
                      />
                    ))
                  )}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        </div>
      </div>

      <ConfigSheet
        config={selected}
        sources={data.sources}
        client={settings.client}
        desktop={desktop}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
        onQr={openQr}
      />
      <FilterSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        countries={countries}
        transports={transports}
        securities={securities}
        country={country}
        transport={transport}
        security={security}
        threshold={settings.latencyThreshold}
        onCountry={setCountry}
        onTransport={setTransport}
        onSecurity={setSecurity}
        onThreshold={(value) => update({ latencyThreshold: value })}
        onReset={() => {
          setCountry(null)
          setTransport(null)
          setSecurity(null)
        }}
      />
      <SubscriptionSheet
        open={subsOpen}
        title="Подписки"
        subscription={activeSub}
        subscriptions={data.subscriptions}
        configs={data.configs}
        fastMs={data.fast_threshold_ms}
        publicBase={settings.publicBase}
        client={settings.client}
        desktop={desktop}
        onOpenChange={setSubsOpen}
        onSelect={setActiveSub}
        onQr={openQr}
      />
      <QrDialog
        title={qr?.title ?? null}
        value={qr?.value ?? null}
        onOpenChange={(open) => {
          if (!open) setQr(null)
        }}
      />
    </div>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[12px] text-muted-foreground">{label}</div>
    </div>
  )
}

function ConfigRow({
  config,
  divided,
  onOpen,
  onQr,
}: {
  config: ConfigRecord
  divided: boolean
  onOpen: () => void
  onQr: () => void
}) {
  const title = configTitle(config)
  const flag = flagEmoji(config.country_code)
  return (
    <div>
      {divided && <Separator />}
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={onOpen}>
          <span className="grid w-7 place-items-center text-xl leading-none" aria-hidden>
            {flag || <Globe className="size-5 text-muted-foreground" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[16px] font-medium">
              {title}
              {config.country_code ? ` ${config.country_code}` : ''}
            </span>
            <span className="block text-[13px] text-muted-foreground">{protocolLine(config.transport)}</span>
          </span>
        </button>
        <span className={cn('text-[15px] font-semibold tabular-nums', latencyClass(config.latency_ms))}>
          {config.latency_ms} мс
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
