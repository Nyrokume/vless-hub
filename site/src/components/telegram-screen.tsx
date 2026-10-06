import { useEffect, useMemo, useRef, useState } from 'react'
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
import { displayedLatencyBounds, flagEmoji, formatStamp, latencyClass, latencyText, stabilityText } from '@/lib/format'
import { endpointKey, isCore, probeEndpoint, REACH_CONCURRENCY, type ReachHit } from '@/lib/reach'
import { useReach } from '@/lib/reach-context'
import { kindLabel, ru, statusLabel } from '@/lib/ru'
import type { HubData, ProxyRecord } from '@/lib/types'
import { cn } from '@/lib/utils'

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return
  let cursor = 0
  const lanes = Math.max(1, Math.min(limit, items.length))
  async function lane(): Promise<void> {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      await worker(items[index])
    }
  }
  await Promise.all(Array.from({ length: lanes }, () => lane()))
}

function userPing(hit: ReachHit | undefined, serverMs: number | null): string {
  if (hit && hit.status === 'open' && hit.ms != null) return latencyText(hit.ms)
  return latencyText(serverMs)
}

export function TelegramScreen({ data }: { data: HubData }) {
  const [query, setQuery] = useState('')
  const [qr, setQr] = useState<QrRequest | null>(null)
  const [selected, setSelected] = useState<ProxyRecord | null>(null)
  const [hits, setHits] = useState<Record<string, ReachHit>>({})
  const [scan, setScan] = useState({ done: 0, total: 0, found: 0 })
  const { book, remember } = useReach()
  const bookRef = useRef(book)
  bookRef.current = book
  const stats = data.stats.telegram
  const roster = useMemo(() => {
    const seen = new Set<string>()
    const targets: { host: string; port: number }[] = []
    for (const proxy of data.proxies) {
      if (!proxy.host || !proxy.port) continue
      const key = endpointKey(proxy.host, proxy.port)
      if (seen.has(key)) continue
      seen.add(key)
      targets.push({ host: proxy.host, port: proxy.port })
    }
    return targets
  }, [data.proxies])
  const rosterKey = roster.map((item) => endpointKey(item.host, item.port)).join('\n')

  useEffect(() => {
    let cancelled = false
    const known = bookRef.current.byEndpoint
    const seeded: Record<string, ReachHit> = {}
    let found = 0
    for (const target of roster) {
      const key = endpointKey(target.host, target.port)
      const hit = known[key]
      if (!hit || hit.status === 'skip') continue
      seeded[key] = hit
      if (hit.status === 'open') found += 1
    }
    setHits(seeded)
    const pending = roster.filter((target) => !seeded[endpointKey(target.host, target.port)])
    let done = Object.keys(seeded).length
    setScan({ done, total: roster.length, found })
    void runPool(pending, REACH_CONCURRENCY, async (target) => {
      if (cancelled) return
      const key = endpointKey(target.host, target.port)
      const hit = await probeEndpoint(target.host, target.port)
      if (cancelled) return
      setHits((current) => ({ ...current, [key]: hit }))
      remember({ [key]: hit })
      done += 1
      if (hit.status === 'open') found += 1
      setScan({ done, total: roster.length, found })
    })
    return () => {
      cancelled = true
    }
  }, [roster, rosterKey, remember])

  const liveSelected = selected
    ? ([...data.proxies, ...(data.unstable_proxies ?? [])].find((item) => item.id === selected.id) ?? null)
    : null
  const sheetProxy = liveSelected ?? selected
  const sheetMissing = Boolean(selected) && !liveSelected
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return data.proxies
      .filter((proxy) => {
        if (!needle) return true
        return [proxy.host, proxy.country, proxy.country_name, proxy.kind, String(proxy.port)]
          .join(' ')
          .toLowerCase()
          .includes(needle)
      })
      .sort((left, right) => {
        const leftHit = hits[endpointKey(left.host, left.port)]
        const rightHit = hits[endpointKey(right.host, right.port)]
        const leftOpen = leftHit?.status === 'open'
        const rightOpen = rightHit?.status === 'open'
        if (leftOpen !== rightOpen) return leftOpen ? -1 : 1
        if (leftOpen && rightOpen) return (leftHit?.ms ?? 9_999_999) - (rightHit?.ms ?? 9_999_999)
        const core = Number(isCore(right.bits)) - Number(isCore(left.bits))
        if (core !== 0) return core
        return (left.latency_ms ?? 9_999_999) - (right.latency_ms ?? 9_999_999)
      })
  }, [data.proxies, hits, query])

  const best = filtered[0]
  const bestHit = best ? hits[endpointKey(best.host, best.port)] : undefined
  const latency = displayedLatencyBounds(data.proxies)

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4">
      <SiteHeader updated={formatStamp(data.generated_at)} />
      <p className="text-[16px] text-foreground">
        {ru.telegramCounts(stats?.mtproto ?? 0, stats?.socks ?? 0)}
        {' · '}
        <Freshness iso={data.generated_at} />
      </p>
      {scan.total > 0 && <p className="mt-1 text-[16px] font-medium text-foreground">{ru.tgScan(scan.done, scan.total, scan.found)}</p>}
      <p className="mb-3 mt-1">
        <LatencyRange min={latency.min} max={latency.max} className="text-[16px]" />
      </p>
      {best && (
        <Button asChild className="mb-4 h-12 w-full text-[16px]">
          <a href={best.tg}>
            <Send />
            {ru.bestInTelegram(best.country_name || best.country || best.host, userPing(bestHit, best.latency_ms))}
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
              hit={hits[endpointKey(proxy.host, proxy.port)]}
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
        hit={sheetProxy ? hits[endpointKey(sheetProxy.host, sheetProxy.port)] : undefined}
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
  return (
    <div>
      {divided && <Separator />}
      <div className="flex items-center gap-2 px-4 py-3">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
          <p className="flex min-w-0 items-center gap-2 truncate text-[17px] font-semibold">
            {proxy.status === 'working' || proxy.status === 'unstable' ? (
              <span
                className={cn(
                  'inline-block size-2 shrink-0 rounded-full',
                  proxy.status === 'unstable' ? 'border border-foreground' : 'bg-foreground',
                )}
                aria-label={statusLabel(proxy.status)}
              />
            ) : null}
            <span className="truncate">
              {flagEmoji(proxy.country)} {title}
            </span>
          </p>
          <p className="truncate text-[15px] text-foreground/80">
            {kindLabel(proxy.kind)} · {proxy.host}:{proxy.port}
            {stable ? ` · ${stable}` : ''}
            {reach ? ` · ${reach}` : ''}
          </p>
        </button>
        <span className={cn('text-[16px] font-semibold tabular-nums', latencyClass(hit && hit.status === 'open' ? hit.ms : proxy.latency_ms))}>
          {userPing(hit, proxy.latency_ms)}
        </span>
        <Button asChild size="sm" className="h-10 shrink-0 px-3 text-[15px]">
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
  )
}
