import { Component, type ReactNode } from 'react'
import { BrandMark } from '@/components/brand-mark'
import { Button } from '@/components/ui/button'

/** Last line of defence: a calm page instead of a white screen. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 pb-[max(2rem,env(safe-area-inset-bottom))] text-center">
        <BrandMark className="size-14" />
        <h1 className="text-[24px] leading-tight font-semibold text-balance">Страница споткнулась</h1>
        <p className="text-[17px] leading-snug text-muted-foreground text-pretty">
          Список серверов цел. Обновите страницу, и всё загрузится заново.
        </p>
        <Button size="lg" onClick={() => location.reload()}>
          Обновить
        </Button>
      </div>
    )
  }
}
