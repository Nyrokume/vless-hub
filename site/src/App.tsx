import { useCallback, useEffect, useState } from 'react'
import { ConnectionScreen } from '@/components/connection-screen'
import { InspectScreen } from '@/components/inspect-screen'
import { SettingsScreen } from '@/components/settings-screen'
import { TelegramScreen } from '@/components/telegram-screen'
import { TabBar, type AppTab } from '@/components/tab-bar'
import { Button } from '@/components/ui/button'
import { loadHub } from '@/lib/data'
import type { HubData } from '@/lib/types'

function useHub() {
  const [data, setData] = useState<HubData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await loadHub())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { data, error, loading, reload }
}

export default function App() {
  const [tab, setTab] = useState<AppTab>('connection')
  const { data, error, loading, reload } = useHub()

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <main className="pb-24">
        {tab === 'settings' ? (
          <SettingsScreen data={data} />
        ) : tab === 'inspect' ? (
          <InspectScreen />
        ) : loading && !data ? (
          <LoadingState />
        ) : error && !data ? (
          <ErrorState message={error} onRetry={() => void reload()} />
        ) : data && tab === 'telegram' ? (
          <TelegramScreen data={data} />
        ) : data ? (
          <ConnectionScreen data={data} onReload={() => void reload()} onOpenSettings={() => setTab('settings')} />
        ) : null}
      </main>
      <TabBar tab={tab} onChange={setTab} />
    </div>
  )
}

function LoadingState() {
  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="size-[72px] animate-pulse rounded-full bg-card" />
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
