import type { ReactNode } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'

export function SiteHeader({ updated, menu }: { updated?: string; menu?: ReactNode }) {
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme !== 'light'
  return (
    <header className="flex items-center gap-3 pb-2">
      <div className="min-w-0 flex-1">
        <p className="text-[17px] leading-none font-semibold tracking-tight">V2Hub</p>
        {updated && <p className="mt-1 text-[13px] text-muted-foreground">{updated}</p>}
      </div>
      {menu}
      <Button
        variant="ghost"
        size="icon"
        aria-label={dark ? 'Светлая тема' : 'Тёмная тема'}
        onClick={() => setTheme(dark ? 'light' : 'dark')}
      >
        {dark ? <Sun /> : <Moon />}
      </Button>
    </header>
  )
}
