import { BrandMark } from '@/components/brand-mark'
import { ru } from '@/lib/ru'

/** Short brand story: the hub lights up, the signal goes out arc by arc, the list follows. */
export function Preloader() {
  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center gap-5 px-6 text-center" role="status">
      <BrandMark live className="size-16" />
      <div className="flex w-48 flex-col gap-2" aria-hidden>
        <span className="v2-skel h-2.5 w-full rounded-full bg-muted" />
        <span className="v2-skel h-2.5 w-3/4 self-center rounded-full bg-muted [animation-delay:.15s]" />
      </div>
      <p className="text-[15px] text-muted-foreground">{ru.loading}</p>
    </div>
  )
}
