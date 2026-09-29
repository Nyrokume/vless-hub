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
import { securityLabel, transportLabel } from '@/lib/format'
import { ru } from '@/lib/ru'
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
      <SheetContent side="bottom" className="gap-0 overflow-hidden p-0">
        <div className="max-h-[inherit] overflow-y-auto">
        <SheetHeader className="pr-12 text-left">
          <SheetTitle className="text-[22px] leading-tight font-semibold break-words">
            {subscription ? subscription.name : title}
          </SheetTitle>
          {subscription && (
            <SheetDescription className="text-[14px] text-foreground/75">
              {subscription.count} конфигов
            </SheetDescription>
          )}
        </SheetHeader>

        {subscription ? (
          <div className="flex flex-col gap-3 px-4 pb-6">
            <p className="rounded-xl bg-secondary px-3 py-2 font-mono text-[14px] leading-5 break-all text-foreground">
              {url}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void copyText(url, ru.copySubscription)}>
                <Copy />
                {ru.copySubscriptionUrl}
              </Button>
              {subscription.b64 && (
                <Button variant="secondary" onClick={() => void copyText(b64Url, ru.encodedUrlCopied)}>
                  <Copy />
                  {ru.copyEncodedUrl}
                </Button>
              )}
              {subscription.id !== 'clash' && subscription.id !== 'singbox' && (
                <Button
                  variant="secondary"
                  onClick={() => void copyText(body, ru.copiedConfigs(subscription.count))}
                >
                  <Copy />
                  {ru.copyAllLinks}
                </Button>
              )}
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
                {ru.subscriptionQr}
              </Button>
              <Button variant="secondary" disabled={!deepLink} onClick={() => deepLink && openExternal(deepLink)}>
                <ExternalLink />
                {deepLink ? clientName(client) : ru.linkOnly}
              </Button>
            </div>
            {subscriptions.length > 1 && (
              <button
                type="button"
                className="text-left text-[14px] text-primary"
                onClick={() => onSelect(null)}
              >
                {ru.allSubscriptions}
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
                    <span className="block text-[13px] text-foreground/75">
                      {item.count} · {item.description}
                    </span>
                  </span>
                </button>
              </div>
            ))}
          </div>
          </>
        )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function SubscriptionBuilder({
  configs,
  catalog,
  publicBase,
  generatedAt = '',
  onQr,
  className,
}: {
  configs: ConfigRecord[]
  catalog: CatalogEntry[]
  publicBase: string
  generatedAt?: string
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
  const url = path && published ? publicFileUrl(publicBase, path, generatedAt) : ''
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
      <p className="text-[15px] font-medium">{ru.buildSubscription}</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Select label={ru.country} value={country} onChange={setCountry} options={countries.map((code) => ({ value: code, label: code }))} />
        <Select
          label={ru.security}
          value={security}
          onChange={setSecurity}
          options={['reality', 'tls', 'none'].map((value) => ({ value, label: securityLabel(value) }))}
        />
        <Select
          label={ru.connection}
          value={transport}
          onChange={setTransport}
          options={['tcp', 'ws', 'grpc', 'xhttp', 'h2'].map((value) => ({ value, label: transportLabel(value) }))}
        />
      </div>
      <p className="mt-3 text-[14px] leading-5 break-all text-foreground">
        {url ? url : ru.inListNow(picked.length)}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          disabled={!url}
          onClick={() => url && void copyText(url, ru.copySelection)}
        >
          <Copy />
          {ru.copySubscriptionUrl}
        </Button>
        <Button
          variant="secondary"
          disabled={!url}
          onClick={() =>
            url &&
            onQr({
              title: ru.selection,
              value: url,
              share: 'url',
              actions: subscriptionImportActions(url, 'V2Hub'),
            })
          }
        >
          <QrCode />
          {ru.qrShort}
        </Button>
        <Button variant="secondary" disabled={picked.length === 0} onClick={downloadLocal}>
          <Download />
          {ru.downloadCount(picked.length)}
        </Button>
      </div>
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
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <label className="block text-[13px] text-foreground/75">
      {label}
      <select
        className="mt-1 h-10 w-full rounded-xl bg-secondary px-2 text-[14px] text-foreground"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{ru.any}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
