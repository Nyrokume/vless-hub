import { useCallback, useEffect, useState } from 'react'
import { Cable, Settings } from 'lucide-react'
import { ConnectionScreen } from '@/components/connection-screen'
import { SettingsScreen } from '@/components/settings-screen'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { loadHub } from '@/lib/data'
import type { HubData } from '@/lib/types'

export type AppTab = 'connection' | 'settings'

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
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as AppTab)}
      className="h-dvh gap-0"
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <TabsContent value="connection" forceMount className="data-[state=inactive]:hidden">
          {loading && !data ? (
            <LoadingState />
          ) : error && !data ? (
            <ErrorState message={error} onRetry={() => void reload()} />
          ) : data ? (
            <ConnectionScreen
              data={data}
              onReload={() => void reload()}
              onOpenSettings={() => setTab('settings')}
            />
          ) : null}
        </TabsContent>
        <TabsContent value="settings" forceMount className="data-[state=inactive]:hidden">
          <SettingsScreen data={data} />
        </TabsContent>
      </div>
      <TabsList
        aria-label="Разделы"
        className="h-16 w-full shrink-0 rounded-none border-t bg-background p-1 pb-[env(safe-area-inset-bottom)]"
      >
        <TabsTrigger value="connection" className="h-full flex-col gap-1">
          <Cable />
          Подключение
        </TabsTrigger>
        <TabsTrigger value="settings" className="h-full flex-col gap-1">
          <Settings />
          Настройки
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}

function LoadingState() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-4 pt-16">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-10 w-48" />
      <Skeleton className="size-24 rounded-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-28 w-full" />
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Empty className="min-h-[70dvh]">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Cable />
        </EmptyMedia>
        <EmptyTitle>Нет данных</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={onRetry}>Повторить</Button>
      </EmptyContent>
    </Empty>
  )
}
