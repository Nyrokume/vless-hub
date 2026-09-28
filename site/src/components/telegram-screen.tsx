import { useMemo, useState } from 'react'
import { Copy, QrCode, Search, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { QrDialog, type QrRequest } from '@/components/qr-dialog'
import { SiteHeader } from '@/components/site-header'
import { copyText } from '@/lib/copy'
import { flagEmoji, formatStamp, latencyClass, latencyText, stabilityText } from '@/lib/format'
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

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4">
      <SiteHeader updated={formatStamp(data.generated_at)} />
      <p className="mb-3 text-[13px] text-muted-foreground">
        {ru.kinds.mtproto} {stats?.mtproto ?? 0} · {ru.kinds.socks} {stats?.socks ?? 0} · средний пинг{' '}
        <span className={cn('font-medium', latencyClass(stats?.median_latency_ms))}>
          {latencyText(stats?.median_latency_ms)}
        </span>
      </p>
      {best && (
        <Button className="mb-4 w-full" onClick={() => openExternal(best.tg)}>
          <Send />
          {ru.bestInTelegram(best.country || best.host, latencyText(best.latency_ms))}
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
            {ru.showUnstable} · {data.unstable_proxies?.length}
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
          <p className="px-4 py-6 text-sm text-muted-foreground">{ru.noProxies}</p>
        ) : (
          filtered.map((proxy, index) => (
            <ProxyRow
              key={proxy.id}
              proxy={proxy}
              divided={index > 0}
              onQr={() =>
                setQr({
                  title: `${kindLabel(proxy.kind)} ${proxy.host}`,
                  value: proxy.tg,
                  share: 'text',
                })
              }
            />
          ))
        )}
      </div>
      <QrDialog request={qr} onOpenChange={(open) => !open && setQr(null)} />
    </div>
  )
}

function ProxyRow({
  proxy,
  divided,
  onQr,
}: {
  proxy: ProxyRecord
  divided: boolean
  onQr: () => void
}) {
  const title = proxy.country_name || proxy.country || proxy.host
  return (
    <div>
      {divided && <Separator />}
      <div className="flex items-center gap-2 px-4 py-3">
        <div className="min-w-0 flex-1">
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
          <p className="truncate text-[13px] text-muted-foreground">
            {kindLabel(proxy.kind)} · {proxy.host}:{proxy.port}
            {stabilityText(proxy.stability) ? ` · ${stabilityText(proxy.stability)}` : ''}
          </p>
        </div>
        <span className={cn('text-[14px] font-semibold tabular-nums', latencyClass(proxy.latency_ms))}>
          {latencyText(proxy.latency_ms)}
        </span>
        <Button size="sm" aria-label={ru.openInTelegram(title)} onClick={() => openExternal(proxy.tg)}>
          {ru.inTelegram}
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
