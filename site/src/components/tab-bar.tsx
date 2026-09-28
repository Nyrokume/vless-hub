import { Cable, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

export type AppTab = 'connection' | 'settings'

const TABS: { id: AppTab; label: string; icon: typeof Cable }[] = [
  { id: 'connection', label: 'Подключение', icon: Cable },
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
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
      aria-label="Разделы"
    >
      <div className="mx-auto grid h-16 max-w-lg grid-cols-2" role="tablist">
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
                'flex flex-col items-center justify-center gap-1 text-[11px] font-medium',
                active ? 'text-primary' : 'text-muted-foreground',
              )}
              onClick={() => onChange(item.id)}
            >
              <Icon className="size-6" strokeWidth={active ? 2.25 : 1.75} />
              {item.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
