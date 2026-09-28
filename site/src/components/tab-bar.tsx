import { Download, List, Send, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

export type AppTab = 'configs' | 'telegram' | 'export' | 'settings'

const TABS: { id: AppTab; label: string; icon: typeof List }[] = [
  { id: 'configs', label: 'Конфигурации Vless', icon: List },
  { id: 'telegram', label: 'Telegram Proxy', icon: Send },
  { id: 'export', label: 'Экспорт', icon: Download },
  { id: 'settings', label: 'Настройки', icon: Settings },
]

export function TabBar({
  tab,
  onChange,
}: {
  tab: AppTab
  onChange: (tab: AppTab) => void
}) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[max(0.25rem,env(safe-area-inset-bottom))] backdrop-blur-md"
      aria-label="Разделы"
    >
      <div className="mx-auto grid h-auto min-h-16 max-w-lg grid-cols-4" role="tablist">
        {TABS.map((item) => {
          const active = tab === item.id
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-center text-[10px] leading-tight font-medium',
                active ? 'text-primary' : 'text-muted-foreground',
              )}
              onClick={() => onChange(item.id)}
            >
              <Icon className="size-5" strokeWidth={active ? 2.25 : 1.75} />
              {item.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
