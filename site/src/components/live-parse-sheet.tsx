import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Globe } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { downloadText } from '@/lib/bundle'
import { copyText } from '@/lib/copy'
import { countryName, distinctTransport, flagCode, flagEmoji, protocolLabel } from '@/lib/format'
import { useHub } from '@/lib/hub'
import { collectFresh, type LiveProgress } from '@/lib/live-collect'
import { CHECK_WORKFLOW_URL, fetchLatestRun, runLine, runPhase, type RunSnapshot } from '@/lib/live-sources'
import type { ParsedProxy } from '@/lib/parse-proxy'
import { formatCount } from '@/lib/plural'
import { ru } from '@/lib/ru'
import { cn } from '@/lib/utils'

const HEADER_H = 56
const ROW_H = 68
const OVERSCAN = 480

type LiveGroup = {
  code: string
  name: string
  items: ParsedProxy[]
}

type LiveRow =
  | { kind: 'group'; key: string; group: LiveGroup; open: boolean }
  | { kind: 'config'; key: string; item: ParsedProxy }

function rowTitle(item: ParsedProxy): { flag: string; name: string } {
  const code = flagCode(item.remark)
  if (!code) return { flag: '', name: item.host }
  return { flag: flagEmoji(code), name: countryName(code) || item.host }
}

function rowSubtitle(item: ParsedProxy): string {
  const via = distinctTransport(item.network, item.protocol)
  const head = via ? `${protocolLabel(item.protocol)} · ${via}` : protocolLabel(item.protocol)
  return `${head} · ${item.host}:${item.port}`
}

function groupLive(items: ParsedProxy[]): LiveGroup[] {
  const map = new Map<string, ParsedProxy[]>()
  for (const item of items) {
    const code = flagCode(item.remark) || 'ZZ'
    const list = map.get(code)
    if (list) list.push(item)
    else map.set(code, [item])
  }
  const groups: LiveGroup[] = []
  for (const [code, rows] of map) {
    rows.sort((left, right) => left.host.localeCompare(right.host) || left.port - right.port || left.id.localeCompare(right.id))
    groups.push({
      code,
      name: code === 'ZZ' ? ru.noCountry : countryName(code) || code,
      items: rows,
    })
  }
  groups.sort((left, right) => {
    if (left.code === 'ZZ') return 1
    if (right.code === 'ZZ') return -1
    return left.name.localeCompare(right.name, 'ru')
  })
  return groups
}

