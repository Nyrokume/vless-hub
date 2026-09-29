import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  browserCanProbe,
  emptyBook,
  endpointKey,
  loadReach,
  probeEndpoint,
  REACH_CONCURRENCY,
  saveReach,
  targetsFrom,
  type ReachBook,
  type ReachHit,
} from '@/lib/reach'
import { ru } from '@/lib/ru'
import type { ConfigRecord } from '@/lib/types'

type ReachProgress = {
  running: boolean
  done: number
  total: number
  open: number
  closed: number
  skipped: number
}

type ReachContextValue = {
  book: ReachBook
  progress: ReachProgress
  setTargets: (configs: ConfigRecord[]) => void
  run: () => Promise<void>
}

const ReachContext = createContext<ReachContextValue | null>(null)

const idle: ReachProgress = { running: false, done: 0, total: 0, open: 0, closed: 0, skipped: 0 }

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const lanes = Math.max(1, Math.min(limit, items.length))
  async function lane(): Promise<void> {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      await worker(items[index])
    }
  }
  await Promise.all(Array.from({ length: lanes }, () => lane()))
}

export function ReachProvider({ children }: { children: ReactNode }) {
  const [book, setBook] = useState<ReachBook>(() => (typeof localStorage === 'undefined' ? emptyBook() : loadReach()))
  const [progress, setProgress] = useState<ReachProgress>(idle)
  const targets = useRef<ConfigRecord[]>([])
  const running = useRef(false)
  const bookRef = useRef(book)
  bookRef.current = book

  const setTargets = useCallback((configs: ConfigRecord[]) => {
    targets.current = configs
  }, [])

  const run = useCallback(async () => {
    if (running.current) return
    const configs = targets.current.filter((config) => config.host && config.port)
    const planned = targetsFrom(configs)
    if (planned.length === 0) {
      toast(ru.reachNone)
      return
    }
    running.current = true
    const nextBook: ReachBook = {
      at: Date.now(),
      byEndpoint: { ...bookRef.current.byEndpoint },
    }
    const shareCount = new Map<string, number>()
    for (const config of configs) {
      const key = endpointKey(config.host, config.port)
      shareCount.set(key, (shareCount.get(key) ?? 0) + 1)
    }
    let done = 0
    let open = 0
    let closed = 0
    let skipped = 0
    const publish = () => {
      const snapshot: ReachBook = { at: nextBook.at, byEndpoint: { ...nextBook.byEndpoint } }
      bookRef.current = snapshot
      setBook(snapshot)
      setProgress({ running: true, done, total: configs.length, open, closed, skipped })
    }
    publish()
    try {
      await runPool(planned, REACH_CONCURRENCY, async (target) => {
        const key = endpointKey(target.host, target.port)
        let hit: ReachHit
        const share = shareCount.get(key) ?? 1
        if (!browserCanProbe(target.protocol)) {
          hit = { status: 'skip', ms: null, at: Date.now() }
          skipped += share
        } else {
          hit = await probeEndpoint(target.host, target.port)
          if (hit.status === 'open') open += share
          else closed += share
        }
        nextBook.byEndpoint[key] = hit
        done += share
        publish()
      })
      nextBook.at = Date.now()
      saveReach(nextBook)
      bookRef.current = nextBook
      setBook(nextBook)
      toast(ru.reachSummary(open, configs.length), { duration: 3200 })
    } finally {
      running.current = false
      setProgress((current) => ({ ...current, running: false }))
    }
  }, [])

  return (
    <ReachContext.Provider value={{ book, progress, setTargets, run }}>
      {children}
    </ReachContext.Provider>
  )
}

export function useReach() {
  const context = useContext(ReachContext)
  if (!context) throw new Error('useReach must be used within ReachProvider')
  return context
}
