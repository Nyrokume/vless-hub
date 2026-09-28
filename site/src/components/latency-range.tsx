import { latencyClass, latencyRange, latencyText } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Min ~ max ping, each number coloured the same way as a country group. */
export function LatencyRange({
  min,
  max,
  className,
}: {
  min: number | null
  max: number | null
  className?: string
}) {
  const range = latencyRange(min, max)
  const box = cn('shrink-0 font-semibold tabular-nums whitespace-nowrap', className ?? 'text-[13px]')
  if (range.kind === 'empty') {
    return <span className={cn(box, 'text-muted-foreground')}>—</span>
  }
  if (range.kind === 'single') {
    return <span className={cn(box, latencyClass(range.ms))}>{latencyText(range.ms)}</span>
  }
  return (
    <span className={box}>
      <span className={latencyClass(range.min)}>{latencyText(range.min)}</span>
      <span className="font-normal text-muted-foreground"> ~ </span>
      <span className={latencyClass(range.max)}>{latencyText(range.max)}</span>
    </span>
  )
}
