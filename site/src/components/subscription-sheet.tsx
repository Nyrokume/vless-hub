import { Copy, ExternalLink, QrCode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { clientName, openExternal, subscriptionDeepLink, type ClientId } from '@/lib/clients'
import { copyText } from '@/lib/copy'
import { membersOf, subscriptionUrl } from '@/lib/data'
import type { ConfigRecord, SubscriptionInfo } from '@/lib/types'
import { cn } from '@/lib/utils'

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
          <SheetDescription>
            {subscription
              ? `${subscription.description}. ${subscription.count} конфигов.`
              : 'Файлы, которые публикует сборщик. Ссылка ведёт на GitHub Pages.'}
          </SheetDescription>
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
            <Button variant="secondary" onClick={() => void copyText(b64Url, 'Ссылка base64 скопирована')}>
              <Copy />
              Скопировать base64 URL
            </Button>
            <Button
              variant="secondary"
              onClick={() => void copyText(body, `Скопировано конфигов: ${subscription.count}`)}
            >
              <Copy />
              Скопировать все ссылки
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => onQr(subscription.name, url)}>
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
        )}
      </SheetContent>
    </Sheet>
  )
}
