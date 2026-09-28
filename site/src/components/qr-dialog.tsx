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
import { ru } from '@/lib/ru'

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
  await copyText(value, ru.copied)
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
      <DialogContent className="max-h-[min(90dvh,720px)] overflow-y-auto sm:max-w-[32rem]">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="text-[20px] leading-tight font-semibold break-words">
            {request?.title ?? ru.qr}
          </DialogTitle>
          <DialogDescription className="text-[14px] text-foreground/75">
            {value && value.length > 900 ? ru.qrLong : ru.qrHint}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4">
          {image ? (
            <img
              src={image}
              alt={request?.title ? `${ru.qr}: ${request.title}` : ru.qr}
              className="size-64 rounded-xl bg-white p-2"
            />
          ) : (
            <div className="grid size-64 place-items-center rounded-xl bg-secondary text-[14px] text-foreground/75">
              {failed ? ru.qrFailed : ru.qrBuilding}
            </div>
          )}
          {value && (
            <p className="max-h-24 w-full overflow-auto rounded-xl bg-secondary px-3 py-2 font-mono text-[14px] leading-5 break-all text-foreground">
              {value}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button disabled={!value} onClick={() => value && void copyText(value, ru.linkCopied)}>
              <Copy />
              {ru.copy}
            </Button>
            <Button variant="secondary" disabled={!image} onClick={download}>
              <Download />
              {ru.picture}
            </Button>
            <Button
              variant="secondary"
              disabled={!value}
              onClick={() =>
                value && void shareValue(request?.title ?? ru.brand, value, request?.share ?? 'text')
              }
            >
              <Share2 />
              {ru.share}
            </Button>
            {request?.actions?.map((action) => (
              <Button key={action.label} variant="secondary" onClick={() => openExternal(action.href)}>
                {action.label}
              </Button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
