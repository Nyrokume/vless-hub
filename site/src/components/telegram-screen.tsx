import { useMemo, useState } from 'react'
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
import { isCore } from '@/lib/reach'
import { kindLabel, ru, statusLabel } from '@/lib/ru'
import type { HubData, ProxyRecord } from '@/lib/types'
import { cn } from '@/lib/utils'

export function TelegramScreen({ data }: { data: HubData }) {
  const [query, setQuery] = useState('')
  const [qr, setQr] = useState<QrRequest | null>(null)
  const [selected, setSelected] = useState<ProxyRecord | null>(null)
  const stats = data.stats.telegram
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
        const core = Number(isCore(right.bits)) - Number(isCore(left.bits))
        if (core !== 0) return core
        return (left.latency_ms ?? 9_999_999) - (right.latency_ms ?? 9_999_999)
      })
  }, [data.proxies, query])

  const best = filtered[0]
  const latency = displayedLatencyBounds(data.proxies)

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4">
      <SiteHeader updated={formatStamp(data.generated_at)} />
      <p className="text-[13px] text-muted-foreground">
        {ru.telegramCounts(stats?.mtproto ?? 0, stats?.socks ?? 0)}
        {' · '}
        <Freshness iso={data.generated_at} />
      </p>
      <p className="mb-3 mt-1">
        <LatencyRange min={latency.min} max={latency.max} />
      </p>
      {best && (
        <Button asChild className="mb-4 h-12 w-full text-[16px]">
          <a href={best.tg}>
            <Send />
            {ru.bestInTelegram(best.country_name || best.country || best.host, latencyText(best.latency_ms))}
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
  missing = false,
  onOpenChange,
  onQr,
}: {
  proxy: ProxyRecord | null
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
                <span className={cn('shrink-0 text-[15px] font-semibold tabular-nums', latencyClass(proxy.latency_ms))}>
                  {latencyText(proxy.latency_ms)}
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
  divided,
  onOpen,
  onQr,
}: {
  proxy: ProxyRecord
  divided: boolean
  onOpen: () => void
  onQr: () => void
}) {
  const title = proxy.country_name || proxy.country || proxy.host
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
          <p className="truncate text-[13px] text-foreground/75">
            {kindLabel(proxy.kind)} · {proxy.host}:{proxy.port}
            {stabilityText(proxy.stability) ? ` · ${stabilityText(proxy.stability)}` : ''}
          </p>
        </button>
        <span className={cn('text-[14px] font-semibold tabular-nums', latencyClass(proxy.latency_ms))}>
          {latencyText(proxy.latency_ms)}
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
