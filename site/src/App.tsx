import { useState } from 'react'
import { ConfigsScreen } from '@/components/configs-screen'
import { ExportScreen } from '@/components/export-screen'
import { SettingsScreen } from '@/components/settings-screen'
import { TelegramScreen } from '@/components/telegram-screen'
import { TabBar, type AppTab } from '@/components/tab-bar'
import { EmptyState } from '@/components/empty-state'
import { Preloader } from '@/components/preloader'
import { SideNav } from '@/components/tab-bar'
import { useHub } from '@/lib/hub'
import { ru } from '@/lib/ru'

export default function App() {
  const [tab, setTab] = useState<AppTab>('configs')
  const { data, error, loading, refresh } = useHub()

  return (
    <div className="min-h-dvh bg-background text-foreground lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <SideNav tab={tab} onChange={setTab} />
      <main className="pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-[max(3rem,env(safe-area-inset-bottom))]">
        {tab === 'settings' ? (
          <SettingsScreen data={data} />
        ) : loading && !data ? (
          <LoadingState />
        ) : error && !data ? (
          <ErrorState message={error} onRetry={() => void refresh()} />
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
  return <Preloader />
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center px-6">
      <EmptyState title={ru.noData} text={message} action={{ label: ru.retry, onClick: onRetry }} />
    </div>
  )
}
