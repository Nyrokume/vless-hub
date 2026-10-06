import { useEffect, useMemo, useState } from 'react'
import { Copy, QrCode, Search, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { EmptyState } from '@/components/empty-state'
import { Freshness } from '@/components/freshness'
import { LatencyRange } from '@/components/latency-range'
import { QrDialog, type QrRequest } from '@/components/qr-dialog'
import { SiteHeader } from '@/components/site-header'
import { copyText } from '@/lib/copy'
import { displayedLatencyBounds, flagEmoji, formatStamp, latencyClass, latencyText, shownPing, stabilityText } from '@/lib/format'
import { endpointKey, hitFresh, isCore, type ReachHit, type ReachTarget } from '@/lib/reach'
import { useReach } from '@/lib/reach-context'
import { kindLabel, ru, statusLabel } from '@/lib/ru'
import type { HubData, ProxyRecord } from '@/lib/types'
import { cn } from '@/lib/utils'

function userPing(hit: ReachHit | undefined, serverMs: number | null): string {
  if (hit && hit.status === 'open' && hit.ms != null) return latencyText(hit.ms)
  return latencyText(serverMs)
}

function reachRank(hit: ReachHit | undefined): number {
  if (hit?.status === 'open') return 0
  if (!hit) return 1
  return 2
}

export function TelegramScreen({ data }: { data: HubData }) {
  const [query, setQuery] = useState('')
  const [qr, setQr] = useState<QrRequest | null>(null)
  const [selected, setSelected] = useState<ProxyRecord | null>(null)
  const { book, fill } = useReach()
  const proxies = useMemo(
    () => data.proxies.filter((proxy) => shownPing(proxy.latency_ms) != null),
    [data.proxies],
  )
  const mtprotoCount = proxies.filter((proxy) => proxy.kind === 'mtproto').length
  const socksCount = proxies.filter((proxy) => proxy.kind === 'socks').length
  const roster = useMemo(() => {
    const seen = new Set<string>()
    const targets: ReachTarget[] = []
    for (const proxy of proxies) {
      if (!proxy.host || !proxy.port) continue
      const key = endpointKey(proxy.host, proxy.port)
      if (seen.has(key)) continue
      seen.add(key)
      targets.push({ host: proxy.host, port: proxy.port, country: proxy.country_name || proxy.country || undefined })
    }
    return targets
  }, [proxies])

  useEffect(() => {
    fill(roster)
  }, [roster, fill])

  const scan = useMemo(() => {
    const now = Date.now()
    let done = 0
    let found = 0
    for (const target of roster) {
      const hit = book.byEndpoint[endpointKey(target.host, target.port)]
      if (!hitFresh(hit, now)) continue
      done += 1
      if (hit?.status === 'open') found += 1
    }
    return { done, total: roster.length, found }
  }, [book, roster])

  function hitFor(host: string, port: number): ReachHit | undefined {
    return book.byEndpoint[endpointKey(host, port)]
  }

  const liveSelected = selected
    ? ([...data.proxies, ...(data.unstable_proxies ?? [])].find((item) => item.id === selected.id) ?? null)
    : null
  const sheetProxy = liveSelected ?? selected
  const sheetMissing = Boolean(selected) && !liveSelected
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return proxies
      .filter((proxy) => {
        if (!needle) return true
        return [proxy.host, proxy.country, proxy.country_name, proxy.kind, String(proxy.port)]
          .join(' ')
          .toLowerCase()
          .includes(needle)
      })
      .sort((left, right) => {
        const leftHit = hitFor(left.host, left.port)
        const rightHit = hitFor(right.host, right.port)
        const rank = reachRank(leftHit) - reachRank(rightHit)
        if (rank !== 0) return rank
        if (leftHit?.status === 'open' && rightHit?.status === 'open') {
          return (leftHit.ms ?? 9_999_999) - (rightHit.ms ?? 9_999_999)
        }
        const core = Number(isCore(right.bits)) - Number(isCore(left.bits))
        if (core !== 0) return core
        return (left.latency_ms ?? 9_999_999) - (right.latency_ms ?? 9_999_999)
      })
  }, [book, proxies, query])

  const best = filtered[0]
  const bestHit = best ? hitFor(best.host, best.port) : undefined
  const latency = displayedLatencyBounds(proxies)

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4">
      <SiteHeader updated={formatStamp(data.generated_at)} />
      <p className="text-[16px] text-foreground">
        {ru.telegramCounts(mtprotoCount, socksCount)}
        {' · '}
        <Freshness iso={data.generated_at} />
      </p>
      {scan.total > 0 && <p className="mt-1 text-[16px] font-medium text-foreground">{ru.tgScan(scan.done, scan.total, scan.found)}</p>}
      <p className="mb-3 mt-1">
        <LatencyRange min={latency.min} max={latency.max} className="text-[16px]" />
      </p>
      {best && (
        <Button asChild className="mb-4 h-12 w-full max-w-full overflow-hidden text-[16px]">
          <a href={best.tg}>
            <Send />
            <span className="min-w-0 truncate">
              {ru.bestInTelegram(best.country_name || best.country || best.host, userPing(bestHit, best.latency_ms))}
            </span>
          </a>
        </Button>
      )}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={ru.searchProxiesPlaceholder}
          aria-label={ru.searchProxies}
          className="h-10 rounded-xl border-0 bg-card pl-9"
        />
      </div>
      <div className="overflow-hidden rounded-2xl bg-card">
        {filtered.length === 0 ? (
          <EmptyState
            text={ru.nothingFound}
          />
        ) : (
          filtered.map((proxy, index) => (
            <ProxyRow
              key={proxy.id}
              proxy={proxy}
              hit={hitFor(proxy.host, proxy.port)}
              divided={index > 0}
              onOpen={() => setSelected(proxy)}
              onQr={() =>
                setQr({
                  title: `${flagEmoji(proxy.country)} ${proxy.country_name || proxy.country || proxy.host}`.trim(),
                  value: proxy.https,
                  share: 'url',
                })
              }
            />
          ))
        )}
      </div>
      <ProxySheet
        proxy={sheetProxy}
        hit={sheetProxy ? hitFor(sheetProxy.host, sheetProxy.port) : undefined}
        missing={sheetMissing}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
        onQr={(proxy) =>
          setQr({
            title: `${flagEmoji(proxy.country)} ${proxy.country_name || proxy.country || proxy.host}`.trim(),
            value: proxy.https,
            share: 'url',
          })
        }
      />
      <QrDialog request={qr} onOpenChange={(open) => !open && setQr(null)} />
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="w-32 shrink-0 text-[13px] leading-5 text-foreground/75">{label}</div>
      <div className="min-w-0 flex-1 text-[15px] leading-5 break-all text-foreground">{value}</div>
    </div>
  )
}

