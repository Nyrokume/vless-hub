import { Copy, ExternalLink, QrCode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldTitle } from '@/components/ui/field'
import { Separator } from '@/components/ui/separator'
import { ResponsivePanel } from '@/components/responsive-panel'
import { clientName, configDeepLink, openExternal, type ClientId } from '@/lib/clients'
import { copyText } from '@/lib/copy'
import {
  configTitle,
  flagEmoji,
  formatStamp,
  latencyClass,
  protocolLine,
  securityLabel,
  transportLabel,
} from '@/lib/format'
import type { ConfigRecord, SourceReport } from '@/lib/types'
import { cn } from '@/lib/utils'

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
  onQr: (title: string, value: string) => void
}) {
  const title = config ? configTitle(config) : 'Конфигурация'
  const flag = config ? flagEmoji(config.country_code) : ''
  const sourceName = sources.find((item) => item.id === config?.source)?.name ?? config?.source
  const deepLink = config ? configDeepLink(client, config.uri) : null
  const rows = config
    ? [
        ['Адрес', config.host],
        ['Порт', String(config.port)],
        ['Транспорт', transportLabel(config.transport)],
        ['Безопасность', securityLabel(config.security)],
        ['SNI', config.sni],
        ['Flow', config.flow],
        ['Путь', config.path],
        ['Host', config.host_header],
        ['gRPC service', config.service_name],
        ['Fingerprint', config.fingerprint],
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
        ['Список', sourceName ?? ''],
        ['Проверено', config.tested_at ? formatStamp(config.tested_at) : ''],
      ].filter(([, value]) => value)
    : []

  return (
    <ResponsivePanel
      open={Boolean(config)}
      onOpenChange={onOpenChange}
      desktop={desktop}
      title={flag ? `${flag} ${title}` : title}
      description={
        config
          ? `${protocolLine(config.transport)} · ${config.latency_ms} мс`
          : 'Подробности конфигурации'
      }
    >
      {config && (
        <>
          <p className={cn('text-sm font-medium tabular-nums', latencyClass(config.latency_ms))}>
            {config.latency_ms} мс — TCP сборщика
          </p>
          <div className="flex flex-col gap-2">
            <Button onClick={() => void copyText(config.uri, 'Ссылка конфига скопирована')}>
              <Copy data-icon="inline-start" />
              Скопировать ссылку
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => onQr(`${flag} ${title}`.trim(), config.uri)}>
                <QrCode data-icon="inline-start" />
                QR-код
              </Button>
              <Button
                variant="secondary"
                disabled={!deepLink}
                onClick={() => deepLink && openExternal(deepLink)}
              >
                <ExternalLink data-icon="inline-start" />
                {deepLink ? clientName(client) : 'Только ссылка'}
              </Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Задержка — время TCP-соединения с машины сборщика, не пинг вашего устройства. Сайт не
            поднимает VPN.
          </p>
          <Separator />
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
