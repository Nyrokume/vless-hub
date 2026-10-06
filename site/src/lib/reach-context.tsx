import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  CHANNEL_NAME,
  CLOSED_TTL_MS,
  emptyBook,
  endpointKey,
  gateFromBook,
  hitFresh,
  loadReach,
  LOCK_KEY,
  LOCK_LEASE_MS,
  LOCK_NAME,
  REACH_KEY,
  lockHeld,
  MANUAL_KEY,
  manualDue,
  MIN_READY,
  orderForProbe,
  parseLock,
  planReach,
  probeEndpoint,
  REACH_CONCURRENCY,
  REACH_STOP_AT,
  REACH_TIMEOUT_MS,
  saveReach,
  shouldProbeMore,
  targetsFrom,
  type ProbeKind,
  type ProbeMode,
  type ReachBook,
  type ReachHit,
  type ReachPlan,
  type ReachTarget,
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
  run: (force?: boolean) => Promise<void>
  fill: (targets: ReachTarget[], force?: boolean) => void
  scanTargets: (
    targets: ReachTarget[],
    signal: AbortSignal,
    onProgress: (done: number, total: number) => void,
  ) => Promise<void>
  remember: (hits: Record<string, ReachHit>) => void
}

type Job = {
  target: ReachTarget
  kind: ProbeKind
  batch: number
}

type Batch = {
  keys: string[]
  mode: ProbeMode
  started: number
}

const ReachContext = createContext<ReachContextValue | null>(null)

const idleProgress: ReachProgress = {
  running: false,
  done: 0,
  total: 0,
  open: 0,
  closed: 0,
  skipped: 0,
  label: '',
}
const MIN_VISIBLE_MS = 700

function initialBook(): ReachBook {
  if (typeof localStorage === 'undefined') return emptyBook()
  return loadReach()
}

function tabOwner(): string {
  const key = 'vless-hub-tab'
  try {
    const existing = sessionStorage.getItem(key)
    if (existing) return existing
    const created = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    sessionStorage.setItem(key, created)
    return created
  } catch {
    return `tab-${Math.random().toString(36).slice(2)}`
  }
}

