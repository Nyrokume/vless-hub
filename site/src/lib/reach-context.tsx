import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import {
  emptyBook,
  endpointKey,
  loadReach,
  MIN_READY,
  orderForProbe,
  probeEndpoint,
  REACH_CONCURRENCY,
  REACH_TIMEOUT_MS,
  saveReach,
  targetsFrom,
  type ReachBook,
  type ReachHit,
} from '@/lib/reach'
import type { ConfigRecord } from '@/lib/types'

type ReachProgress = {
  running: boolean
  done: number
  total: number
  open: number
  closed: number
  skipped: number
  label: string
}

export type GatePhase = 'idle' | 'scan' | 'ready' | 'short'

type ReachContextValue = {
  book: ReachBook
  progress: ReachProgress
  gate: GatePhase
  openCount: number
  setTargets: (configs: ConfigRecord[]) => void
  run: () => Promise<void>
  remember: (hits: Record<string, ReachHit>) => void
}

const ReachContext = createContext<ReachContextValue | null>(null)

const idle: ReachProgress = { running: false, done: 0, total: 0, open: 0, closed: 0, skipped: 0, label: '' }
const MIN_VISIBLE_MS = 700

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
  const [gate, setGate] = useState<GatePhase>('scan')
  const [openCount, setOpenCount] = useState(0)
  const targets = useRef<ConfigRecord[]>([])
  const generation = useRef(0)
  const bookRef = useRef(book)
  bookRef.current = book

  const setTargets = useCallback((configs: ConfigRecord[]) => {
    targets.current = configs
  }, [])

  const remember = useCallback((hits: Record<string, ReachHit>) => {
    const keys = Object.keys(hits)
    if (keys.length === 0) return
    setBook((current) => {
      const next: ReachBook = { at: Date.now(), byEndpoint: { ...current.byEndpoint, ...hits } }
      bookRef.current = next
      saveReach(next)
      return next
    })
  }, [])

  const run = useCallback(async () => {
    const ticket = (generation.current += 1)
    const planned = targetsFrom(orderForProbe(targets.current))
    if (planned.length === 0) {
      setGate('short')
      setOpenCount(0)
      setProgress(idle)
      return
    }
    setGate('scan')
    const started = performance.now()
    const nextBook: ReachBook = { at: Date.now(), byEndpoint: {} }
    let done = 0
    let open = 0
    let closed = 0
    let label = ''
    let revealed = false
    const publish = () => {
      if (ticket !== generation.current) return
      const snapshot: ReachBook = { at: nextBook.at, byEndpoint: { ...nextBook.byEndpoint } }
      bookRef.current = snapshot
      setBook(snapshot)
      setOpenCount(open)
      setProgress({ running: true, done, total: planned.length, open, closed, skipped: 0, label })
    }
    const reveal = async () => {
      if (revealed || ticket !== generation.current) return
      revealed = true
      const wait = MIN_VISIBLE_MS - (performance.now() - started)
      if (wait > 0) await new Promise((resolve) => window.setTimeout(resolve, wait))
      if (ticket !== generation.current) return
      setGate('ready')
    }
    publish()
    try {
      await runPool(planned, REACH_CONCURRENCY, async (target) => {
        if (ticket !== generation.current) return
        const key = endpointKey(target.host, target.port)
        label = target.country || target.host
        publish()
        const hit = await probeEndpoint(target.host, target.port, REACH_TIMEOUT_MS, {
          transport: target.transport,
          path: target.path,
        })
        if (ticket !== generation.current) return
        if (hit.status === 'open') open += 1
        else closed += 1
        nextBook.byEndpoint[key] = hit
        done += 1
        publish()
        if (open >= MIN_READY) void reveal()
      })
      if (ticket !== generation.current) return
      nextBook.at = Date.now()
      saveReach(nextBook)
      bookRef.current = nextBook
      setBook({ ...nextBook })
      if (open >= MIN_READY) await reveal()
      else setGate('short')
    } finally {
      if (ticket === generation.current) setProgress((current) => ({ ...current, running: false }))
    }
  }, [])

  return (
    <ReachContext.Provider value={{ book, progress, gate, openCount, setTargets, run, remember }}>
      {children}
    </ReachContext.Provider>
  )
}

export function useReach() {
  const context = useContext(ReachContext)
  if (!context) throw new Error('useReach must be used within ReachProvider')
  return context
}
