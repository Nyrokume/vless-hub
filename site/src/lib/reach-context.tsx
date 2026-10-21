import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { bookFromConfigs, emptyBook, type ReachBook, type ReachHit, type ReachTarget } from '@/lib/reach'
import type { ConfigRecord } from '@/lib/types'

/**
 * Status book built from the server-side check in configs.json.
 * Nothing here opens a connection from the browser.
 */

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

const idleProgress: ReachProgress = { running: false, done: 0, total: 0, open: 0, closed: 0, skipped: 0, label: '' }

const ReachContext = createContext<ReachContextValue | null>(null)

export function ReachProvider({ children }: { children: ReactNode }) {
  const [book, setBook] = useState<ReachBook>(emptyBook)

  const setTargets = useCallback((configs: ConfigRecord[]) => {
    const next = bookFromConfigs(configs)
    setBook((current) => ({ at: next.at, byEndpoint: { ...current.byEndpoint, ...next.byEndpoint } }))
  }, [])
  const remember = useCallback((hits: Record<string, ReachHit>) => {
    setBook((current) => ({ at: Date.now(), byEndpoint: { ...current.byEndpoint, ...hits } }))
  }, [])
  const run = useCallback(async () => {}, [])
  const fill = useCallback(() => {}, [])
  const scanTargets = useCallback<ReachContextValue['scanTargets']>(async (targets, _signal, onProgress) => {
    onProgress(targets.length, targets.length)
  }, [])

  const openCount = Object.values(book.byEndpoint).filter((hit) => hit.status === 'open').length

  return (
    <ReachContext.Provider
      value={{ book, progress: idleProgress, gate: 'ready', openCount, setTargets, run, fill, scanTargets, remember }}
    >
      {children}
    </ReachContext.Provider>
  )
}

export function useReach() {
  const context = useContext(ReachContext)
  if (!context) throw new Error('useReach must be used within ReachProvider')
  return context
}
