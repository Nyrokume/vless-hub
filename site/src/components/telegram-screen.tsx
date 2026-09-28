import { useMemo, useState } from 'react'
import { Copy, QrCode, Search, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Separator } from '@/components/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
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
      <SiteHeader />
      <p className="mb-2 text-xs text-muted-foreground">
        {formatStamp(data.generated_at)} · MTProto {stats?.mtproto ?? 0} · SOCKS {stats?.socks ?? 0} · медиана{' '}
        {stats?.median_latency_ms == null ? '—' : Math.round(stats.median_latency_ms)} мс
      </p>
      {best && (
        <Button className="mb-3 w-full" onClick={() => openExternal(best.tg)}>
          <Send />
          Лучший · {best.country || best.host} · {latencyText(best.latency_ms)}
        </Button>
      )}
      <div className="mb-3 flex items-center gap-2">
        <InputGroup className="min-w-0 flex-1 bg-card">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Адрес или страна"
            aria-label="Поиск прокси"
          />
        </InputGroup>
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={0}
          value={kind}
          onValueChange={(value) => {
            if (value === 'all' || value === 'mtproto' || value === 'socks') setKind(value)
          }}
          aria-label="Тип прокси"
        >
          <ToggleGroupItem value="all">Все</ToggleGroupItem>
          <ToggleGroupItem value="mtproto">MT</ToggleGroupItem>
          <ToggleGroupItem value="socks">SOCKS</ToggleGroupItem>
        </ToggleGroup>
        <select
          aria-label="Страна"
          className="h-8 shrink-0 rounded-lg border border-input bg-card px-2 text-sm"
          value={country}
          onChange={(event) => setCountry(event.target.value)}
        >
          <option value="">Страна</option>
          {countries.map((code) => (
            <option key={code} value={code}>
              {flagEmoji(code)} {code}
            </option>
          ))}
        </select>
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
