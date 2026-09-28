import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function IconTile({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-[8px] bg-primary text-primary-foreground',
        className,
      )}
    >
      {children}
    </span>
  )
}
