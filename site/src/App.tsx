import { useCallback, useEffect, useState } from 'react'
import { ConfigsScreen } from '@/components/configs-screen'
import { ExportScreen } from '@/components/export-screen'
import { GuideScreen } from '@/components/guide-screen'
import { TelegramScreen } from '@/components/telegram-screen'
import { TabBar, type AppTab } from '@/components/tab-bar'
import { Button } from '@/components/ui/button'
import { loadHub } from '@/lib/data'
import { useSettings } from '@/lib/settings'
import type { HubData } from '@/lib/types'

const AUTO_REFRESH_MS = 15 * 60 * 1000

function useHub() {
  const [data, setData] = useState<HubData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async (force = false) => {
    if (!force) setLoading(true)
    setError(null)
    try {
      setData(await loadHub(force))
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Ошибка загрузки'
      setError(message)
      throw new Error(message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload().catch(() => undefined)
  }, [reload])

  return { data, error, loading, reload }
}

export default function App() {
  const [tab, setTab] = useState<AppTab>('configs')
  const { settings } = useSettings()
  const { data, error, loading, reload } = useHub()

  useEffect(() => {
    if (!settings.autoRefresh) return
    const refresh = () => {
      if (document.visibilityState === 'visible') void reload(true).catch(() => undefined)
    }
    document.addEventListener('visibilitychange', refresh)
    const timer = window.setInterval(() => void reload(true).catch(() => undefined), AUTO_REFRESH_MS)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.clearInterval(timer)
    }
  }, [reload, settings.autoRefresh])

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <main className="pb-24">
        {tab === 'guide' ? (
          <GuideScreen data={data} onRefresh={() => reload(true)} />
        ) : loading && !data ? (
          <LoadingState />
        ) : error && !data ? (
          <ErrorState message={error} onRetry={() => void reload()} />
        ) : data && tab === 'telegram' ? (
          <TelegramScreen data={data} />
        ) : data && tab === 'export' ? (
          <ExportScreen data={data} />
        ) : data ? (
          <ConfigsScreen data={data} />
        ) : null}
      </main>
      <TabBar tab={tab} onChange={setTab} />
    </div>
  )
}

function LoadingState() {
  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm text-muted-foreground">Загружаем результаты сборщика…</p>
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="rounded-2xl bg-card px-4 py-5">
        <p className="text-[17px] font-medium">Нет данных</p>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      </div>
      <Button onClick={onRetry}>Повторить</Button>
    </div>
  )
}
