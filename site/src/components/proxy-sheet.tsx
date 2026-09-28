import { Copy, ExternalLink, QrCode } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldTitle } from '@/components/ui/field'
import { ResponsivePanel } from '@/components/responsive-panel'
import { copyText } from '@/lib/copy'
import { delayText, flagEmoji } from '@/lib/format'
import type { ProxyRecord } from '@/lib/types'
import { openExternal } from '@/lib/clients'

export function ProxySheet({
  proxy,
  desktop,
  onOpenChange,
  onQr,
}: {
  proxy: ProxyRecord | null
  desktop: boolean
  onOpenChange: (open: boolean) => void
  onQr: (title: string, value: string) => void
}) {
  const title = proxy ? proxy.country || proxy.host : 'Прокси'
  const flag = proxy ? flagEmoji(proxy.country_code) : ''
  const kind = proxy?.kind === 'mtproto' ? 'Telegram MTProto' : proxy?.kind === 'socks5' ? 'SOCKS5' : 'HTTP'
  const rows = proxy
    ? [
        ['Тип', kind],
        ['Адрес', proxy.host],
        ['Порт', String(proxy.port)],
        ['Проверка', proxy.check === 'real' ? 'Реальный запрос' : 'Только TCP'],
        ['Удачные попытки', String(proxy.successes)],
        ['Секрет', proxy.secret],
      ].filter(([, value]) => value)
    : []

  return (
    <ResponsivePanel
      open={Boolean(proxy)}
      onOpenChange={onOpenChange}
      desktop={desktop}
      title={flag ? `${flag} ${title}` : title}
      description={proxy ? `${kind}. ${delayText(proxy)}.` : 'Подробности прокси'}
    >
      {proxy && (
        <>
          <Badge variant={proxy.check === 'real' ? 'default' : 'outline'}>
            {proxy.check === 'real' ? 'real' : 'tcp'}
          </Badge>
          <div className="flex flex-col gap-2">
            <Button onClick={() => void copyText(proxy.uri, 'Ссылка прокси скопирована')}>
              <Copy data-icon="inline-start" />
              Скопировать ссылку
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => onQr(`${flag} ${title}`.trim(), proxy.uri)}>
                <QrCode data-icon="inline-start" />
                QR-код
              </Button>
              <Button
                variant="secondary"
                disabled={proxy.kind !== 'mtproto'}
                onClick={() => openExternal(proxy.uri)}
              >
                <ExternalLink data-icon="inline-start" />
                {proxy.kind === 'mtproto' ? 'Telegram' : 'Только ссылка'}
              </Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            {proxy.check === 'real'
              ? proxy.kind === 'mtproto'
                ? 'Задержка — рукопожатие MTProto или fake-TLS с машины сборщика.'
                : 'Задержка — HTTP 204 через этот прокси с машины сборщика.'
              : 'Протокол не подтверждён. Показано только время TCP, это не real-delay.'}
          </p>
          <FieldGroup>
            {rows.map(([label, value]) => (
              <Field key={label} orientation="horizontal" className="items-start">
                <FieldTitle className="w-28 shrink-0">{label}</FieldTitle>
                <span className="min-w-0 flex-1 text-right break-all">{value}</span>
              </Field>
            ))}
          </FieldGroup>
        </>
      )}
    </ResponsivePanel>
  )
}