function lowerBound(prefix: number[], target: number): number {
  let lo = 0
  let hi = prefix.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (prefix[mid] < target) lo = mid + 1
    else hi = mid
  }
  return lo
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
  const { updateAvailable, refresh, data } = useHub()
  const [running, setRunning] = useState(false)
  const [searched, setSearched] = useState(false)
  const [progress, setProgress] = useState<LiveProgress | null>(null)
  const [found, setFound] = useState<ParsedProxy[]>([])
  const [run, setRun] = useState<RunSnapshot | null>(null)
  const [limited, setLimited] = useState(false)
  const [newer, setNewer] = useState(false)
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [range, setRange] = useState({ start: 0, end: 24 })
  const abortRef = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

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
          const delay = runPhase(result.run) === 'running' ? 15_000 : 90_000
          timer = window.setTimeout(look, delay)
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

  useEffect(() => {
    if (updateAvailable) setNewer(true)
  }, [updateAvailable])

  async function start() {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setSearched(false)
    setFound([])
    setSelectedId(null)
    setOpenGroups(new Set())
    setNewer(false)
    const startedAt = data?.generated_at
    try {
      const result = await collectFresh(known, setProgress, controller.signal)
      setFound(result.items)
      if (startedAt && data && data.generated_at !== startedAt) setNewer(true)
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setRunning(false)
      setSearched(true)
    }
  }

  function cancel() {
    abortRef.current?.abort()
  }

  const groups = useMemo(() => groupLive(found), [found])
  const rows = useMemo(() => {
    const next: LiveRow[] = []
    for (const group of groups) {
      const expanded = openGroups.has(group.code)
      next.push({ kind: 'group', key: `g:${group.code}`, group, open: expanded })
      if (!expanded) continue
      for (const item of group.items) next.push({ kind: 'config', key: item.id, item })
    }
    return next
  }, [groups, openGroups])

  const prefix = useMemo(() => {
    const next = new Array<number>(rows.length + 1)
    next[0] = 0
    for (let index = 0; index < rows.length; index += 1) {
      next[index + 1] = next[index] + (rows[index].kind === 'group' ? HEADER_H : ROW_H)
    }
    return next
  }, [rows])

  useEffect(() => {
    const node = listRef.current
    if (!node) return
    let frame = 0
    const update = () => {
      frame = 0
      const viewStart = Math.max(0, node.scrollTop - OVERSCAN)
      const viewEnd = node.scrollTop + node.clientHeight + OVERSCAN
      const start = rows.length === 0 ? 0 : Math.max(0, lowerBound(prefix, viewStart) - 1)
      const end = rows.length === 0 ? 0 : Math.min(rows.length, Math.max(start + 1, lowerBound(prefix, viewEnd)))
      setRange((current) => (current.start === start && current.end === end ? current : { start, end }))
    }
    const schedule = () => {
      if (frame) return
      frame = window.requestAnimationFrame(update)
    }
    update()
    node.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      node.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [prefix, rows.length])

  const startIndex = Math.min(range.start, rows.length)
  const endIndex = Math.min(Math.max(range.end, startIndex), rows.length)
  const slice = rows.slice(startIndex, endIndex)
  const totalHeight = prefix[rows.length] ?? 0
  const selected = found.find((item) => item.id === selectedId) ?? null
  const status = runLine(run, limited)
  const phase = runPhase(run)
  const runIsNewer = Boolean(
    phase === 'done' &&
      run?.updatedAt &&
      data?.generated_at &&
      Date.parse(run.updatedAt) > Date.parse(data.generated_at),
  )
  const offerRefresh = Boolean(newer || updateAvailable || runIsNewer)
  const percent = progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0
  const text = found.map((item) => item.uri).join('\n')

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-dvh! max-h-dvh! gap-0 overflow-hidden rounded-none p-0">
        <SheetHeader className="shrink-0 pr-12 text-left">
          <SheetTitle>{ru.live.title}</SheetTitle>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
          {running ? (
            <div>
              <div className="h-0.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div className="h-full bg-foreground transition-[width]" style={{ width: `${percent}%` }} />
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="text-[13px] text-muted-foreground">
                  {ru.live.sources(progress?.done ?? 0, progress?.total ?? 0)}
                </p>
                <Button variant="ghost" size="sm" onClick={cancel}>
                  {ru.live.cancel}
                </Button>
              </div>
            </div>
          ) : (
            <Button onClick={() => void start()}>{ru.live.find}</Button>
          )}

          {searched && !running && found.length > 0 && (
            <p className="text-[15px]">{ru.live.found(found.length)}</p>
          )}
          {searched && !running && found.length === 0 && <EmptyState text={ru.live.found(0)} />}

          {searched && !running && (progress?.skips.length ?? 0) > 0 && (
            <details className="text-[13px] text-muted-foreground">
              <summary className="cursor-pointer">{ru.live.skipped(progress?.skips.length ?? 0)}</summary>
              <ul className="mt-2 space-y-1">
                {progress?.skips.map((skip) => (
                  <li key={`${skip.name}:${skip.reason}`}>
                    {skip.name} · {skip.reason || ru.live.skipClosed}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="grid grid-cols-3 gap-2">
            <Button
              variant="secondary"
              className="h-auto min-h-10 whitespace-normal px-2 py-2 text-center text-[13px] leading-tight"
              disabled={found.length === 0}
              onClick={() => void copyText(text, ru.live.copied)}
            >
              {ru.live.copy}
            </Button>
            <Button
              variant="secondary"
              className="h-auto min-h-10 whitespace-normal px-2 py-2 text-center text-[13px] leading-tight"
              disabled={found.length === 0}
              onClick={() => downloadText('v2hub-unverified.txt', text)}
            >
              {ru.live.download}
            </Button>
            <Button
              variant="secondary"
              className="h-auto min-h-10 whitespace-normal px-2 py-2 text-center text-[13px] leading-tight"
              onClick={() => window.open(CHECK_WORKFLOW_URL, '_blank', 'noopener')}
            >
              {ru.live.check}
            </Button>
          </div>

          {status && <p className="text-[13px] text-muted-foreground">{status}</p>}

          {offerRefresh && (
            <Button variant="ghost" onClick={() => void refresh()}>
              {ru.live.refreshList}
            </Button>
          )}

          {selected?.source && (
            <p className="truncate text-[13px] text-muted-foreground">{ru.live.source(selected.source)}</p>
          )}

          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto rounded-2xl bg-card">
            {rows.length > 0 && (
              <div style={{ height: totalHeight, position: 'relative' }}>
                <div style={{ height: prefix[startIndex] ?? 0 }} />
                {slice.map((row) =>
                  row.kind === 'group' ? (
                    <button
                      key={row.key}
                      type="button"
                      className="flex h-14 w-full items-center gap-2 overflow-hidden border-t border-border px-3 text-left whitespace-nowrap first:border-t-0"
                      aria-expanded={row.open}
                      onClick={() =>
                        setOpenGroups((current) => {
                          const next = new Set(current)
                          if (next.has(row.group.code)) next.delete(row.group.code)
                          else next.add(row.group.code)
                          return next
                        })
                      }
                    >
                      {row.open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
                      <span className="grid w-6 shrink-0 place-items-center text-xl leading-none" aria-hidden>
                        {flagEmoji(row.group.code) || <Globe className="size-5 text-muted-foreground" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{row.group.name}</span>
                      <Badge variant="secondary">{formatCount(row.group.items.length)}</Badge>
                    </button>
                  ) : (
                    <button
                      key={row.key}
                      type="button"
                      className={cn(
                        'flex h-[68px] w-full items-center border-t border-border px-3 text-left',
                        selectedId === row.item.id && 'bg-muted',
                      )}
                      onClick={() => setSelectedId(row.item.id)}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          {rowTitle(row.item).flag && (
                            <span className="text-xl leading-none" aria-hidden>
                              {rowTitle(row.item).flag}
                            </span>
                          )}
                          <span className="truncate text-[15px] font-medium">{rowTitle(row.item).name}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{rowSubtitle(row.item)}</span>
                      </span>
                    </button>
                  ),
                )}
                <div style={{ height: Math.max(0, totalHeight - (prefix[endIndex] ?? 0)) }} />
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
