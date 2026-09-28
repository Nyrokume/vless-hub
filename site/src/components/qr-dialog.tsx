import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { copyText } from '@/lib/copy'

export function QrDialog({
  title,
  value,
  onOpenChange,
}: {
  title: string | null
  value: string | null
  onOpenChange: (open: boolean) => void
}) {
  const [image, setImage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const open = Boolean(value)

  useEffect(() => {
    if (!value) return
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title ?? 'QR-код'}</DialogTitle>
          <DialogDescription>
            {value && value.length > 900
              ? 'Ссылка длинная, код получится плотным. Надёжнее скопировать её текстом.'
              : 'Отсканируйте код в клиенте или скопируйте ссылку.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4">
          {image ? (
            <img
              src={image}
              alt={title ? `QR-код: ${title}` : 'QR-код'}
              className="size-64 rounded-lg bg-muted p-2"
            />
          ) : (
            <div className="grid size-64 place-items-center rounded-lg bg-muted text-sm text-muted-foreground">
              {failed ? 'Не удалось построить QR' : 'Строим QR…'}
            </div>
          )}
          {value && (
            <p className="max-h-20 w-full overflow-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs break-all text-muted-foreground">
              {value}
            </p>
          )}
          <Button
            className="w-full"
            disabled={!value}
            onClick={() => value && void copyText(value, 'Ссылка скопирована')}
          >
            <Copy data-icon="inline-start" />
            Скопировать
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
