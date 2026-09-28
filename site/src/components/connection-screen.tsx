import { useMemo, useState } from 'react'
import {
  ChevronDown,
  Copy,
  EllipsisVertical,
  Globe,
  Info,
  List,
  Plus,
  QrCode,
  Search,
  Send,
  Shield,
  SlidersHorizontal,
  Zap,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
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
  ItemTitle,
} from '@/components/ui/item'
import { Separator } from '@/components/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ConfigSheet } from '@/components/config-sheet'
import { FilterSheet } from '@/components/filter-sheet'
import { QrDialog } from '@/components/qr-dialog'
import { SubscriptionSheet } from '@/components/subscription-sheet'
import { ProxySheet } from '@/components/proxy-sheet'
import {
  clientImportLinks,
  clientName,
  openSchemes,
  subscriptionDeepLink,
  type ClientId,
} from '@/lib/clients'
import { subscriptionUrl } from '@/lib/data'
import { DELAY_NOTE, SITE_NOTE } from '@/lib/notes'
import { copyText } from '@/lib/copy'
import {
  configTitle,
  delayText,
  flagEmoji,
  latencyClass,
  medianNumber,
  protocolLine,
  recordDelay,
} from '@/lib/format'
import { SORTS, sortLabel, useSettings, type SortKey } from '@/lib/settings'
import type { ConfigRecord, HubData, ProxyRecord, SubscriptionInfo } from '@/lib/types'
import { useMediaQuery } from '@/lib/use-media'
import { cn } from '@/lib/utils'

function shortServerName(config: ConfigRecord): string {
  const remark = config.remark.replace(/\s+/g, ' ').trim()
  const words = remark.replace(/[^\p{L}\p{N}.,-]+/gu, ' ').replace(/\s+/g, ' ').trim()
  if (words.length >= 2) return words.slice(0, 48)
  return config.host
}

const EMPTY_PROXIES: ProxyRecord[] = []

function compareConfigs(sort: SortKey, left: ConfigRecord, right: ConfigRecord): number {
  const leftDelay = recordDelay(left)
  const rightDelay = recordDelay(right)
  if (sort === 'latency-desc') return rightDelay - leftDelay || left.id.localeCompare(right.id)
  if (sort === 'country') {
    return (
      (left.country ?? 'яяя').localeCompare(right.country ?? 'яяя', 'ru') || leftDelay - rightDelay
    )
  }
  if (sort === 'transport') {
    return left.transport.localeCompare(right.transport) || leftDelay - rightDelay
  }
  return leftDelay - rightDelay || left.id.localeCompare(right.id)
}

