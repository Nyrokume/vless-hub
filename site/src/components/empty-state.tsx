import { Button } from '@/components/ui/button'

/** Original monochrome robot. No third-party marks. */
export function EmptyMascot({ className = 'size-24' }: { className?: string }) {
  return (
    <svg viewBox="0 0 128 128" className={className} fill="none" aria-hidden>
      <line x1="58" y1="22" x2="58" y2="14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="58" cy="10" r="3.5" fill="currentColor" />
      <rect x="28" y="22" width="60" height="52" rx="16" stroke="currentColor" strokeWidth="2.5" />
      <rect x="18" y="38" width="10" height="16" rx="4" stroke="currentColor" strokeWidth="2.5" />
      <rect x="88" y="38" width="10" height="16" rx="4" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="46" cy="46" r="4" fill="currentColor" />
      <circle cx="70" cy="46" r="4" fill="currentColor" />
      <path d="M48 60h20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="90" cy="88" r="16" stroke="currentColor" strokeWidth="2.5" />
      <line x1="102" y1="100" x2="116" y2="114" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

export function EmptyState({
  title,
  text,
  action,
}: {
  title?: string
  text: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
      <EmptyMascot className="size-24 text-foreground" />
      {title ? <p className="text-[17px] font-medium">{title}</p> : null}
      <p className="max-w-xs text-[15px] text-muted-foreground">{text}</p>
      {action ? (
        <Button variant="secondary" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  )
}
