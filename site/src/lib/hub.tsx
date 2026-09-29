import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { loadHub, loadVersion } from '@/lib/data'
import { ru } from '@/lib/ru'
import type { HubData } from '@/lib/types'

const POLL_MS = 60_000

type HubContextValue = {
  data: HubData | null
  error: string | null
  loading: boolean
  refreshing: boolean
  updateAvailable: boolean
  refresh: () => Promise<void>
}

const HubContext = createContext<HubContextValue | null>(null)

function membership(data: HubData): Set<string> {
  const ids = new Set<string>()
  for (const item of data.configs) ids.add(`c:${item.id}`)
  for (const item of data.proxies ?? []) ids.add(`p:${item.id}`)
  return ids
}

function listDelta(previous: HubData, next: HubData): { added: number; removed: number } {
  const before = membership(previous)
  const after = membership(next)
  let added = 0
  let removed = 0
  for (const id of after) if (!before.has(id)) added += 1
  for (const id of before) if (!after.has(id)) removed += 1
  return { added, removed }
}

export function HubProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<HubData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const dataRef = useRef<HubData | null>(null)
  const chain = useRef(Promise.resolve())
  dataRef.current = data

  const apply = useCallback((next: HubData, mode: 'silent' | 'manual' | 'auto') => {
    const previous = dataRef.current
    const same = Boolean(previous && next.generated_at === previous.generated_at)
    if (previous && !same && (mode === 'manual' || mode === 'auto')) {
      const { added, removed } = listDelta(previous, next)
      toast(ru.listUpdated(added, removed), { duration: 2800 })
    }
    dataRef.current = next
    setData(next)
    setError(null)
  }, [])

  const pullOnce = useCallback(
    async (mode: 'manual' | 'auto') => {
      if (mode === 'manual') setRefreshing(true)
      try {
        if (mode === 'auto') {
          let stamp: string | null = null
          try {
            stamp = await loadVersion()
          } catch {
            stamp = null
          }
          const current = dataRef.current?.generated_at
          if (stamp && current && stamp === current) return
          setRefreshing(true)
        }
        apply(await loadHub(true), mode)
      } catch (reason) {
        if (mode === 'manual') {
          toast.error(reason instanceof Error ? reason.message : ru.refreshFailed)
        }
      } finally {
        setRefreshing(false)
      }
    },
    [apply],
  )

  const pull = useCallback(
    (mode: 'manual' | 'auto') => {
      const job = chain.current.then(() => pullOnce(mode))
      chain.current = job.then(
        () => undefined,
        () => undefined,
      )
      return job
    },
    [pullOnce],
  )

  const refresh = useCallback(() => pull('manual'), [pull])

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    void navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) void registration.unregister()
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    loadHub(true)
      .then((next) => {
        if (!cancelled) apply(next, 'silent')
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : ru.loadFailed)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [apply])

  useEffect(() => {
    if (loading) return
    let timer = 0
    const stop = () => window.clearInterval(timer)
    const start = () => {
      stop()
      if (document.visibilityState !== 'visible') return
      timer = window.setInterval(() => void pull('auto'), POLL_MS)
    }
    const now = () => {
      if (document.visibilityState !== 'visible') return
      void pull('auto')
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        now()
        start()
      } else {
        stop()
      }
    }
    start()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', now)
    window.addEventListener('online', now)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', now)
      window.removeEventListener('online', now)
    }
  }, [loading, pull])

  return (
    <HubContext.Provider value={{ data, error, loading, refreshing, updateAvailable: false, refresh }}>
      {children}
    </HubContext.Provider>
  )
}

export function useHub() {
  const context = useContext(HubContext)
  if (!context) throw new Error('useHub must be used within HubProvider')
  return context
}
