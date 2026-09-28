import { Copy, ExternalLink, QrCode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from '@/components/ui/item'
import { ResponsivePanel } from '@/components/responsive-panel'
import { clientName, openExternal, subscriptionDeepLink, type ClientId } from '@/lib/clients'
import { copyText } from '@/lib/copy'
import { membersOf, subscriptionUrl } from '@/lib/data'
import type { ConfigRecord, SubscriptionInfo } from '@/lib/types'

export function SubscriptionSheet({
  open,
  title,
  subscription,
  subscriptions,
  configs,
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
  fastMs: number
  publicBase: string
  client: ClientId
  desktop: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (subscription: SubscriptionInfo | null) => void
  onQr: (title: string, value: string) => void
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
    <ResponsivePanel
      open={open}
      onOpenChange={onOpenChange}
      desktop={desktop}
      title={subscription ? subscription.name : title}
      description={
        subscription
          ? `${subscription.description}. ${subscription.count} конфигов.`
          : 'Файлы, которые публикует сборщик. Ссылка ведёт на GitHub Pages.'
      }
    >
      {subscription ? (
        <>
          <p className="rounded-lg bg-muted p-3 font-mono text-xs break-all text-muted-foreground">
            {url}
          </p>
          <Button onClick={() => void copyText(url, 'Ссылка подписки скопирована')}>
            <Copy data-icon="inline-start" />
            Скопировать URL
          </Button>
          <Button variant="secondary" onClick={() => void copyText(b64Url, 'Ссылка base64 скопирована')}>
            <Copy data-icon="inline-start" />
            Скопировать base64 URL
          </Button>
          <Button
            variant="secondary"
            onClick={() => void copyText(body, `Скопировано конфигов: ${subscription.count}`)}
          >
            <Copy data-icon="inline-start" />
            Скопировать все ссылки
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => onQr(subscription.name, url)}>
              <QrCode data-icon="inline-start" />
              QR подписки
            </Button>
            <Button variant="outline" disabled={!deepLink} onClick={() => deepLink && openExternal(deepLink)}>
              <ExternalLink data-icon="inline-start" />
              {deepLink ? clientName(client) : 'Только ссылка'}
            </Button>
          </div>
          {subscriptions.length > 1 && (
            <Button variant="ghost" className="w-full" onClick={() => onSelect(null)}>
              Все подписки
            </Button>
          )}
        </>
      ) : (
        <ItemGroup>
          {subscriptions.map((item, index) => (
            <div key={item.id}>
              {index > 0 && <ItemSeparator />}
              <Item variant="outline" asChild>
                <button type="button" onClick={() => onSelect(item)}>
                  <ItemContent>
                    <ItemTitle>{item.name}</ItemTitle>
                    <ItemDescription>
                      {item.count} · {item.description}
                    </ItemDescription>
                  </ItemContent>
                </button>
              </Item>
            </div>
          ))}
        </ItemGroup>
      )}
    </ResponsivePanel>
  )
}