function realMedian(items: { delay_ms?: number | null; latency_ms?: number | null; check?: string }[]): string {
  const real = items.filter((item) => item.check !== 'tcp')
  const median = medianNumber(real.map((item) => recordDelay(item)))
  if (median != null && real.length > 0) return `медиана ${median} мс`
  if (items.some((item) => item.check === 'tcp')) return 'проверка TCP'
  return 'нет данных'
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
  const desktop = useMediaQuery('(min-width: 1024px)')
  const [lane, setLane] = useState<'configs' | 'proxies'>('configs')
  const [query, setQuery] = useState('')
  const [country, setCountry] = useState<string | null>(null)
  const [transport, setTransport] = useState<string | null>(null)
  const [security, setSecurity] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(true)
  const [selected, setSelected] = useState<ConfigRecord | null>(null)
  const [selectedProxy, setSelectedProxy] = useState<ProxyRecord | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [subsOpen, setSubsOpen] = useState(false)
  const [activeSub, setActiveSub] = useState<SubscriptionInfo | null>(null)
  const [qr, setQr] = useState<{ title: string; value: string } | null>(null)

  const proxies = data.proxies ?? EMPTY_PROXIES
  const best = data.best ?? null
  const bestName = best ? shortServerName(best) : ''
  const mainSubscription = data.subscriptions.find((item) => item.id === 'all') ?? null
  const mainSubscriptionUrl = mainSubscription
    ? subscriptionUrl(settings.publicBase, mainSubscription.file)
    : ''

  function openInClient(client: ClientId) {
    const links = clientImportLinks(client, best?.uri ?? null, mainSubscriptionUrl || null)
    const fallback = [best?.uri, mainSubscriptionUrl].filter(Boolean).join('\n')
    const name = clientName(client)
    openSchemes(links, fallback, {
      desktop: `На этом устройстве ${name} не откроется. Скопированы конфиг и подписка.`,
      missed: `${name} не открылся. Скопированы конфиг и подписка: импортируйте их в приложении.`,
    })
  }

  function launchGroup(id: string) {
    if (id === 'mtproto') {
      const candidates = proxies.filter((item) => item.kind === 'mtproto')
      const target = [...candidates].sort((left, right) => {
        const leftRank = left.check === 'real' ? 0 : 1
        const rightRank = right.check === 'real' ? 0 : 1
        return leftRank - rightRank || left.delay_ms - right.delay_ms
      })[0]
      if (!target) return
      openSchemes([target.uri], target.uri, {
        desktop: 'На этом устройстве Telegram не откроется. Ссылка tg://proxy скопирована.',
        missed: 'Telegram не открылся. Ссылка tg://proxy скопирована.',
      })
      return
    }
    const subscription = data.subscriptions.find((item) => item.id === id) ?? null
    if (!subscription) return
    const url = subscriptionUrl(settings.publicBase, subscription.file)
    const link = subscriptionDeepLink(settings.client, url, subscription.name)
    if (!link) {
      void copyText(url, 'Ссылка подписки скопирована')
      return
    }
    const name = clientName(settings.client)
    openSchemes([link], url, {
      desktop: `На этом устройстве ${name} не откроется. Ссылка подписки скопирована.`,
      missed: `${name} не открылся. Ссылка подписки скопирована.`,
    })
  }

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
        if (settings.latencyThreshold != null && recordDelay(config) > settings.latencyThreshold) return false
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

  const filteredProxies = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return proxies
      .filter((proxy) => {
        if (settings.latencyThreshold != null && proxy.delay_ms > settings.latencyThreshold) return false
        if (country && proxy.country_code !== country) return false
        if (!needle) return true
        return [proxy.country, proxy.country_code, proxy.host, proxy.kind, String(proxy.port)]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(needle)
      })
      .sort((left, right) => {
        if (settings.sort === 'country') {
          return (left.country ?? 'яяя').localeCompare(right.country ?? 'яяя', 'ru') || left.delay_ms - right.delay_ms
        }
        if (settings.sort === 'latency-desc') return right.delay_ms - left.delay_ms
        return left.delay_ms - right.delay_ms
      })
  }, [country, proxies, query, settings.latencyThreshold, settings.sort])

  const fastConfigs = data.configs.filter((item) => recordDelay(item) <= data.fast_threshold_ms)
  const tiles = [
    { id: 'all', title: 'Все рабочие', icon: List, items: data.configs },
    { id: 'fast', title: 'Быстрые', icon: Zap, items: fastConfigs },
    { id: 'mtproto', title: 'Telegram MTProto', icon: Send, items: proxies.filter((item) => item.kind === 'mtproto') },
    { id: 'socks5', title: 'SOCKS5', icon: Shield, items: proxies.filter((item) => item.kind === 'socks5') },
  ]

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
              onSelect={() => {
                const lines = lane === 'configs' ? filtered.map((item) => item.uri) : filteredProxies.map((item) => item.uri)
                void copyText(lines.join('\n'), `Скопировано: ${lines.length}`)
              }}
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
          <BestServerCard
            best={best}
            bestName={bestName}
            subscriptionUrl={mainSubscriptionUrl}
            onOpen={openInClient}
            onCopy={() => best && void copyText(best.uri, 'Ссылка конфига скопирована')}
          />
          <div className="flex w-full max-w-md flex-col gap-2 text-sm text-muted-foreground">
            <p>{DELAY_NOTE}</p>
            <p>{SITE_NOTE}</p>
          </div>

          <Card className="w-full max-w-md">
            <CardContent className="grid grid-cols-2 gap-3 text-center">
              <Stat value={String(data.stats.published)} label="конфигов" />
              <Stat value={String(data.stats.proxies ?? proxies.length)} label="прокси" />
              <Stat value={String(data.stats.countries)} label="стран" />
              <Stat
                value={
                  (data.stats.median_delay_ms ?? data.stats.median_latency_ms) == null
                    ? '—'
                    : String(data.stats.median_delay_ms ?? data.stats.median_latency_ms)
                }
                label="медиана, мс"
              />
            </CardContent>
          </Card>

          <div className="grid w-full max-w-md grid-cols-2 gap-3">
            <p className="col-span-2 text-sm font-medium">Конфиги</p>
            {tiles.slice(0, 2).map((tile) => (
              <GroupTile
                key={tile.id}
                tile={tile}
                subscription={data.subscriptions.find((item) => item.id === tile.id) ?? null}
                actionLabel="В клиент"
                onOpen={openSubscription}
                onLaunch={() => launchGroup(tile.id)}
              />
            ))}
            <p className="col-span-2 text-sm font-medium">Прокси</p>
            {tiles.slice(2).map((tile) => (
              <GroupTile
                key={tile.id}
                tile={tile}
                subscription={data.subscriptions.find((item) => item.id === tile.id) ?? null}
                actionLabel={tile.id === 'mtproto' ? 'Telegram' : 'В клиент'}
                onOpen={openSubscription}
                onLaunch={() => launchGroup(tile.id)}
              />
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={() => openSubscription(null)}>
            Все подписки
            <Badge variant="secondary">{data.subscriptions.length}</Badge>
          </Button>
        </div>

        <div className="lg:sticky lg:top-3">
          <Collapsible open={expanded} onOpenChange={setExpanded}>
            <Card>
              <CardHeader>
                <CardTitle>
                  <CollapsibleTrigger className="flex items-center gap-2">
                    {lane === 'configs' ? 'Конфиги' : 'Прокси'}
                    <Badge variant="secondary">{lane === 'configs' ? filtered.length : filteredProxies.length}</Badge>
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
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    value={lane}
                    onValueChange={(value) => {
                      if (value === 'configs' || value === 'proxies') setLane(value)
                    }}
                    className="w-full"
                  >
                    <ToggleGroupItem value="configs" className="flex-1">
                      Конфиги
                    </ToggleGroupItem>
                    <ToggleGroupItem value="proxies" className="flex-1">
                      Прокси
                    </ToggleGroupItem>
                  </ToggleGroup>
                  <InputGroup>
                    <InputGroupAddon>
                      <Search />
                    </InputGroupAddon>
                    <InputGroupInput
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={lane === 'configs' ? 'Страна, адрес, транспорт' : 'Страна, адрес, тип'}
                      aria-label={lane === 'configs' ? 'Поиск конфигов' : 'Поиск прокси'}
                    />
                  </InputGroup>
                  <div className="lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto">
                    {lane === 'configs' ? (
                      filtered.length === 0 ? (
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
                      )
                    ) : filteredProxies.length === 0 ? (
                      <Empty>
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <Search />
                          </EmptyMedia>
                          <EmptyTitle>Нет прокси</EmptyTitle>
                          <EmptyDescription>Измените запрос или сбросьте фильтры.</EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    ) : (
                      <ItemGroup className="gap-0">
                        {filteredProxies.map((proxy, index) => (
                          <div key={proxy.id}>
                            {index > 0 && <Separator />}
                            <ProxyRow
                              proxy={proxy}
                              onOpen={() => setSelectedProxy(proxy)}
                              onQr={() => openQr(proxy.host, proxy.uri)}
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
        links={
          activeSub && (activeSub.id === 'mtproto' || activeSub.id === 'socks5' || activeSub.id === 'http')
            ? proxies
                .filter((item) => item.kind === activeSub.id)
                .map((item) => ({
                  title: `${item.country || item.host} · ${delayText(item)}`,
                  uri: item.uri,
                  telegram: item.kind === 'mtproto',
                }))
            : undefined
        }
      />
      <ProxySheet
        proxy={selectedProxy}
        desktop={desktop}
        onOpenChange={(open) => {
          if (!open) setSelectedProxy(null)
        }}
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

function BestServerCard({
  best,
  bestName,
  subscriptionUrl: subUrl,
  onOpen,
  onCopy,
}: {
  best: ConfigRecord | null
  bestName: string
  subscriptionUrl: string
  onOpen: (client: ClientId) => void
  onCopy: () => void
}) {
  const flag = best ? flagEmoji(best.country_code) : ''
  const place = best ? `${flag} ${best.country || best.country_code || ''}`.trim() : ''
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{best ? place || 'Лучший сервер' : 'Нет проверенного сервера'}</CardTitle>
        <CardDescription>
          {best ? `${recordDelay(best)} мс · ${bestName}` : 'Сборщик ещё не подтвердил ни один конфиг'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Button size="lg" className="w-full" disabled={!best || !subUrl} onClick={() => onOpen('v2raytun')}>
          <Zap data-icon="inline-start" />
          Открыть в v2RayTun
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={!best} onClick={() => onOpen('happ')}>
            Happ
          </Button>
          <Button variant="outline" size="sm" disabled={!best} onClick={() => onOpen('v2rayng')}>
            v2rayNG
          </Button>
          <Button variant="outline" size="sm" disabled={!best} onClick={() => onOpen('hiddify')}>
            Hiddify
          </Button>
          <Button variant="outline" size="sm" disabled={!best} onClick={onCopy}>
            <Copy data-icon="inline-start" />
            Скопировать
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function GroupTile({
  tile,
  subscription,
  actionLabel,
  onOpen,
  onLaunch,
}: {
  tile: {
    id: string
    title: string
    icon: typeof List
    items: { delay_ms?: number | null; latency_ms?: number | null; check?: string }[]
  }
  subscription: SubscriptionInfo | null
  actionLabel: string
  onOpen: (subscription: SubscriptionInfo | null) => void
  onLaunch: () => void
}) {
  const Icon = tile.icon
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-4" />
          {tile.title}
        </CardTitle>
        <CardDescription>
          {tile.items.length} · {realMedian(tile.items)}
        </CardDescription>
      </CardHeader>
      <CardFooter className="gap-2">
        <Button variant="outline" size="sm" className="flex-1" onClick={() => onOpen(subscription)}>
          Список
        </Button>
        <Button size="sm" className="flex-1" disabled={!subscription && tile.id !== 'mtproto'} onClick={onLaunch}>
          {actionLabel}
        </Button>
      </CardFooter>
    </Card>
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
        <span className={cn('text-sm font-medium tabular-nums', latencyClass(recordDelay(config)))}>
          {delayText(config)}
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

function ProxyRow({
  proxy,
  onOpen,
  onQr,
}: {
  proxy: ProxyRecord
  onOpen: () => void
  onQr: () => void
}) {
  const title = proxy.country || proxy.host
  const flag = flagEmoji(proxy.country_code)
  const kind = proxy.kind === 'mtproto' ? 'MTProto' : proxy.kind === 'socks5' ? 'SOCKS5' : 'HTTP'
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
            {proxy.country_code ? ` ${proxy.country_code}` : ''}
          </ItemTitle>
          <ItemDescription>
            {kind}
            {proxy.check === 'tcp' ? ' · TCP' : ' · real'}
          </ItemDescription>
        </button>
      </ItemContent>
      <ItemActions>
        <span className={cn('text-sm font-medium tabular-nums', proxy.check === 'real' && latencyClass(proxy.delay_ms))}>
          {delayText(proxy)}
        </span>
        <Button variant="ghost" size="icon-sm" aria-label={`QR-код ${title}`} onClick={onQr}>
          <QrCode />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={`Подробности ${title}`} onClick={onOpen}>
          <Info />
        </Button>
      </ItemActions>
    </Item>
  )
}
