import { useMemo, useState } from 'react'
import { Copy, Download, ExternalLink, QrCode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { QrRequest } from '@/components/qr-dialog'
import {
  clientName,
  openExternal,
  subscriptionDeepLink,
  subscriptionImportActions,
  type ClientId,
} from '@/lib/clients'
import { copyText } from '@/lib/copy'
import { membersOf, publicFileUrl, subscriptionUrl } from '@/lib/data'
import type { CatalogEntry, ConfigRecord, SubscriptionInfo } from '@/lib/types'
import { cn } from '@/lib/utils'

export function SubscriptionSheet({
  open,
  title,
  subscription,
  subscriptions,
  configs,
  catalog,
  fastMs,
  publicBase,
  client,
  desktop,
  onOpenChange,
  onSelect,
  onQr,
}: {
  open: boolean
  title: string
  subscription: SubscriptionInfo | null
  subscriptions: SubscriptionInfo[]
  configs: ConfigRecord[]
  catalog: CatalogEntry[]
  fastMs: number
  publicBase: string
  client: ClientId
  desktop: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (subscription: SubscriptionInfo | null) => void
  onQr: (request: QrRequest) => void
}) {
  const url = subscription ? subscriptionUrl(publicBase, subscription.file) : ''
  const b64Url = subscription ? subscriptionUrl(publicBase, subscription.b64) : ''
  const deepLink = subscription ? subscriptionDeepLink(client, url, subscription.name) : null
  const body = subscription
    ? membersOf(subscription.id, configs, fastMs)
        .map((item) => item.uri)
        .join('\n')
    : ''

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={desktop ? 'right' : 'bottom'}
        className={cn(
          'gap-0 overflow-y-auto',
          desktop ? 'w-full sm:max-w-md' : 'max-h-[88dvh] rounded-t-3xl',
        )}
      >
        <SheetHeader className="pr-10 text-left">
          <SheetTitle>{subscription ? subscription.name : title}</SheetTitle>
          {subscription && (
            <SheetDescription>{subscription.count} конфигов</SheetDescription>
          )}
        </SheetHeader>

        {subscription ? (
          <div className="flex flex-col gap-2 px-4 pb-6">
            <p className="break-all rounded-xl bg-secondary px-3 py-2 font-mono text-[11px] text-muted-foreground">
              {url}
            </p>
            <Button onClick={() => void copyText(url, 'Ссылка подписки скопирована')}>
              <Copy />
              Скопировать URL
            </Button>
            {subscription.b64 && (
              <Button variant="secondary" onClick={() => void copyText(b64Url, 'Ссылка base64 скопирована')}>
                <Copy />
                Скопировать base64 URL
              </Button>
            )}
            {subscription.id !== 'clash' && subscription.id !== 'singbox' && (
              <Button
                variant="secondary"
                onClick={() => void copyText(body, `Скопировано конфигов: ${subscription.count}`)}
              >
                <Copy />
                Скопировать все ссылки
              </Button>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                onClick={() =>
                  onQr({
                    title: subscription.name,
                    value: url,
                    share: 'url',
                    actions: subscriptionImportActions(url, subscription.name),
                  })
                }
              >
                <QrCode />
                QR подписки
              </Button>
              <Button variant="secondary" disabled={!deepLink} onClick={() => deepLink && openExternal(deepLink)}>
                <ExternalLink />
                {deepLink ? clientName(client) : 'Только ссылка'}
              </Button>
            </div>
            {subscriptions.length > 1 && (
              <button
                type="button"
                className="mt-1 text-left text-sm text-primary"
                onClick={() => onSelect(null)}
              >
                Все подписки
              </button>
            )}
          </div>
        ) : (
          <>
          <SubscriptionBuilder
            className="mx-4 mb-4"
            configs={configs}
            catalog={catalog}
            publicBase={publicBase}
            onQr={onQr}
          />
          <div className="mx-4 mb-6 overflow-hidden rounded-2xl bg-card">
            {subscriptions.map((item, index) => (
              <div key={item.id}>
                {index > 0 && <Separator />}
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                  onClick={() => onSelect(item)}
                >
                  <span className="flex-1">
                    <span className="block text-[17px]">{item.name}</span>
                    <span className="block text-[13px] text-muted-foreground">
                      {item.count} · {item.description}
                    </span>
                  </span>
                </button>
              </div>
            ))}
          </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

export function SubscriptionBuilder({
  configs,
  catalog,
  publicBase,
  onQr,
  className,
}: {
  configs: ConfigRecord[]
  catalog: CatalogEntry[]
  publicBase: string
  onQr: (request: QrRequest) => void
  className?: string
}) {
  const [country, setCountry] = useState('')
  const [security, setSecurity] = useState('')
  const [transport, setTransport] = useState('')
  const countries = useMemo(() => {
    const codes = new Set<string>()
    for (const item of catalog) {
      if (item.kind === 'country' && item.country) codes.add(item.country)
    }
    for (const config of configs) {
      if (config.country_code) codes.add(config.country_code)
    }
    return [...codes].sort()
  }, [catalog, configs])

  const path = useMemo(() => {
    if (country && security && !transport) return `sub/combo/${country}-${security}.txt`
    if (country && !security && !transport) return `sub/country/${country}.txt`
    if (security && !country && !transport) return `sub/security/${security}.txt`
    if (transport && !country && !security) return `sub/transport/${transport}.txt`
    if (!country && !security && !transport) return 'sub/all.txt'
    return ''
  }, [country, security, transport])

  const published = path ? catalog.some((item) => item.path === path) : false
  const url = path && published ? publicFileUrl(publicBase, path) : ''
  const picked = configs.filter((config) => {
    if (country && config.country_code !== country) return false
    if (security && config.security !== security) return false
    if (transport && config.transport !== transport) return false
    return true
  })

  function downloadLocal() {
    const blob = new Blob([picked.map((item) => item.uri).join('\n') + '\n'], { type: 'text/plain' })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = 'v2hub-custom.txt'
    anchor.click()
    URL.revokeObjectURL(href)
  }

  return (
    <div className={cn('rounded-2xl bg-card p-4', className)}>
      <p className="text-[15px] font-medium">Собрать подписку</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Select label="Страна" value={country} onChange={setCountry} options={countries} />
        <Select
          label="Защита"
          value={security}
          onChange={setSecurity}
          options={['reality', 'tls', 'none']}
        />
        <Select
          label="Транспорт"
          value={transport}
          onChange={setTransport}
          options={['tcp', 'ws', 'grpc', 'xhttp', 'h2']}
        />
      </div>
      <p className="mt-2 text-[12px] text-muted-foreground">
        {url ? url : `В списке сейчас: ${picked.length}`}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          disabled={!url}
          onClick={() => url && void copyText(url, 'Ссылка подборки скопирована')}
        >
          <Copy />
          URL
        </Button>
        <Button
          variant="secondary"
          disabled={!url}
          onClick={() =>
            url &&
            onQr({
              title: 'Подборка',
              value: url,
              share: 'url',
              actions: subscriptionImportActions(url, 'V2Hub'),
            })
          }
        >
          <QrCode />
          QR
        </Button>
      </div>
      <Button className="mt-2 w-full" variant="secondary" disabled={picked.length === 0} onClick={downloadLocal}>
        <Download />
        Скачать {picked.length}
      </Button>
    </div>
  )
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  return (
    <label className="block text-[12px] text-muted-foreground">
      {label}
      <select
        className="mt-1 h-10 w-full rounded-xl bg-secondary px-2 text-[14px] text-foreground"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">все</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}
