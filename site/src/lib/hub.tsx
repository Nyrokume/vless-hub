import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { loadHub } from '@/lib/data'
import type { HubData } from '@/lib/types'

const CHECK_MS = 3 * 60 * 1000

type HubContextValue = {
  data: HubData | null
  error: string | null
  loading: boolean
  refreshing: boolean
  updateAvailable: boolean
  refresh: () => Promise<void>
}

const HubContext = createContext<HubContextValue | null>(null)

function newConfigCount(previous: HubData | null, next: HubData): number {
  if (!previous) return next.configs.length
  const known = new Set(previous.configs.map((item) => item.id))
  return next.configs.filter((item) => !known.has(item.id)).length
}

export function HubProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<HubData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const dataRef = useRef<HubData | null>(null)
  dataRef.current = data

  const apply = useCallback((next: HubData, announce: boolean) => {
    const previous = dataRef.current
    if (announce) {
      if (previous && next.generated_at === previous.generated_at) {
        toast.success('Уже актуально')
      } else {
        const added = newConfigCount(previous, next)
        toast.success(added > 0 ? `Обновлено · +${added} новых` : 'Обновлено')
      }
    }
    setData(next)
    setUpdateAvailable(false)
    setError(null)
  }, [])

  const refresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      apply(await loadHub(true), true)
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'Не удалось обновить')
    } finally {
      setRefreshing(false)
    }
  }, [apply, refreshing])

  useEffect(() => {
    let cancelled = false
    loadHub(true)
      .then((next) => {
        if (!cancelled) apply(next, false)
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Ошибка загрузки')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [apply])

  useEffect(() => {
    let timer = 0
    const look = () => {
      if (document.visibilityState !== 'visible' || !dataRef.current) return
      void loadHub(true)
        .then((next) => {
          const current = dataRef.current?.generated_at
          if (current && next.generated_at !== current) setUpdateAvailable(true)
        })
        .catch(() => undefined)
    }
    const arm = () => {
      window.clearInterval(timer)
      if (document.visibilityState !== 'visible') return
      timer = window.setInterval(look, CHECK_MS)
    }
    arm()
    document.addEventListener('visibilitychange', arm)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', arm)
    }
  }, [])

  return (
    <HubContext.Provider value={{ data, error, loading, refreshing, updateAvailable, refresh }}>
      {children}
    </HubContext.Provider>
  )
}

export function useHub() {
  const context = useContext(HubContext)
  if (!context) throw new Error('useHub must be used within HubProvider')
  return context
}
