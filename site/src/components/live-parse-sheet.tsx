import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { copyText } from '@/lib/copy'
import { downloadText } from '@/lib/bundle'
import { collectFresh, type LiveProgress } from '@/lib/live-collect'
import {
  CHECK_WORKFLOW_URL,
  fetchLatestRun,
  runLabel,
  type RunSnapshot,
} from '@/lib/live-sources'
import { protocolLabel } from '@/lib/format'
import { useHub } from '@/lib/hub'
import { ru } from '@/lib/ru'
import type { ParsedProxy } from '@/lib/parse-proxy'

const SHOWN = 200
const POLL_MS = 90_000

export function LiveParseSheet({
  open,
  known,
  onOpenChange,
}: {
  open: boolean
  known: Set<string>
  onOpenChange: (open: boolean) => void
}) {
  const { updateAvailable, refresh, data } = useHub()
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<LiveProgress | null>(null)
  const [found, setFound] = useState<ParsedProxy[]>([])
  const [run, setRun] = useState<RunSnapshot | null>(null)
  const [limited, setLimited] = useState(false)
  const [newer, setNewer] = useState(false)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    let timer = 0
    const look = () => {
      void fetchLatestRun(controller.signal)
        .then((result) => {
          setRun(result.run)
          setLimited(result.limited)
          if (result.limited) window.clearInterval(timer)
        })
        .catch(() => undefined)
    }
    look()
    timer = window.setInterval(look, POLL_MS)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [open])

  useEffect(() => {
    if (updateAvailable) setNewer(true)
  }, [updateAvailable])

  async function start() {
    setRunning(true)
    setFound([])
    setNewer(false)
    const startedAt = data?.generated_at
    const controller = new AbortController()
    try {
      const next = await collectFresh(known, setProgress, controller.signal)
      setFound(next)
      if (startedAt && data && data.generated_at !== startedAt) setNewer(true)
    } finally {
      setRunning(false)
    }
  }

  const shown = found.slice(0, SHOWN)
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[88dvh] gap-3 overflow-y-auto rounded-t-3xl">
        <SheetHeader className="pr-10 text-left">
          <SheetTitle>{ru.live.title}</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4 pb-6">
          <Button disabled={running} onClick={() => void start()}>
            {running ? ru.live.reading : ru.live.find}
          </Button>
          {progress && (
            <p className="text-[13px] text-muted-foreground">
              {ru.live.progress(progress.done, progress.total, progress.parsed, progress.fresh, progress.skipped)}
            </p>
          )}
          <p className="text-[13px] text-muted-foreground">
            {runLabel(run, limited)}. {ru.live.browser}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => window.open(CHECK_WORKFLOW_URL, '_blank', 'noopener')}>
              {ru.live.startCheck}
            </Button>
            {(newer || updateAvailable) && (
              <Button variant="secondary" onClick={() => void refresh()}>
                {ru.live.refreshList}
              </Button>
            )}
          </div>
          {found.length > 0 && (
            <>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => void copyText(found.map((item) => item.uri).join('\n'), ru.live.newCopied)}>
                  {ru.live.copyNew}
                </Button>
                <Button variant="secondary" onClick={() => downloadText('v2hub-unverified.txt', found.map((item) => item.uri).join('\n'))}>
                  {ru.live.download}
                </Button>
              </div>
              <div className="overflow-hidden rounded-2xl bg-card">
                {shown.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left last:border-0"
                    onClick={() => void copyText(item.uri, ru.linkCopied)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px]">{item.remark || item.host}</span>
                      <span className="block text-[12px] text-muted-foreground">
                        {protocolLabel(item.protocol)} · {item.host}:{item.port} · {ru.live.unchecked}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              {found.length > SHOWN && (
                <p className="text-[13px] text-muted-foreground">{ru.live.first(SHOWN, found.length)}</p>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
