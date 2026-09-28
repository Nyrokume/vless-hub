import { useMemo, useState } from 'react'
import { Copy, QrCode, Search, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { QrDialog, type QrRequest } from '@/components/qr-dialog'
import { SiteHeader } from '@/components/site-header'
import { copyText } from '@/lib/copy'
import { flagEmoji, formatStamp, latencyClass, latencyText, uptimeText } from '@/lib/format'
import { openExternal } from '@/lib/clients'
import type { HubData, ProxyRecord } from '@/lib/types'
import { cn } from '@/lib/utils'

export function TelegramScreen({ data }: { data: HubData }) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'all' | 'mtproto' | 'socks'>('all')
  const [country, setCountry] = useState('')
  const [qr, setQr] = useState<QrRequest | null>(null)
  const stats = data.stats.telegram

  const countries = useMemo(() => {
    const codes = new Set<string>()
    for (const proxy of data.proxies) {
      if (proxy.country) codes.add(proxy.country)
    }
    return [...codes].sort()
  }, [data.proxies])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return data.proxies
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
  }, [country, data.proxies, kind, query])

  const best = filtered[0]

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4">
      <SiteHeader updated={formatStamp(data.generated_at)} />
      <p className="mb-3 text-[13px] text-muted-foreground">
        MTProto {stats?.mtproto ?? 0} · SOCKS {stats?.socks ?? 0} · медиана{' '}
        {stats?.median_latency_ms == null ? '—' : stats.median_latency_ms} мс
      </p>
      {best && (
        <Button className="mb-4 w-full" onClick={() => openExternal(best.tg)}>
          <Send />
          Лучший в Telegram · {best.country || best.host} · {latencyText(best.latency_ms)}
        </Button>
      )}
      <div className="mb-3 flex flex-wrap gap-2">
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
            {item === 'all' ? 'Все' : item === 'mtproto' ? 'MTProto' : 'SOCKS'}
          </button>
        ))}
        <select
          aria-label="Страна"
          className="h-9 rounded-full bg-card px-3 text-[13px]"
          value={country}
          onChange={(event) => setCountry(event.target.value)}
        >
          <option value="">Все страны</option>
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
          placeholder="Адрес или страна"
          aria-label="Поиск прокси"
          className="h-10 rounded-xl border-0 bg-card pl-9"
        />
      </div>
      <div className="overflow-hidden rounded-2xl bg-card">
        {filtered.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Проверенных прокси нет.</p>
        ) : (
          filtered.map((proxy, index) => (
            <ProxyRow
              key={proxy.id}
              proxy={proxy}
              divided={index > 0}
              onQr={() =>
                setQr({
                  title: `${proxy.kind} ${proxy.host}`,
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
          <p className="truncate text-[16px] font-medium">
            {flagEmoji(proxy.country)} {title}
          </p>
          <p className="truncate text-[13px] text-muted-foreground">
            {proxy.kind} · {proxy.host}:{proxy.port}
            {uptimeText(proxy.uptime) ? ` · ${uptimeText(proxy.uptime)}` : ''}
          </p>
        </div>
        <span className={cn('text-[14px] font-semibold tabular-nums', latencyClass(proxy.latency_ms))}>
          {latencyText(proxy.latency_ms)}
        </span>
        <Button size="sm" aria-label={`Открыть ${title} в Telegram`} onClick={() => openExternal(proxy.tg)}>
          В Telegram
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Скопировать https"
          onClick={() => void copyText(proxy.https, 'HTTPS-ссылка скопирована')}
        >
          <Copy />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="QR прокси" onClick={onQr}>
          <QrCode />
        </Button>
      </div>
    </div>
  )
}