function ProxySheet({
  proxy,
  hit,
  missing = false,
  onOpenChange,
  onQr,
}: {
  proxy: ProxyRecord | null
  hit?: ReachHit
  missing?: boolean
  onOpenChange: (open: boolean) => void
  onQr: (proxy: ProxyRecord) => void
}) {
  const title = proxy ? proxy.country_name || proxy.country || proxy.host : ''
  const flag = proxy ? flagEmoji(proxy.country) : ''
  const rows = proxy
    ? [
        [ru.fields.address, proxy.host],
        [ru.fields.port, String(proxy.port)],
        [ru.fields.connection, kindLabel(proxy.kind)],
        [
          ru.fields.status,
          missing
            ? ru.noLongerWorks
            : proxy.status === 'working' || proxy.status === 'unstable' || proxy.status === 'dead'
              ? statusLabel(proxy.status)
              : '',
        ],
        [ru.fields.stability, stabilityText(proxy.stability)],
        [ru.fields.yours, hit?.status === 'open' ? ru.reachOpen : hit?.status === 'closed' ? ru.reachClosed : ''],
      ].filter(([, value]) => value)
    : []

  return (
    <Sheet open={Boolean(proxy)} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="gap-0 overflow-hidden p-0">
        {proxy && (
          <div className="max-h-[inherit] overflow-y-auto">
            <SheetHeader className="pr-12 text-left">
              <SheetTitle className="flex items-center gap-2.5 text-[22px] leading-tight font-semibold">
                <span className="text-[28px] leading-none" aria-hidden>
                  {flag || '🌐'}
                </span>
                <span className="min-w-0 break-words">{title}</span>
              </SheetTitle>
              <SheetDescription className="flex items-center justify-between gap-3 text-[14px] text-foreground/75">
                <span>{kindLabel(proxy.kind)}</span>
                <span className={cn('shrink-0 text-[16px] font-semibold tabular-nums', latencyClass(hit && hit.status === 'open' ? hit.ms : proxy.latency_ms))}>
                  {userPing(hit, proxy.latency_ms)}
                </span>
              </SheetDescription>
            </SheetHeader>
            {missing && <p className="px-4 pb-3 text-[15px] font-medium text-foreground">{ru.noLongerWorks}</p>}
            <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
              <Button onClick={() => void copyText(proxy.https, ru.httpsCopied)}>
                <Copy />
                {ru.copyLink}
              </Button>
              <Button variant="secondary" onClick={() => onQr(proxy)}>
                <QrCode />
                {ru.qr}
              </Button>
              <Button asChild variant="secondary">
                <a href={proxy.tg}>
                  <Send />
                  {ru.inTelegram}
                </a>
              </Button>
            </div>
            <div className="mx-4 mb-6 overflow-hidden rounded-2xl bg-secondary/60">
              {rows.map(([label, value], index) => (
                <div key={label}>
                  {index > 0 && <Separator />}
                  <Field label={label} value={value} />
                </div>
              ))}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function ProxyRow({
  proxy,
  hit,
  divided,
  onOpen,
  onQr,
}: {
  proxy: ProxyRecord
  hit?: ReachHit
  divided: boolean
  onOpen: () => void
  onQr: () => void
}) {
  const title = proxy.country_name || proxy.country || proxy.host
  const reach = hit?.status === 'open' ? ru.reachOpen : hit?.status === 'closed' ? ru.reachClosed : ''
  const stable = stabilityText(proxy.stability)
  const pingMs = hit && hit.status === 'open' && hit.ms != null ? hit.ms : proxy.latency_ms
  return (
    <div>
      {divided && <Separator />}
      <div className="px-4 py-3">
        <button type="button" className="block w-full text-left" onClick={onOpen}>
          <span className="flex items-start justify-between gap-3">
            <span className="flex min-w-0 flex-1 items-start gap-2 text-[17px] leading-6 font-semibold break-words">
              {proxy.status === 'working' || proxy.status === 'unstable' ? (
                <span
                  className={cn(
                    'mt-2 inline-block size-2 shrink-0 rounded-full',
                    proxy.status === 'unstable' ? 'border border-foreground' : 'bg-foreground',
                  )}
                  aria-label={statusLabel(proxy.status)}
                />
              ) : null}
              <span className="min-w-0 break-words">
                {flagEmoji(proxy.country)} {title}
              </span>
            </span>
            <span data-ping className={cn('shrink-0 pt-0.5 text-[16px] font-semibold tabular-nums', latencyClass(pingMs))}>
              {userPing(hit, proxy.latency_ms)}
            </span>
          </span>
          <span className="mt-1 block text-[15px] leading-5 text-foreground/80">
            {kindLabel(proxy.kind)}
            {stable ? ` · ${stable}` : ''}
          </span>
          <span data-address className="block text-[15px] leading-5 break-all text-foreground">
            {proxy.host}:{proxy.port}
          </span>
          {reach ? <span data-status className="mt-0.5 block text-[15px] leading-5 font-medium text-foreground">{reach}</span> : null}
        </button>
        <div data-actions className="mt-2 flex flex-wrap items-center gap-1">
          <Button asChild size="sm" className="h-10 px-3 text-[15px]">
            <a href={proxy.tg} aria-label={ru.openInTelegram(title)}>
              {ru.inTelegram}
            </a>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={ru.copyHttps}
            onClick={() => void copyText(proxy.https, ru.httpsCopied)}
          >
            <Copy />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={ru.qrProxy} onClick={onQr}>
            <QrCode />
          </Button>
        </div>
      </div>
    </div>
  )
}
