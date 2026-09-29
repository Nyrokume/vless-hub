import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useHub } from '@/lib/hub'
import { ru } from '@/lib/ru'
import { dispatchServerCheck, findDispatchSince, openActionsPage, readActionsToken } from '@/lib/server-check'

type ServerPhase = 'idle' | 'running'

type ServerCheckContextValue = {
  phase: ServerPhase
  start: () => Promise<void>
}

const ServerCheckContext = createContext<ServerCheckContextValue | null>(null)

const POLL_MS = 15_000
const DEADLINE_MS = 20 * 60 * 1000

function tokenMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : ''
  if (code === 'unauthorized') return ru.serverTokenBad
  if (code === 'forbidden') return ru.serverTokenDenied
  return ru.serverTokenError
}

export function ServerCheckProvider({ children }: { children: ReactNode }) {
  const { refresh } = useHub()
  const [phase, setPhase] = useState<ServerPhase>('idle')
  const timer = useRef(0)
  const running = useRef(false)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const start = useCallback(async () => {
    if (running.current) return
    const token = readActionsToken()
    if (!token) {
      openActionsPage()
      toast(ru.serverCheckManual)
      return
    }
    const since = Date.now()
    try {
      await dispatchServerCheck(token)
    } catch (error) {
      toast.error(tokenMessage(error))
      openActionsPage()
      return
    }
    running.current = true
    setPhase('running')
    toast(ru.serverCheckRunning)
    const deadline = Date.now() + DEADLINE_MS
    const tick = async () => {
      let run: Awaited<ReturnType<typeof findDispatchSince>> = null
      try {
        run = await findDispatchSince(token, since)
      } catch {
        run = null
      }
      if (run && run.status === 'completed') {
        running.current = false
        setPhase('idle')
        if (run.conclusion === 'success') {
          await refresh()
          toast(ru.serverCheckDone)
        } else {
          toast.error(ru.serverCheckFailed)
        }
        return
      }
      if (Date.now() > deadline) {
        running.current = false
        setPhase('idle')
        toast(ru.serverCheckSlow)
        return
      }
      timer.current = window.setTimeout(() => void tick(), POLL_MS)
    }
    timer.current = window.setTimeout(() => void tick(), 8000)
  }, [refresh])

  return <ServerCheckContext.Provider value={{ phase, start }}>{children}</ServerCheckContext.Provider>
}

export function useServerCheck() {
  const context = useContext(ServerCheckContext)
  if (!context) throw new Error('useServerCheck must be used within ServerCheckProvider')
  return context
}
