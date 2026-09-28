import { useMemo, useState } from 'react'
import {
  Cable,
  ChevronDown,
  ChevronRight,
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
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from '@/components/ui/item'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ConfigSheet } from '@/components/config-sheet'
import { FilterSheet } from '@/components/filter-sheet'
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
  const featured = featuredSubscriptions(data.subscriptions)

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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4 lg:px-6">
      <div className="flex items-center justify-end gap-1">
        <Button variant="ghost" size="icon" aria-label="Подписки" onClick={() => openSubscription(null)}>
          <Plus />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Меню">
              <EllipsisVertical />
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

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:gap-8">
        <div className="flex flex-col items-center gap-4">
          <div className="flex flex-col items-center gap-1 text-center">
            <p className="text-sm font-medium text-muted-foreground">С обновления</p>
            <p className="text-4xl font-medium tracking-wide text-foreground tabular-nums">
              {formatElapsed(data.generated_at, now)}
            </p>
          </div>

          <div className="flex flex-col items-center gap-3">
            <Button
              size="lg"
              className="size-24 rounded-full"
              disabled={!mainUrl}
              aria-label="Скопировать ссылку подписки"
              onClick={() => mainUrl && void copyText(mainUrl, 'Ссылка подписки скопирована')}
            >
              <Copy className="size-8" />
            </Button>
            <p className="text-sm text-muted-foreground">Ссылка подписки</p>
            <Button
              variant="secondary"
              className="rounded-full"
              onClick={() => mainSub && openSubscription(mainSub)}
            >
              {data.stats.published} рабочих
              <ChevronRight data-icon="inline-end" />
            </Button>
          </div>

          <Card className="w-full max-w-md">
            <CardContent className="grid grid-cols-3 gap-2 text-center">
              <Stat value={String(data.stats.published)} label="в списке" />
              <Stat value={String(data.stats.countries)} label="стран" />
              <Stat
                value={data.stats.median_latency_ms == null ? '—' : String(data.stats.median_latency_ms)}
                label="медиана, мс"
              />
            </CardContent>
          </Card>

          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Подписки</CardTitle>
              <CardDescription>{formatStamp(data.generated_at)}</CardDescription>
              <CardAction>
                <Button variant="outline" size="sm" onClick={() => openSubscription(null)}>
                  Все
                  <Badge variant="secondary">{data.subscriptions.length}</Badge>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <ItemGroup className="gap-2">
                {featured.map((subscription, index) => {
                  const Icon = subscriptionIcon(subscription.id)
                  return (
                    <div key={subscription.id}>
                      {index > 0 && <ItemSeparator />}
                      <Item variant="outline" asChild>
                        <button type="button" onClick={() => openSubscription(subscription)}>
                          <ItemMedia variant="icon">
                            <Icon />
                          </ItemMedia>
                          <ItemContent>
                            <ItemTitle>{subscription.name}</ItemTitle>
                            <ItemDescription>{subscription.count} конфигов</ItemDescription>
                          </ItemContent>
                          <ChevronRight />
                        </button>
                      </Item>
                    </div>
                  )
                })}
              </ItemGroup>
            </CardContent>
          </Card>
        </div>

        <div className="lg:sticky lg:top-3">
          <Collapsible open={expanded} onOpenChange={setExpanded}>
            <Card>
              <CardHeader>
                <CardTitle>
                  <CollapsibleTrigger className="flex items-center gap-2">
                    Конфигурации
                    <Badge variant="secondary">{filtered.length}</Badge>
                    <ChevronDown
                      className={cn('transition-transform', expanded && 'rotate-180')}
                    />
                  </CollapsibleTrigger>
                </CardTitle>
                <CardDescription>
                  {sortLabel(settings.sort)}
                  {settings.latencyThreshold != null ? ` · до ${settings.latencyThreshold} мс` : ''}
                </CardDescription>
                <CardAction>
                  <Button
                    variant="outline"
                    size="icon"
                    className="relative"
                    aria-label="Фильтры"
                    onClick={() => setFiltersOpen(true)}
                  >
                    <SlidersHorizontal />
                    {sessionFilters > 0 && (
                      <Badge className="absolute -top-2 -right-2 px-1">{sessionFilters}</Badge>
                    )}
                  </Button>
                </CardAction>
              </CardHeader>
              <CollapsibleContent>
                <CardContent className="flex flex-col gap-3">
                  <InputGroup>
                    <InputGroupAddon>
                      <Search />
                    </InputGroupAddon>
                    <InputGroupInput
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Страна, адрес, транспорт"
                      aria-label="Поиск конфигов"
                    />
                  </InputGroup>
                  <div className="lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto">
                    {filtered.length === 0 ? (
                      <Empty>
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <Search />
                          </EmptyMedia>
                          <EmptyTitle>Ничего не найдено</EmptyTitle>
                          <EmptyDescription>Измените запрос или сбросьте фильтры.</EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    ) : (
                      <ItemGroup className="gap-0">
                        {filtered.map((config, index) => (
                          <div key={config.id}>
                            {index > 0 && <Separator />}
                            <ConfigRow
                              config={config}
                              onOpen={() => setSelected(config)}
                              onQr={() =>
                                openQr(
                                  `${flagEmoji(config.country_code)} ${configTitle(config)}`.trim(),
                                  config.uri,
                                )
                              }
                            />
                          </div>
                        ))}
                      </ItemGroup>
                    )}
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
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
    <div className="flex flex-col gap-1">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

function ConfigRow({
  config,
  onOpen,
  onQr,
}: {
  config: ConfigRecord
  onOpen: () => void
  onQr: () => void
}) {
  const title = configTitle(config)
  const flag = flagEmoji(config.country_code)
  return (
    <Item>
      <ItemMedia>
        <span className="text-xl leading-none" aria-hidden>
          {flag || <Globe />}
        </span>
      </ItemMedia>
      <ItemContent>
        <button type="button" className="text-left" onClick={onOpen}>
          <ItemTitle>
            {title}
            {config.country_code ? ` ${config.country_code}` : ''}
          </ItemTitle>
          <ItemDescription>{protocolLine(config.transport)}</ItemDescription>
        </button>
      </ItemContent>
      <ItemActions>
        <span className={cn('text-sm font-medium tabular-nums', latencyClass(config.latency_ms))}>
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
      </ItemActions>
    </Item>
  )
}
