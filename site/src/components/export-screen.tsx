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
import { flagEmoji, formatStamp, securityLabel, transportLabel } from '@/lib/format'
import { useSettings } from '@/lib/settings'
import type { CatalogEntry, HubData } from '@/lib/types'

const SLICE_ORDER = ['all', 'top', 'clash', 'singbox', 'unverified']

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
  const slices = plain
    .filter(
      (item) =>
        SLICE_ORDER.includes(item.kind) && item.path !== 'sub/verified.txt' && item.path !== 'sub/top.txt',
    )
    .sort((left, right) => SLICE_ORDER.indexOf(left.kind) - SLICE_ORDER.indexOf(right.kind) || (left.top ?? 0) - (right.top ?? 0))
  const countries = plain
    .filter((item) => item.kind === 'country')
    .sort((left, right) => right.count - left.count || (left.country ?? '').localeCompare(right.country ?? ''))
  const details = plain
    .filter((item) => item.kind === 'security' || item.kind === 'transport')
    .sort((left, right) => left.kind.localeCompare(right.kind) || right.count - left.count)

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

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4">
      <SiteHeader updated={formatStamp(data.generated_at)} />
      <p className="mb-4 text-[14px] leading-relaxed text-muted-foreground">
        Готовые файлы по срезу, страна и транспорт. Ссылка ведёт на GitHub Pages. Свою подборку
        отмечают на вкладке «Конфиги».
      </p>

      <Section title="Срезы">
        {slices.map((entry, index) => (
          <FileRow
            key={entry.path}
            divided={index > 0}
            title={titleOf(entry)}
            detail={`${entry.count} · ${entry.path}`}
            onCopy={() => void copyText(publicFileUrl(settings.publicBase, entry.path), 'Ссылка скопирована')}
            onQr={() => openQr(entry)}
            onClient={
              entry.kind === 'unverified'
                ? undefined
                : () => {
                    const url = publicFileUrl(settings.publicBase, entry.path)
                    const link = subscriptionDeepLink(settings.client, url, 'V2Hub')
                    if (link) openExternal(link)
                    else void copyText(url, 'Для этого клиента есть только ссылка')
                  }
            }
            clientLabel={clientName(settings.client)}
          />
        ))}
      </Section>

      <Section title="Страны">
        {countries.map((entry, index) => (
          <FileRow
            key={entry.path}
            divided={index > 0}
            title={titleOf(entry)}
            detail={`${entry.count} · ${entry.path}`}
            onCopy={() => void copyText(publicFileUrl(settings.publicBase, entry.path), 'Ссылка скопирована')}
            onQr={() => openQr(entry)}
            onClient={() => {
              const url = publicFileUrl(settings.publicBase, entry.path)
              const link = subscriptionDeepLink(settings.client, url, 'V2Hub')
              if (link) openExternal(link)
              else void copyText(url, 'Для этого клиента есть только ссылка')
            }}
            clientLabel={clientName(settings.client)}
          />
        ))}
      </Section>

      <Section title="Защита и транспорт">
        {details.map((entry, index) => (
          <FileRow
            key={entry.path}
            divided={index > 0}
            title={titleOf(entry)}
            detail={`${entry.count} · ${entry.path}`}
            onCopy={() => void copyText(publicFileUrl(settings.publicBase, entry.path), 'Ссылка скопирована')}
            onQr={() => openQr(entry)}
            onClient={() => {
              const url = publicFileUrl(settings.publicBase, entry.path)
              const link = subscriptionDeepLink(settings.client, url, 'V2Hub')
              if (link) openExternal(link)
              else void copyText(url, 'Для этого клиента есть только ссылка')
            }}
            clientLabel={clientName(settings.client)}
          />
        ))}
      </Section>

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
              detail={`${count} · ${path}`}
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

      <div className="mb-6">
        <SubscriptionBuilder
          configs={data.configs}
          catalog={data.catalog}
          publicBase={settings.publicBase}
          onQr={setQr}
        />
      </div>
      <QrDialog request={qr} onOpenChange={(open) => !open && setQr(null)} />
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="px-1 pb-2 text-[13px] font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
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
