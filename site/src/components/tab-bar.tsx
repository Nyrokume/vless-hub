import { Download, List, Send, Settings } from 'lucide-react'
import { ru } from '@/lib/ru'
import { cn } from '@/lib/utils'
import { BrandMark } from '@/components/brand-mark'

export type AppTab = 'configs' | 'telegram' | 'export' | 'settings'

const TABS: { id: AppTab; label: string; icon: typeof List }[] = [
  { id: 'configs', label: ru.tabs.configs, icon: List },
  { id: 'telegram', label: ru.tabs.telegram, icon: Send },
  { id: 'export', label: ru.tabs.export, icon: Download },
  { id: 'settings', label: ru.tabs.settings, icon: Settings },
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
      className="fixed inset-x-0 bottom-0 z-40 lg:hidden border-t border-border bg-background/95 pb-[max(0.25rem,env(safe-area-inset-bottom))] backdrop-blur-md"
      aria-label={ru.tabs.nav}
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
                'v2-press flex min-w-0 flex-col items-center justify-center gap-1 px-1 py-2 text-center text-[11px] leading-tight font-medium',
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

/** Desktop navigation: the same four tabs as a quiet left rail. */
export function SideNav({ tab, onChange }: { tab: AppTab; onChange: (tab: AppTab) => void }) {
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col gap-8 border-r border-border px-5 py-7 lg:flex">
      <div className="flex items-center gap-3 px-2">
        <BrandMark />
        <span className="text-[18px] font-semibold tracking-tight">{ru.brand}</span>
      </div>
      <nav className="flex flex-col gap-1" aria-label={ru.tabs.nav}>
        {TABS.map((item) => {
          const active = tab === item.id
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              className={cn(
                'v2-press flex min-h-11 items-center gap-3 rounded-xl px-3 text-left text-[15px] font-medium transition-colors',
                active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
              )}
              onClick={() => onChange(item.id)}
            >
              <Icon className="size-[18px] shrink-0" strokeWidth={active ? 2.25 : 1.75} />
              <span className="min-w-0 truncate">{item.label}</span>
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
