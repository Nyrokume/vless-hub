import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Globe } from 'lucide-react'
import { ConfigSheet } from '@/components/config-sheet'
import { EmptyState } from '@/components/empty-state'
import { LatencyRange } from '@/components/latency-range'
import { QrDialog, type QrRequest } from '@/components/qr-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { downloadText } from '@/lib/bundle'
import { copyText } from '@/lib/copy'
import { flagEmoji, latencyClass, latencyText, protocolLine } from '@/lib/format'
import { useHub } from '@/lib/hub'
import {
  collectFresh,
  endpointIdentity,
  groupLive,
  verifiedUris,
  type LiveItem,
  type LiveLine,
  type LiveStage,
} from '@/lib/live-collect'
import { fetchLatestRun, runLine, type RunSnapshot } from '@/lib/live-sources'
import { browserCanProbe, endpointKey, probeEndpoint, REACH_CONCURRENCY, type ReachHit } from '@/lib/reach'
import { useReach } from '@/lib/reach-context'
import { openActionsPage } from '@/lib/server-check'
import { useSettings } from '@/lib/settings'
import { formatCount } from '@/lib/plural'
import { ru } from '@/lib/ru'
import type { ConfigRecord } from '@/lib/types'
import { cn } from '@/lib/utils'

function pingOf(item: LiveItem, catalog: Map<string, ConfigRecord>): number | null {
  const record = catalog.get(endpointIdentity(item.host, item.port, item.uuid))
  return record?.latency_ms ?? null
}

function reachWord(hit: ReachHit | undefined): string {
  if (!hit) return ''
  if (hit.status === 'open') return ru.reachOpen
  if (hit.status === 'closed') return ru.reachClosed
  return ru.reachSkip
}

async function probeFound(
  items: LiveItem[],
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
  remember: (hits: Record<string, ReachHit>) => void,
) {
  const planned: LiveItem[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const key = endpointKey(item.host, item.port)
    if (seen.has(key)) continue
    seen.add(key)
    planned.push(item)
  }
  let done = 0
  let cursor = 0
  const batch: Record<string, ReachHit> = {}
  const flush = () => {
    if (Object.keys(batch).length === 0) return
    remember({ ...batch })
    for (const key of Object.keys(batch)) delete batch[key]
  }
  onProgress(0, planned.length)
  const lanes = Math.max(1, Math.min(REACH_CONCURRENCY, planned.length || 1))
  async function lane() {
    for (;;) {
      if (signal.aborted) return
      const index = cursor
      cursor += 1
      if (index >= planned.length) return
      const item = planned[index]
      const key = endpointKey(item.host, item.port)
      const hit = browserCanProbe(item.protocol)
        ? await probeEndpoint(item.host, item.port, undefined, { transport: item.network, path: item.path })
        : { status: 'skip' as const, ms: null, at: Date.now() }
      if (signal.aborted) return
      batch[key] = hit
      done += 1
      if (done % REACH_CONCURRENCY === 0) flush()
      onProgress(done, planned.length)
    }
  }
  try {
    if (planned.length > 0) await Promise.all(Array.from({ length: lanes }, () => lane()))
  } finally {
    flush()
  }
}

