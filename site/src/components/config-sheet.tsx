import { Copy, QrCode, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { clientName, configDeepLink, configImportActions, openExternal, type ClientId } from '@/lib/clients'
import { copyText } from '@/lib/copy'
import type { QrRequest } from '@/components/qr-dialog'
import {
  configTitle,
  flagEmoji,
  formatStamp,
  checkedAge,
  latencyClass,
  latencyText,
  protocolLine,
  securityLabel,
  speedText,
  stabilityText,
  transportLabel,
  uptimeText,
} from '@/lib/format'
import type { ConfigRecord, SourceReport } from '@/lib/types'
import { cn } from '@/lib/utils'

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 px-4 py-2.5">
      <div className="w-28 shrink-0 text-[13px] text-muted-foreground">{label}</div>
      <div className="min-w-0 flex-1 break-all text-[15px]">{value}</div>
    </div>
  )
}

export function ConfigSheet({
  config,
  sources,
  client,
  desktop,
  onOpenChange,
  onQr,
}: {
  config: ConfigRecord | null
  sources: SourceReport[]
  client: ClientId
  desktop: boolean
  onOpenChange: (open: boolean) => void
  onQr: (request: QrRequest) => void
}) {
  const title = config ? configTitle(config) : ''
  const flag = config ? flagEmoji(config.country_code) : ''
  const sourceName = sources.find((item) => item.id === config?.source)?.name ?? config?.source
  const deepLink = config ? configDeepLink(client, config.uri) : null
  const rows = config
    ? [
        ['Адрес', config.host],
        ['Порт', String(config.port)],
        ['Тип соединения', transportLabel(config.transport)],
        ['Защита', securityLabel(config.security)],
        ['Имя сервера', config.sni],
        ['Поток', config.flow],
        ['Путь', config.path],
        ['Host', config.host_header],
        ['Имя службы', config.service_name],
        ['Отпечаток TLS', config.fingerprint],
        ['UUID', config.uuid],
        ['Название', config.remark],
        ['Страна IP', config.ip_country ?? ''],
        [
          'Метка страны',
          config.country_source === 'remark'
            ? 'Флаг в названии'
            : config.country_source === 'geoip'
              ? 'GeoIP адреса'
              : '',
        ],
        ['Стабильность', stabilityText(config.stability) || uptimeText(config.uptime)],
        ['Скорость', speedText(config.speed_kbps)],
        ['Рукопожатие', config.handshake_ms != null ? latencyText(config.handshake_ms) : ''],
        ['Статус', config.status === 'working' ? 'Рабочий' : config.status === 'unstable' ? 'Нестабильный' : config.verified === 'tcp' ? 'Только открытый порт' : ''],
        ['Список', sourceName ?? ''],
        [
          'Проверено',
          config.tested_at ? `${formatStamp(config.tested_at)} · ${checkedAge(config.tested_at)}` : '',
        ],
      ].filter(([, value]) => value)
    : []

  return (
    <Sheet open={Boolean(config)} onOpenChange={onOpenChange}>
      <SheetContent
        side={desktop ? 'right' : 'bottom'}
        className={cn(
          'gap-0 overflow-y-auto',
          desktop ? 'w-full sm:max-w-md' : 'max-h-[88dvh] rounded-t-3xl',
        )}
      >
        {config && (
          <>
            <SheetHeader className="pr-10 text-left">
              <SheetTitle className="flex items-center gap-2 text-xl">
                <span className="text-2xl leading-none" aria-hidden>
                  {flag || '🌐'}
                </span>
                {title}
              </SheetTitle>
              <SheetDescription className="flex items-center justify-between gap-3 text-[15px]">
                <span>{protocolLine(config.transport, config.protocol)}</span>
                <span className={cn('font-semibold tabular-nums', latencyClass(config.latency_ms))}>
                  {latencyText(config.latency_ms)}
                </span>
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-2 px-4 pb-2">
              <Button onClick={() => void copyText(config.uri, 'Ссылка конфига скопирована')}>
                <Copy />
                Скопировать ссылку
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  onClick={() =>
                    onQr({
                      title: `${flag} ${title}`.trim(),
                      value: config.uri,
                      share: 'text',
                      actions: configImportActions(config.uri),
                    })
                  }
                >
                  <QrCode />
                  QR-код
                </Button>
                <Button
                  variant="secondary"
                  disabled={!deepLink}
                  onClick={() => deepLink && openExternal(deepLink)}
                >
                  <ExternalLink />
                  {deepLink ? clientName(client) : 'Только ссылка'}
                </Button>
              </div>
            </div>
            <div className="mx-4 mb-6 overflow-hidden rounded-2xl bg-secondary/60">
              {rows.map(([label, value], index) => (
                <div key={label}>
                  {index > 0 && <Separator />}
                  <Field label={label} value={value} />
                </div>
              ))}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
