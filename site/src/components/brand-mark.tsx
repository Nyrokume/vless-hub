import { cn } from '@/lib/utils'

/** V2Hub mark: a hub dot with two signal arcs. `live` animates the arcs one by one. */
export function BrandMark({ className, live = false }: { className?: string; live?: boolean }) {
  return (
    <svg viewBox="0 0 40 40" className={cn('size-9', className)} fill="none" aria-hidden>
      <rect x="1" y="1" width="38" height="38" rx="11" className="fill-foreground" />
      <circle cx="14" cy="26" r="3.2" className={cn('fill-background', live && 'v2-mark-dot')} />
      <path d="M14 17.5a8.5 8.5 0 0 1 8.5 8.5" strokeWidth="3" strokeLinecap="round" className={cn('stroke-background', live && 'v2-mark-arc v2-mark-arc-1')} />
      <path d="M14 10a16 16 0 0 1 16 16" strokeWidth="3" strokeLinecap="round" className={cn('stroke-background', live && 'v2-mark-arc v2-mark-arc-2')} />
    </svg>
  )
}