export function LiveParseSheet({
  open,
  known,
  onOpenChange,
}: {
  open: boolean
  known: Set<string>
  onOpenChange: (open: boolean) => void
}) {
  const { data } = useHub()
  const { settings } = useSettings()
  const { book, remember } = useReach()
  const [running, setRunning] = useState(false)
  const [searched, setSearched] = useState(false)
  const [aborted, setAborted] = useState(false)
  const [stage, setStage] = useState<LiveStage | 'reach'>('download')
  const [done, setDone] = useState(0)
  const [total, setTotal] = useState(0)
  const [items, setItems] = useState<LiveItem[]>([])
  const [lines, setLines] = useState<LiveLine[]>([])
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<ConfigRecord | null>(null)
  const [qr, setQr] = useState<QrRequest | null>(null)
  const [run, setRun] = useState<RunSnapshot | null>(null)
  const [limited, setLimited] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    let timer = 0
    let stopped = false
    const look = () => {
      void fetchLatestRun(controller.signal)
        .then((result) => {
          if (stopped) return
          setRun(result.run)
          setLimited(result.limited)
          timer = window.setTimeout(look, 90_000)
        })
        .catch(() => {
          if (!stopped) timer = window.setTimeout(look, 90_000)
        })
    }
    look()
    return () => {
      stopped = true
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [open])

  async function start() {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setSearched(false)
    setAborted(false)
    setItems([])
    setLines([])
    setSelected(null)
    setOpenGroups(new Set())
    setStage('download')
    setDone(0)
    setTotal(0)
    let collected: LiveItem[] = []
    let reports: LiveLine[] = []
    try {
      const result = await collectFresh(
        known,
        (progress) => {
          setStage(progress.stage)
          setDone(progress.done)
          setTotal(progress.total)
          setLines(progress.lines)
        },
        controller.signal,
      )
      collected = result.items
      reports = result.lines
      setItems(collected)
      setLines(reports)
      if (!controller.signal.aborted && collected.length > 0) {
        setStage('reach')
        await probeFound(
          collected,
          controller.signal,
          (reachDone, reachTotal) => {
            setDone(reachDone)
            setTotal(reachTotal)
          },
          remember,
        )
      }
    } finally {
      if (controller.signal.aborted) setAborted(true)
      if (abortRef.current === controller) abortRef.current = null
      setRunning(false)
      setSearched(true)
    }
  }

  function cancel() {
    abortRef.current?.abort()
  }

  const catalog = useMemo(() => {
    const map = new Map<string, ConfigRecord>()
    for (const config of data?.configs ?? []) {
      map.set(endpointIdentity(config.host, config.port, config.uuid), config)
    }
    return map
  }, [data?.configs])
  const shown = useMemo(
    () =>
      items.filter((item) => {
        const record = catalog.get(endpointIdentity(item.host, item.port, item.uuid))
        if (!record) return false
        return book.byEndpoint[endpointKey(item.host, item.port)]?.status === 'open'
      }),
    [book.byEndpoint, catalog, items],
  )
  const groups = useMemo(() => groupLive(shown, (item) => pingOf(item, catalog)), [shown, catalog])
  const status = runLine(run, limited)
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : stage === 'parse' ? 100 : 0
  const stageLabel =
    stage === 'download'
      ? ru.live.downloadStage(done, total)
      : stage === 'parse'
        ? ru.live.parseStage
        : ru.live.reachStage(done, total)
  const exportUris = useMemo(
    () => verifiedUris(shown, data?.configs ?? []),
    [shown, data?.configs],
  )
  const text = exportUris.join('\n')
  const fetchFailed = lines.length > 0 && lines.every((line) => !line.ok)
  const emptyText = aborted && items.length === 0
    ? ru.live.emptyCancelled
    : fetchFailed
      ? ru.live.emptyFail
      : ru.live.emptyReach
  const showEmpty = searched && !running && shown.length === 0
  const showSummary = searched && !running && items.length > 0

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="max-md:h-dvh! max-md:max-h-dvh! max-md:rounded-none! md:h-[min(85dvh,720px)] md:data-[side=bottom]:w-[min(40rem,calc(100%-2rem))]! gap-0 overflow-hidden p-0"
        >
          <SheetHeader className="shrink-0 border-b border-border pr-12 text-left">
            <SheetTitle className="text-[20px] font-semibold">{ru.live.title}</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {running ? (
              <div className="rounded-2xl bg-card px-4 py-3" data-live-progress>
                <p className="text-[15px]">{stageLabel}</p>
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div className="h-full bg-foreground transition-[width]" style={{ width: `${percent}%` }} />
                </div>
                <Button variant="ghost" className="mt-2 h-10 px-0 text-[15px]" onClick={cancel}>
                  {ru.live.cancel}
                </Button>
              </div>
            ) : (
              <Button className="h-11 w-full text-[15px]" onClick={() => void start()}>
                {ru.live.find}
              </Button>
            )}

            {!running && !searched && (
              <p className="mt-3 text-[14px] leading-5 text-foreground/75">{ru.live.hint}</p>
            )}
            {status && !running && (
              <p className="mt-3 text-[13px] text-muted-foreground">{status}</p>
            )}

            {showSummary && shown.length > 0 && (
              <p className="mt-4 text-[17px] leading-5 font-semibold">{ru.gateFound(shown.length)}</p>
            )}

            {showEmpty && <EmptyState text={emptyText} />}

            {groups.length > 0 && (
              <div className="mt-4 overflow-hidden rounded-2xl bg-card">
                {groups.map((group) => {
                  const expanded = openGroups.has(group.code)
                  return (
                    <div key={group.code}>
                      <button
                        type="button"
                        className="flex h-14 w-full items-center gap-2 overflow-hidden border-t border-border px-3 text-left whitespace-nowrap first:border-t-0"
                        aria-expanded={expanded}
                        onClick={() =>
                          setOpenGroups((current) => {
                            const next = new Set(current)
                            if (next.has(group.code)) next.delete(group.code)
                            else next.add(group.code)
                            return next
                          })
                        }
                      >
                        {expanded ? (
                          <ChevronDown className="size-4 shrink-0" />
                        ) : (
                          <ChevronRight className="size-4 shrink-0" />
                        )}
                        <span className="grid w-6 shrink-0 place-items-center text-xl leading-none" aria-hidden>
                          {flagEmoji(group.code) || <Globe className="size-5 text-muted-foreground" />}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{group.name}</span>
                        <Badge variant="secondary" className="h-6 text-[13px]">
                          {formatCount(group.items.length)}
                        </Badge>
                        <LatencyRange min={group.min} max={group.max} className="text-[14px]" />
                      </button>
                      {expanded &&
                        group.items.map((item) => {
                          const record = catalog.get(endpointIdentity(item.host, item.port, item.uuid))
                          const ping = record?.latency_ms ?? null
                          const word = record ? reachWord(book.byEndpoint[endpointKey(item.host, item.port)]) : ru.live.unchecked
                          const meta = [protocolLine(item.network, item.protocol), word].filter(Boolean).join(' · ')
                          return (
                            <button
                              key={item.id}
                              type="button"
                              className="flex min-h-16 w-full items-center gap-3 border-t border-border px-3 py-2 text-left"
                              onClick={() => {
                                if (record) setSelected(record)
                              }}
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[15px] font-medium">{item.host}</span>
                                <span className="mt-0.5 block truncate text-[14px] text-foreground/75">{meta}</span>
                              </span>
                              <span className={cn('shrink-0 text-[14px] font-semibold tabular-nums', latencyClass(ping))}>
                                {record ? latencyText(ping) : ru.live.unchecked}
                              </span>
                            </button>
                          )
                        })}
                    </div>
                  )
                })}
              </div>
            )}

            {searched && !running && lines.length > 0 && (
              <Collapsible className="mt-4">
                <CollapsibleTrigger className="flex h-11 w-full items-center justify-between text-[14px] text-foreground/75">
                  {ru.live.sourcesTitle}
                  <ChevronDown className="size-4" />
                </CollapsibleTrigger>
                <CollapsibleContent className="pb-2">
                  {lines.map((line) => (
                    <p key={`${line.name}:${line.error}`} className="truncate py-1 text-[14px]">
                      {line.name}
                      {' · '}
                      {line.ok ? formatCount(line.count) : line.error || ru.live.skipClosed}
                    </p>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
          {searched && !running && exportUris.length > 0 && (
            <div className="shrink-0 border-t border-border bg-popover px-4 py-3">
              {shown.length > exportUris.length && (
                <p className="mb-2 text-[14px] text-foreground/75">{ru.live.exportNote}</p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button className="h-11 text-[14px]" onClick={() => void copyText(text, ru.live.copied)}>
                  {ru.live.copy}
                </Button>
                <Button
                  variant="secondary"
                  className="h-11 text-[14px]"
                  onClick={() => downloadText('v2hub-live.txt', text)}
                >
                  {ru.live.download}
                </Button>
                <Button
                  variant="secondary"
                  className="col-span-2 h-11 text-[14px]"
                  onClick={() => openActionsPage()}
                >
                  {ru.live.check}
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
      <ConfigSheet
        config={selected}
        sources={data?.sources ?? []}
        client={settings.client}
        onOpenChange={(next) => {
          if (!next) setSelected(null)
        }}
        onQr={setQr}
      />
      <QrDialog
        request={qr}
        onOpenChange={(next) => {
          if (!next) setQr(null)
        }}
      />
    </>
  )
}
