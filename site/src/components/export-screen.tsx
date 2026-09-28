import { useMemo, useState, type ReactNode } from 'react'
import { Copy, ExternalLink, QrCode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { QrDialog, type QrRequest } from '@/components/qr-dialog'
import { SiteHeader } from '@/components/site-header'
import { SubscriptionBuilder } from '@/components/subscription-sheet'
import {
  clientName,
  openExternal,
  subscriptionDeepLink,
  subscriptionImportActions,
} from '@/lib/clients'
import { copyText } from '@/lib/copy'
import { publicFileUrl } from '@/lib/data'
import { flagEmoji, formatStamp, protocolLabel, securityLabel, transportLabel } from '@/lib/format'
import { useSettings } from '@/lib/settings'
import type { CatalogEntry, HubData } from '@/lib/types'

const SLICE_ORDER = ['all', 'top', 'unverified']

export function ExportScreen({ data }: { data: HubData }) {
  const { settings } = useSettings()
  const [qr, setQr] = useState<QrRequest | null>(null)
  const names = useMemo(() => {
    const map = new Map<string, string>()
    for (const config of data.configs) {
      if (config.country_code && config.country) map.set(config.country_code, config.country)
    }
    return map
  }, [data.configs])

  const plain = data.catalog.filter((item) => item.format === 'plain' || item.format === 'clash' || item.format === 'singbox')
  const byKind = (kind: string) => plain.filter((item) => item.kind === kind)
  const slices = plain
    .filter(
      (item) =>
        SLICE_ORDER.includes(item.kind) && item.path !== 'sub/verified.txt' && item.path !== 'sub/top.txt',
    )
    .sort(
      (left, right) =>
        SLICE_ORDER.indexOf(left.kind) - SLICE_ORDER.indexOf(right.kind) || (left.top ?? 0) - (right.top ?? 0),
    )
  const countries = byKind('country').sort(
    (left, right) => right.count - left.count || (left.country ?? '').localeCompare(right.country ?? ''),
  )
  const protocols = byKind('protocol').sort(
    (left, right) => right.count - left.count || (left.protocol ?? '').localeCompare(right.protocol ?? ''),
  )
  const security = byKind('security').sort((left, right) => right.count - left.count)
  const transports = byKind('transport').sort((left, right) => right.count - left.count)
  const clash = byKind('clash')
  const singbox = byKind('singbox')

  function titleOf(entry: CatalogEntry): string {
    if (entry.kind === 'all') return 'Все проверенные'
    if (entry.kind === 'unverified') return 'Только открытый порт'
    if (entry.kind === 'top') return `Топ ${entry.top ?? entry.count}`
    if (entry.kind === 'clash') return 'Clash'
    if (entry.kind === 'singbox') return 'sing-box'
    if (entry.kind === 'country') {
      const code = entry.country ?? ''
      return `${flagEmoji(code)} ${names.get(code) || code}`.trim()
    }
    if (entry.kind === 'protocol') return protocolLabel(entry.protocol)
    if (entry.kind === 'security') return securityLabel(entry.security ?? '')
    if (entry.kind === 'transport') return transportLabel(entry.network ?? '')
    return entry.path
  }

  function openQr(entry: CatalogEntry) {
    const url = publicFileUrl(settings.publicBase, entry.path)
    const clientFile = entry.format === 'plain' || entry.format === 'clash' || entry.format === 'singbox'
    setQr({
      title: titleOf(entry),
      value: url,
      share: 'url',
      actions: clientFile && entry.kind !== 'unverified' ? subscriptionImportActions(url, 'V2Hub') : undefined,
    })
  }

  function openInClient(entry: CatalogEntry) {
    const url = publicFileUrl(settings.publicBase, entry.path)
    const link = subscriptionDeepLink(settings.client, url, 'V2Hub')
    if (link) openExternal(link)
    else void copyText(url, 'Для этого клиента есть только ссылка')
  }

  const groups: { title: string; entries: CatalogEntry[]; client: boolean }[] = [
    { title: 'Срезы', entries: slices, client: true },
    { title: 'Страны', entries: countries, client: true },
    { title: 'Защита', entries: security, client: true },
    { title: 'Транспорт', entries: transports, client: true },
    { title: 'Протоколы', entries: protocols, client: true },
    { title: 'Clash', entries: clash, client: true },
    { title: 'sing-box', entries: singbox, client: true },
  ]

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pt-4 pb-8">
      <SiteHeader updated={formatStamp(data.generated_at)} />

      {groups.map(
        (group) =>
          group.entries.length > 0 && (
            <Section key={group.title} title={group.title}>
              {group.entries.map((entry, index) => (
                <FileRow
                  key={entry.path}
                  divided={index > 0}
                  title={titleOf(entry)}
                  detail={String(entry.count)}
                  onCopy={() => void copyText(publicFileUrl(settings.publicBase, entry.path), 'Ссылка скопирована')}
                  onQr={() => openQr(entry)}
                  onClient={group.client && entry.kind !== 'unverified' ? () => openInClient(entry) : undefined}
                  clientLabel={clientName(settings.client)}
                />
              ))}
            </Section>
          ),
      )}

      {data.stats.telegram && (
        <Section title="Telegram">
          {[
            ['MTProto', 'tg/mtproto.txt', data.stats.telegram.mtproto],
            ['SOCKS', 'tg/socks.txt', data.stats.telegram.socks],
            ['Все tg://', 'tg/all.txt', data.stats.telegram.published],
            ['HTTPS', 'tg/https.txt', data.stats.telegram.published],
          ].map(([title, path, count], index) => (
            <FileRow
              key={String(path)}
              divided={index > 0}
              title={String(title)}
              detail={String(count)}
              onCopy={() => void copyText(publicFileUrl(settings.publicBase, String(path)), 'Ссылка скопирована')}
              onQr={() =>
                setQr({
                  title: String(title),
                  value: publicFileUrl(settings.publicBase, String(path)),
                  share: 'url',
                })
              }
            />
          ))}
        </Section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="px-1 text-[13px] font-medium tracking-wide text-muted-foreground uppercase">Подписка</h2>
        <SubscriptionBuilder
          configs={data.configs}
          catalog={data.catalog}
          publicBase={settings.publicBase}
          onQr={setQr}
        />
      </section>
      <QrDialog request={qr} onOpenChange={(open) => !open && setQr(null)} />
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-[13px] font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
      <div className="overflow-hidden rounded-2xl bg-card">{children}</div>
    </section>
  )
}

function FileRow({
  divided,
  title,
  detail,
  onCopy,
  onQr,
  onClient,
  clientLabel,
}: {
  divided: boolean
  title: string
  detail: string
  onCopy: () => void
  onQr: () => void
  onClient?: () => void
  clientLabel?: string
}) {
  return (
    <div>
      {divided && <Separator />}
      <div className="flex items-center gap-2 px-3 py-3 sm:px-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium sm:text-[16px]">{title}</p>
          <p className="truncate text-[12px] text-muted-foreground sm:text-[13px]">{detail}</p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label={`Скопировать ${title}`} onClick={onCopy}>
          <Copy />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={`QR ${title}`} onClick={onQr}>
          <QrCode />
        </Button>
        {onClient && (
          <Button variant="ghost" size="icon-sm" aria-label={`Открыть в ${clientLabel ?? 'клиенте'}`} onClick={onClient}>
            <ExternalLink />
          </Button>
        )}
      </div>
    </div>
  )
}
