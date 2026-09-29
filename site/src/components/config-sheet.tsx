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
  distinctTransport,
  protocolLine,
  securityLabel,
  speedText,
  stabilityText,
  uptimeText,
} from '@/lib/format'
import { endpointKey, reachLine } from '@/lib/reach'
import { useReach } from '@/lib/reach-context'
import { ru, statusLabel } from '@/lib/ru'
import type { ConfigRecord, SourceReport } from '@/lib/types'
import { cn } from '@/lib/utils'

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="w-32 shrink-0 text-[13px] leading-5 text-foreground/75">{label}</div>
      <div className="min-w-0 flex-1 text-[15px] leading-5 break-all text-foreground">{value}</div>
    </div>
  )
}

export function ConfigSheet({
  config,
  missing = false,
  sources,
  client,
  onOpenChange,
  onQr,
}: {
  config: ConfigRecord | null
  missing?: boolean
  sources: SourceReport[]
  client: ClientId
  onOpenChange: (open: boolean) => void
  onQr: (request: QrRequest) => void
}) {
  const { book } = useReach()
  const title = config ? configTitle(config) : ''
  const flag = config ? flagEmoji(config.country_code) : ''
  const localReach = config ? reachLine(book.byEndpoint[endpointKey(config.host, config.port)]) : ''
  const sourceName = sources.find((item) => item.id === config?.source)?.name ?? config?.source
  const deepLink = config ? configDeepLink(client, config.uri) : null
  const rows = config
    ? [
        [ru.fields.address, config.host],
        [ru.fields.port, String(config.port)],
        [ru.fields.connection, distinctTransport(config.transport, config.protocol) ?? ''],
        [ru.fields.security, securityLabel(config.security)],
        [ru.fields.serverName, config.sni],
        [ru.fields.flow, config.flow],
        [ru.fields.path, config.path],
        [ru.fields.headerName, config.host_header],
        [ru.fields.service, config.service_name],
        [ru.fields.tlsPrint, config.fingerprint],
        [ru.fields.id, config.uuid],
        [ru.fields.name, config.remark],
        [ru.fields.ipCountry, config.ip_country ?? ''],
        [
          ru.fields.countryMark,
          config.country_source === 'remark'
            ? ru.fields.fromName
            : config.country_source === 'geoip'
              ? ru.fields.fromAddress
              : '',
        ],
        [ru.fields.stability, stabilityText(config.stability) || uptimeText(config.uptime)],
        [ru.fields.speed, speedText(config.speed_kbps)],
        [ru.fields.handshake, config.handshake_ms != null ? latencyText(config.handshake_ms) : ''],
        [ru.fields.yours, localReach],
        [
          ru.fields.status,
          missing
            ? ru.noLongerWorks
            : config.status === 'working' || config.status === 'unstable' || config.status === 'dead'
              ? statusLabel(config.status)
              : config.verified === 'tcp'
                ? ru.portOpen
                : '',
        ],
        [ru.fields.list, sourceName ?? ''],
        [
          ru.fields.checked,
          config.tested_at ? `${formatStamp(config.tested_at)} · ${checkedAge(config.tested_at)}` : '',
        ],
      ].filter(([, value]) => value)
    : []

  return (
    <Sheet open={Boolean(config)} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="gap-0 overflow-hidden p-0">
        {config && (
          <div className="max-h-[inherit] overflow-y-auto">
            <SheetHeader className="pr-12 text-left">
              <SheetTitle className="flex items-center gap-2.5 text-[22px] leading-tight font-semibold">
                <span className="text-[28px] leading-none" aria-hidden>
                  {flag || '🌐'}
                </span>
                <span className="min-w-0 break-words">{title}</span>
              </SheetTitle>
              <SheetDescription className="flex items-center justify-between gap-3 text-[14px] text-foreground/75">
                <span className="min-w-0 break-words">{protocolLine(config.transport, config.protocol)}</span>
                <span className={cn('shrink-0 text-[15px] font-semibold tabular-nums', latencyClass(config.latency_ms))}>
                  {latencyText(config.latency_ms)}
                </span>
              </SheetDescription>
            </SheetHeader>
            {missing && (
              <p className="px-4 pb-3 text-[15px] font-medium text-foreground">{ru.noLongerWorks}</p>
            )}
            <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
              <Button onClick={() => void copyText(config.uri, ru.copyConfig)}>
                <Copy />
                {ru.copyLink}
              </Button>
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
                {ru.qr}
              </Button>
              <Button
                variant="secondary"
                disabled={!deepLink}
                onClick={() => deepLink && openExternal(deepLink)}
              >
                <ExternalLink />
                {deepLink ? clientName(client) : ru.linkOnly}
              </Button>
            </div>
            <div className="mx-4 mb-6 overflow-hidden rounded-2xl bg-secondary/60">
              {rows.map(([label, value], index) => (
                <div key={label}>
                  {index > 0 && <Separator />}
                  <Field label={label} value={value} />
                </div>
              ))}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