function readManual(): number | null {
  try {
    const raw = localStorage.getItem(MANUAL_KEY)
    if (!raw) return null
    const value = Number(raw)
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

function writeManual(now: number) {
  try {
    localStorage.setItem(MANUAL_KEY, String(now))
  } catch {
    // The probe still runs for this tap. The next tap may run too.
  }
}

export function ReachProvider({ children }: { children: ReactNode }) {
  const [book, setBook] = useState<ReachBook>(initialBook)
  const [progress, setProgress] = useState<ReachProgress>(idleProgress)
  const [gate, setGate] = useState<GatePhase>(() => gateFromBook(initialBook(), Date.now()))
  const [openCount, setOpenCount] = useState(0)
  const bookRef = useRef(book)
  bookRef.current = book
  const targetsRef = useRef<ConfigRecord[]>([])
  const configList = useRef<ReachTarget[]>([])
  const lastFill = useRef<ReachTarget[]>([])
  const generation = useRef(0)
  const queue = useRef<Job[]>([])
  const queued = useRef(new Set<string>())
  const batches = useRef(new Map<number, Batch>())
  const batchSeq = useRef(0)
  const draining = useRef(false)
  const again = useRef(false)
  const holdSplash = useRef(false)
  const revealed = useRef(false)
  const splashStarted = useRef(0)
  const splashToken = useRef(0)
  const me = useRef(tabOwner())
  const channelRef = useRef<BroadcastChannel | null>(null)

  const countOpens = useCallback((keys: string[]) => {
    const now = Date.now()
    let open = 0
    for (const key of keys) {
      const hit = bookRef.current.byEndpoint[key]
      if (hitFresh(hit, now) && hit?.status === 'open') open += 1
    }
    return open
  }, [])

  const publishProgress = useCallback((running: boolean, label = '') => {
    const now = Date.now()
    let done = 0
    let open = 0
    let closed = 0
    let skipped = 0
    for (const target of configList.current) {
      const hit = bookRef.current.byEndpoint[endpointKey(target.host, target.port)]
      if (!hit) continue
      done += 1
      if (hit.status === 'open' && hitFresh(hit, now)) open += 1
      else if (hit.status === 'closed') closed += 1
      else if (hit.status === 'skip') skipped += 1
    }
    setOpenCount(open)
    setProgress({
      running,
      done,
      total: configList.current.length,
      open,
      closed,
      skipped,
      label,
    })
  }, [])

  const reveal = useCallback((token: number) => {
    if (revealed.current) return
    revealed.current = true
    const wait = MIN_VISIBLE_MS - (performance.now() - splashStarted.current)
    window.setTimeout(() => {
      if (token !== splashToken.current) return
      holdSplash.current = false
      setGate('ready')
    }, Math.max(0, wait))
  }, [])

  const refreshConfigGate = useCallback(() => {
    if (configList.current.length === 0) return
    const plan = planReach(configList.current, bookRef.current, Date.now(), false)
    publishProgress(queue.current.length > 0)
    if (holdSplash.current) {
      if (plan.freshOpen >= MIN_READY) reveal(splashToken.current)
      return
    }
    if (plan.freshOpen > 0) setGate('ready')
    else if (plan.pending.length === 0) setGate('short')
  }, [publishProgress, reveal])

  const post = useCallback((message: unknown) => {
    try {
      channelRef.current?.postMessage(message)
    } catch {
      // The channel is already closed.
    }
  }, [])

  const mergeHits = useCallback(
    (hits: Record<string, ReachHit>, broadcast: boolean) => {
      const keys = Object.keys(hits)
      if (keys.length === 0) return
      const next: ReachBook = {
        at: Date.now(),
        byEndpoint: { ...bookRef.current.byEndpoint, ...hits },
      }
      bookRef.current = next
      setBook(next)
      if (broadcast) {
        saveReach(next)
        for (const key of keys) post({ type: 'hit', key, hit: hits[key] })
      }
      refreshConfigGate()
    },
    [post, refreshConfigGate],
  )

  const pruneQueue = useCallback(() => {
    const now = Date.now()
    const next: Job[] = []
    const keep = new Set<string>()
    for (const job of queue.current) {
      const batch = batches.current.get(job.batch)
      const key = endpointKey(job.target.host, job.target.port)
      if (!batch) continue
      const hit = bookRef.current.byEndpoint[key]
      const opens = countOpens(batch.keys)
      if (!shouldProbeMore(batch.mode, job.kind, opens, batch.started)) continue
      if (batch.mode !== 'force' && hitFresh(hit, now)) continue
      next.push(job)
      keep.add(key)
    }
    queue.current = next
    queued.current = keep
  }, [countOpens])

  const takeJob = useCallback((): Job | null => {
    while (queue.current.length > 0) {
      const job = queue.current[0]
      const key = endpointKey(job.target.host, job.target.port)
      queue.current.shift()
      queued.current.delete(key)
      const batch = batches.current.get(job.batch)
      if (!batch) continue
      const hit = bookRef.current.byEndpoint[key]
      const opens = countOpens(batch.keys)
      if (!shouldProbeMore(batch.mode, job.kind, opens, batch.started)) continue
      if (batch.mode !== 'force' && hitFresh(hit, Date.now())) continue
      if (batch.mode === 'force') batch.started += 1
      return job
    }
    return null
  }, [countOpens])

  const pump = useCallback(
    async (ticket: number) => {
      const width = Math.max(1, Math.min(REACH_CONCURRENCY, queue.current.length))
      async function lane() {
        for (;;) {
          if (ticket !== generation.current || document.hidden) return
          const job = takeJob()
          if (!job) return
          const key = endpointKey(job.target.host, job.target.port)
          publishProgress(true, job.target.country || job.target.host)
          const hit = await probeEndpoint(job.target.host, job.target.port, REACH_TIMEOUT_MS, {
            transport: job.target.transport,
            path: job.target.path,
          })
          if (ticket !== generation.current) return
          mergeHits({ [key]: hit }, true)
        }
      }
      await Promise.all(Array.from({ length: width }, () => lane()))
      if (ticket === generation.current) post({ type: 'done' })
    },
    [mergeHits, post, publishProgress, takeJob],
  )

  const releaseLocalLock = useCallback(() => {
    const current = parseLock(readStorage(LOCK_KEY))
    if (current?.owner !== me.current) return
    try {
      localStorage.removeItem(LOCK_KEY)
    } catch {
      // Another tab can take over when the lease expires.
    }
  }, [])

  const tryLocalLock = useCallback(() => {
    const now = Date.now()
    if (lockHeld(parseLock(readStorage(LOCK_KEY)), now, me.current)) return false
    const next = { owner: me.current, until: now + LOCK_LEASE_MS }
    try {
      localStorage.setItem(LOCK_KEY, JSON.stringify(next))
      const againLock = parseLock(localStorage.getItem(LOCK_KEY))
      return againLock?.owner === me.current && againLock.until === next.until
    } catch {
      return false
    }
  }, [])

  const withLock = useCallback(
    async (work: () => Promise<void>) => {
      const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
      if (locks?.request) {
        let ran = false
        await locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
          if (!lock) return
          ran = true
          await work()
        })
        return ran
      }
      if (!tryLocalLock()) return false
      const beat = window.setInterval(() => {
        try {
          const current = parseLock(localStorage.getItem(LOCK_KEY))
          if (current?.owner === me.current) {
            localStorage.setItem(LOCK_KEY, JSON.stringify({ owner: me.current, until: Date.now() + LOCK_LEASE_MS }))
          }
        } catch {
          // The lease expires and another tab may continue.
        }
      }, 5_000)
      try {
        await work()
        return true
      } finally {
        window.clearInterval(beat)
        releaseLocalLock()
      }
    },
    [releaseLocalLock, tryLocalLock],
  )

  const settle = useCallback(() => {
    publishProgress(false)
    if (configList.current.length === 0) return
    const plan = planReach(configList.current, bookRef.current, Date.now(), false)
    if (holdSplash.current) {
      if (plan.freshOpen >= MIN_READY) reveal(splashToken.current)
      else {
        holdSplash.current = false
        setGate('short')
      }
      return
    }
    if (plan.freshOpen > 0) setGate('ready')
    else setGate('short')
  }, [publishProgress, reveal])

  const drainOnce = useCallback(async () => {
    if (draining.current) {
      again.current = true
      return
    }
    draining.current = true
    let blocked = false
    try {
      do {
        again.current = false
        if (document.hidden || queue.current.length === 0) break
        const ticket = generation.current
        const ran = await withLock(async () => {
          if (document.hidden || ticket !== generation.current) return
          await pump(ticket)
        })
        if (!ran) {
          blocked = true
          break
        }
      } while (again.current && !document.hidden && queue.current.length > 0)
    } finally {
      draining.current = false
      if (document.hidden) {
        publishProgress(false)
      } else if (queue.current.length === 0) {
        settle()
      } else if (again.current && !blocked) {
        void drainOnce()
      }
    }
  }, [publishProgress, pump, settle, withLock])

  const applyPlan = useCallback(
    (plan: ReachPlan, running: boolean) => {
      publishProgress(running && plan.pending.length > 0)
      if (plan.splash && plan.pending.length > 0) {
        splashToken.current += 1
        holdSplash.current = true
        revealed.current = false
        splashStarted.current = performance.now()
        setGate('scan')
        return
      }
      holdSplash.current = false
      if (plan.freshOpen > 0) setGate('ready')
      else if (plan.pending.length === 0 || plan.freshAny) setGate('short')
      else setGate('scan')
    },
    [publishProgress],
  )

  const enqueue = useCallback(
    (targets: ReachTarget[], force: boolean, touchGate: boolean) => {
      const now = Date.now()
      const plan = planReach(targets, bookRef.current, now, force)
      if (touchGate) applyPlan(plan, !document.hidden)
      if (plan.pending.length === 0) return
      if (force) {
        generation.current += 1
        queue.current = []
        queued.current.clear()
      }
      const mode: ProbeMode = force ? 'force' : plan.freshOpen >= REACH_STOP_AT ? 'topup' : 'find'
      const id = (batchSeq.current += 1)
      batches.current.set(id, {
        keys: [...new Set(targets.map((target) => endpointKey(target.host, target.port)))],
        mode,
        started: 0,
      })
      for (const target of plan.pending) {
        const key = endpointKey(target.host, target.port)
        if (queued.current.has(key)) continue
        queued.current.add(key)
        const hit = bookRef.current.byEndpoint[key]
        const kind: ProbeKind = mode === 'force' ? 'force' : hit && !hitFresh(hit, now) ? 'stale' : 'find'
        queue.current.push({ target, kind, batch: id })
      }
    },
    [applyPlan],
  )

  const stopForHide = useCallback(() => {
    generation.current += 1
    queue.current = []
    queued.current.clear()
    publishProgress(false)
  }, [publishProgress])

  const resume = useCallback(() => {
    if (configList.current.length > 0) enqueue(configList.current, false, true)
    if (lastFill.current.length > 0) enqueue(lastFill.current, false, false)
    void drainOnce()
  }, [drainOnce, enqueue])

  const run = useCallback(
    async (force = false) => {
      const targets = targetsFrom(orderForProbe(targetsRef.current))
      configList.current = targets
      if (targets.length === 0) {
        holdSplash.current = false
        setGate('short')
        setOpenCount(0)
        setProgress(idleProgress)
        return
      }
      const now = Date.now()
      if (force && !manualDue(readManual(), now)) {
        enqueue(targets, false, true)
        return
      }
      const plan = planReach(targets, bookRef.current, now, force)
      if (force && plan.pending.length > 0) writeManual(now)
      enqueue(targets, force, true)
      if (document.hidden) return
      await drainOnce()
    },
    [drainOnce, enqueue],
  )

  const fill = useCallback(
    (targets: ReachTarget[], force = false) => {
      if (targets.length === 0) return
      lastFill.current = targets
      const now = Date.now()
      if (force && !manualDue(readManual(), now)) return
      if (force && planReach(targets, bookRef.current, now, true).pending.length > 0) writeManual(now)
      enqueue(targets, force, false)
      if (!document.hidden) void drainOnce()
    },
    [drainOnce, enqueue],
  )

  const scanTargets = useCallback(
    (targets: ReachTarget[], signal: AbortSignal, onProgress: (done: number, total: number) => void) => {
      const keys = targets.map((target) => endpointKey(target.host, target.port))
      const report = () => {
        const now = Date.now()
        let done = 0
        let open = 0
        for (const key of keys) {
          const hit = bookRef.current.byEndpoint[key]
          if (!hitFresh(hit, now)) continue
          done += 1
          if (hit?.status === 'open') open += 1
        }
        onProgress(done, keys.length)
        return open
      }
      if (document.hidden || signal.aborted) {
        report()
        return Promise.resolve()
      }
      const drop = new Set(keys)
      const onAbort = () => {
        queue.current = queue.current.filter((job) => !drop.has(endpointKey(job.target.host, job.target.port)))
        for (const key of drop) queued.current.delete(key)
      }
      signal.addEventListener('abort', onAbort, { once: true })
      fill(targets, false)
      report()
      return new Promise<void>((resolve) => {
        const timer = window.setInterval(() => {
          if (signal.aborted || document.hidden) {
            window.clearInterval(timer)
            signal.removeEventListener('abort', onAbort)
            resolve()
            return
          }
          const open = report()
          const plan = planReach(targets, bookRef.current, Date.now(), false)
          if (open >= REACH_STOP_AT || plan.pending.length === 0) {
            window.clearInterval(timer)
            signal.removeEventListener('abort', onAbort)
            resolve()
          }
        }, 200)
      })
    },
    [fill],
  )

  const remember = useCallback((hits: Record<string, ReachHit>) => mergeHits(hits, true), [mergeHits])

  const setTargets = useCallback((configs: ConfigRecord[]) => {
    targetsRef.current = configs
  }, [])

  useEffect(() => {
    let channel: BroadcastChannel | null = null
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel(CHANNEL_NAME)
      } catch {
        channel = null
      }
    }
    channelRef.current = channel
    const onStorage = (event: StorageEvent) => {
      if (event.key !== REACH_KEY || !event.newValue) return
      try {
        const parsed = JSON.parse(event.newValue) as ReachBook
        if (!parsed?.byEndpoint) return
        const next = { at: Number(parsed.at) || 0, byEndpoint: parsed.byEndpoint }
        bookRef.current = next
        setBook(next)
        followUp()
      } catch {
        // Ignore a broken snapshot. The next save replaces it.
      }
    }
    const followUp = () => {
      pruneQueue()
      if (queue.current.length === 0 && !draining.current) {
        const plan =
          configList.current.length > 0 ? planReach(configList.current, bookRef.current, Date.now(), false) : null
        if (!plan || plan.pending.length === 0) settle()
        else refreshConfigGate()
        return
      }
      refreshConfigGate()
      if (!document.hidden && queue.current.length > 0) void drainOnce()
    }
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; key?: string; hit?: ReachHit } | null
      if (!data) return
      if (data.type === 'hit' && data.key && data.hit) {
        mergeHits({ [data.key]: data.hit }, false)
        followUp()
        return
      }
      if (data.type === 'done') followUp()
    }
    const onVis = () => {
      if (document.hidden) {
        stopForHide()
        return
      }
      resume()
    }
    window.addEventListener('storage', onStorage)
    document.addEventListener('visibilitychange', onVis)
    channel?.addEventListener('message', onMessage)
    const timer = window.setInterval(() => {
      if (document.hidden) return
      resume()
    }, CLOSED_TTL_MS)
    return () => {
      window.removeEventListener('storage', onStorage)
      document.removeEventListener('visibilitychange', onVis)
      channel?.removeEventListener('message', onMessage)
      window.clearInterval(timer)
      generation.current += 1
      channelRef.current = null
      try {
        channel?.close()
      } catch {
        // Already closed.
      }
    }
  }, [drainOnce, mergeHits, pruneQueue, refreshConfigGate, resume, settle, stopForHide])

  return (
    <ReachContext.Provider value={{ book, progress, gate, openCount, setTargets, run, fill, scanTargets, remember }}>
      {children}
    </ReachContext.Provider>
  )
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function useReach() {
  const context = useContext(ReachContext)
  if (!context) throw new Error('useReach must be used within ReachProvider')
  return context
}
