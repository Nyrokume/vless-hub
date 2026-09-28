import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Copy, Download, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { openExternal, type ImportAction } from '@/lib/clients'
import { copyText } from '@/lib/copy'

export type QrRequest = {
  title: string
  value: string
  share?: 'text' | 'url'
  actions?: ImportAction[]
}

async function shareValue(title: string, value: string, mode: 'text' | 'url') {
  if (navigator.share) {
    try {
      if (mode === 'url') await navigator.share({ title, url: value })
      else await navigator.share({ title, text: value })
      return
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
    }
  }
  await copyText(value, 'Скопировано')
}

export function QrDialog({
  request,
  onOpenChange,
}: {
  request: QrRequest | null
  onOpenChange: (open: boolean) => void
}) {
  const [image, setImage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const value = request?.value ?? null
  const open = Boolean(value)

  useEffect(() => {
    if (!value) {
      setImage(null)
      setFailed(false)
      return
    }
    let cancelled = false
    QRCode.toDataURL(value, {
      margin: 1,
      width: 320,
      errorCorrectionLevel: value.length > 800 ? 'L' : 'M',
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) {
          setImage(url)
          setFailed(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setImage(null)
          setFailed(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [value])

  function download() {
    if (!image) return
    const anchor = document.createElement('a')
    anchor.href = image
    anchor.download = 'v2hub-qr.png'
    anchor.click()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{request?.title ?? 'QR-код'}</DialogTitle>
          <DialogDescription>
            {value && value.length > 900
              ? 'Ссылка длинная, код получится плотным. Надёжнее скопировать её текстом.'
              : 'Код чёрный на белом, чтобы его можно было сканировать. Сайт не поднимает туннель.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4">
          {image ? (
            <img
              src={image}
              alt={request?.title ? `QR-код: ${request.title}` : 'QR-код'}
              className="size-64 rounded-xl bg-white p-2"
            />
          ) : (
            <div className="grid size-64 place-items-center rounded-xl bg-secondary text-sm text-muted-foreground">
              {failed ? 'Не удалось построить QR' : 'Строим QR…'}
            </div>
          )}
          {value && (
            <p className="max-h-20 w-full overflow-auto break-all rounded-xl bg-secondary px-3 py-2 font-mono text-[11px] text-muted-foreground">
              {value}
            </p>
          )}
          <div className="grid w-full grid-cols-2 gap-2">
            <Button
              disabled={!value}
              onClick={() => value && void copyText(value, 'Ссылка скопирована')}
            >
              <Copy />
              Копировать
            </Button>
            <Button variant="secondary" disabled={!image} onClick={download}>
              <Download />
              PNG
            </Button>
          </div>
          <Button
            variant="secondary"
            className="w-full"
            disabled={!value}
            onClick={() =>
              value && void shareValue(request?.title ?? 'V2Hub', value, request?.share ?? 'text')
            }
          >
            <Share2 />
            Поделиться
          </Button>
          {request?.actions && request.actions.length > 0 && (
            <div className="grid w-full grid-cols-2 gap-2">
              {request.actions.map((action) => (
                <Button
                  key={action.label}
                  variant="secondary"
                  onClick={() => openExternal(action.href)}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
