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
import { LatencyRange } from '@/components/latency-range'
import { QrDialog, type QrRequest } from '@/components/qr-dialog'
import { SiteHeader } from '@/components/site-header'
import { copyText } from '@/lib/copy'
import { displayedLatencyBounds, flagEmoji, formatStamp, latencyClass, latencyText, stabilityText } from '@/lib/format'
import { formatCount } from '@/lib/plural'
import { kindLabel, ru, statusLabel } from '@/lib/ru'
import { openExternal } from '@/lib/clients'
import type { HubData, ProxyRecord } from '@/lib/types'
import { cn } from '@/lib/utils'

export function TelegramScreen({ data }: { data: HubData }) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'all' | 'mtproto' | 'socks'>('all')
  const [country, setCountry] = useState('')
  const [showUnstable, setShowUnstable] = useState(false)
  const [qr, setQr] = useState<QrRequest | null>(null)
  const [selected, setSelected] = useState<ProxyRecord | null>(null)
  const stats = data.stats.telegram
  const pool = showUnstable ? [...data.proxies, ...(data.unstable_proxies ?? [])] : data.proxies

  const countries = useMemo(() => {
    const codes = new Set<string>()
    for (const proxy of pool) {
      if (proxy.country) codes.add(proxy.country)
    }
    return [...codes].sort()
  }, [pool])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return pool
      .filter((proxy) => {
        if (kind !== 'all' && proxy.kind !== kind) return false
        if (country && proxy.country !== country) return false
        if (!needle) return true
        return [proxy.host, proxy.country, proxy.country_name, proxy.kind, String(proxy.port)]
          .join(' ')
          .toLowerCase()
          .includes(needle)
      })
      .sort((left, right) => (left.latency_ms ?? 9_999_999) - (right.latency_ms ?? 9_999_999))
  }, [country, kind, pool, query])

  const best = filtered[0]
  const latency = displayedLatencyBounds(data.proxies)

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4">
      <SiteHeader updated={formatStamp(data.generated_at)} />
      <p className="text-[13px] text-muted-foreground">
        {ru.telegramCounts(stats?.mtproto ?? 0, stats?.socks ?? 0)}
      </p>
      <p className="mb-3 mt-1">
        <LatencyRange min={latency.min} max={latency.max} />
      </p>
      {best && (
        <Button className="mb-4 w-full" onClick={() => openExternal(best.tg)}>
          <Send />
          {ru.bestInTelegram(best.country_name || best.country || best.host, latencyText(best.latency_ms))}
        </Button>
      )}
      <div className="mb-3 flex flex-wrap gap-2">
        {(data.unstable_proxies?.length ?? 0) > 0 && (
          <button
            type="button"
            className={cn(
              'rounded-full px-3 py-1.5 text-[13px]',
              showUnstable ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground',
            )}
            onClick={() => setShowUnstable((value) => !value)}
          >
            {ru.showUnstable} · {formatCount(data.unstable_proxies?.length ?? 0)}
          </button>
        )}
        {(['all', 'mtproto', 'socks'] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={cn(
              'rounded-full px-3 py-1.5 text-[13px]',
              kind === item ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground',
            )}
            onClick={() => setKind(item)}
          >
            {item === 'all' ? ru.kinds.all : kindLabel(item)}
          </button>
        ))}
        <select
          aria-label={ru.country}
          className="h-9 rounded-full bg-card px-3 text-[13px]"
          value={country}
          onChange={(event) => setCountry(event.target.value)}
        >
          <option value="">{ru.allCountries}</option>
          {countries.map((code) => (
            <option key={code} value={code}>
              {flagEmoji(code)} {code}
            </option>
          ))}
        </select>
      </div>
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
            action={{
              label: ru.resetFilters,
              onClick: () => {
                setQuery('')
                setKind('all')
                setCountry('')
                setShowUnstable(false)
              },
            }}
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
        proxy={selected}
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
  onOpenChange,
  onQr,
}: {
  proxy: ProxyRecord | null
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
          proxy.status === 'working' || proxy.status === 'unstable' || proxy.status === 'dead'
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
            <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
              <Button onClick={() => void copyText(proxy.https, ru.httpsCopied)}>
                <Copy />
                {ru.copyLink}
              </Button>
              <Button variant="secondary" onClick={() => onQr(proxy)}>
                <QrCode />
                {ru.qr}
              </Button>
              <Button variant="secondary" onClick={() => openExternal(proxy.tg)}>
                <Send />
                {ru.inTelegram}
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
          <p className="flex min-w-0 items-center gap-2 truncate text-[16px] font-medium">
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
        <Button size="sm" className="shrink-0 px-2 sm:px-3" aria-label={ru.openInTelegram(title)} onClick={() => openExternal(proxy.tg)}>
          <Send className="sm:hidden" />
          <span className="hidden sm:inline">{ru.inTelegram}</span>
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
