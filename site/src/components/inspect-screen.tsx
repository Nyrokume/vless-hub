import { useState } from 'react'
import { QrCode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { QrDialog, type QrRequest } from '@/components/qr-dialog'
import { configImportActions } from '@/lib/clients'
import { parseVless, type ParsedVless } from '@/lib/vless'

const FIELDS: { key: keyof ParsedVless; label: string }[] = [
  { key: 'uuid', label: 'UUID' },
  { key: 'host', label: 'Адрес' },
  { key: 'port', label: 'Порт' },
  { key: 'network', label: 'Транспорт' },
  { key: 'security', label: 'Защита' },
  { key: 'sni', label: 'SNI' },
  { key: 'fp', label: 'Fingerprint' },
  { key: 'pbk', label: 'Public key' },
  { key: 'sid', label: 'Short ID' },
  { key: 'flow', label: 'Flow' },
  { key: 'path', label: 'Путь' },
  { key: 'hostHeader', label: 'Host' },
  { key: 'serviceName', label: 'gRPC' },
  { key: 'remark', label: 'Название' },
  { key: 'fingerprint', label: 'Отпечаток' },
]

export function InspectScreen({ embedded = false }: { embedded?: boolean }) {
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<ParsedVless | null>(null)
  const [error, setError] = useState('')
  const [qr, setQr] = useState<QrRequest | null>(null)

  async function inspect() {
    const result = await parseVless(text.trim())
    if (!result) {
      setParsed(null)
      setError('Это не VLESS-ссылка')
      return
    }
    setError('')
    setParsed(result)
  }

  return (
    <div className={embedded ? 'mb-2' : 'mx-auto w-full max-w-3xl px-4 pt-4'}>
      {!embedded && <h1 className="mb-3 text-[28px] leading-none font-bold tracking-tight">Разбор ссылки</h1>}
      <p className="mb-3 text-[14px] text-muted-foreground">
        Ссылка разбирается в браузере. Плюс в public key остаётся плюсом, название в отпечаток не входит.
      </p>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="vless://…"
        aria-label="VLESS-ссылка"
        className="min-h-28 w-full rounded-2xl bg-card px-3 py-3 font-mono text-[13px] outline-none"
      />
      <Button className="mt-3" onClick={() => void inspect()}>
        Разобрать
      </Button>
      {error && <p className="mt-3 text-sm text-muted-foreground">{error}</p>}
      {parsed && (
        <div className="mt-4 overflow-hidden rounded-2xl bg-card">
          {FIELDS.filter((field) => parsed[field.key] !== '' && parsed[field.key] != null).map((field) => (
            <div key={field.key} className="flex gap-3 border-b border-border px-4 py-2.5 last:border-0">
              <div className="w-28 shrink-0 text-[13px] text-muted-foreground">{field.label}</div>
              <div className="min-w-0 flex-1 break-all text-[15px]">{String(parsed[field.key])}</div>
            </div>
          ))}
          <div className="p-3">
            <Button
              variant="secondary"
              onClick={() =>
                setQr({
                  title: parsed.remark || parsed.host,
                  value: text.trim(),
                  share: 'text',
                  actions: configImportActions(text.trim()),
                })
              }
            >
              <QrCode />
              QR и клиенты
            </Button>
          </div>
        </div>
      )}
      <QrDialog request={qr} onOpenChange={(open) => !open && setQr(null)} />
    </div>
  )
}
