import type { ReactNode } from 'react'
import { Moon, RefreshCw, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { useHub } from '@/lib/hub'
import { useReach } from '@/lib/reach-context'
import { ru } from '@/lib/ru'
import { cn } from '@/lib/utils'

export function SiteHeader({ updated, menu }: { updated?: string; menu?: ReactNode }) {
  const { resolvedTheme, setTheme } = useTheme()
  const { refreshing, refresh } = useHub()
  const { progress, run } = useReach()
  const busy = refreshing || progress.running
  const dark = resolvedTheme !== 'light'
  return (
    <header className="flex items-center gap-2 pb-2">
      <div className="min-w-0 flex-1">
        <p className="text-[17px] leading-none font-semibold tracking-tight">{ru.brand}</p>
        {updated && <p className="mt-1 text-[13px] text-muted-foreground">{updated}</p>}
      </div>
      {menu}
      <Button
        variant="ghost"
        size="icon"
        aria-label={ru.refresh}
        disabled={busy}
        onClick={() => {
          void (async () => {
            await refresh()
            await run()
          })()
        }}
      >
        <RefreshCw className={cn(busy && 'animate-spin')} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={dark ? ru.themeLight : ru.themeDark}
        onClick={() => setTheme(dark ? 'light' : 'dark')}
      >
        {dark ? <Sun /> : <Moon />}
      </Button>
    </header>
  )
}
