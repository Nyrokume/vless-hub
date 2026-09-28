import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import type { FilterDraft } from '@/lib/filters'
import { protocolLabel, securityLabel, transportLabel } from '@/lib/format'
import { formatCount } from '@/lib/plural'
import { ru } from '@/lib/ru'
import { SORTS, THRESHOLDS, VIEWS, thresholdKey } from '@/lib/settings'
import { cn } from '@/lib/utils'

function Chip({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full px-3 py-1.5 text-sm',
        active ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground',
      )}
    >
      {children}
    </button>
  )
}

export function FilterSheet({
  open,
  onOpenChange,
  countries,
  transports,
  securities,
  protocols,
  draft,
  onDraft,
  unverifiedCount,
  unstableCount,
  resultCount,
  onApply,
  onExpandGroups,
  onCollapseGroups,
  onReset,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  countries: { code: string; name: string; count: number }[]
  transports: { id: string; count: number }[]
  securities: { id: string; count: number }[]
  protocols: { id: string; count: number }[]
  draft: FilterDraft
  onDraft: (patch: Partial<FilterDraft>) => void
  unverifiedCount: number
  unstableCount: number
  resultCount: number
  onApply: () => void
  onExpandGroups: () => void
  onCollapseGroups: () => void
  onReset: () => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[88dvh]! max-h-[88dvh]! gap-0 overflow-hidden rounded-t-3xl p-0">
        <SheetHeader className="shrink-0 pr-10 text-left">
          <SheetTitle>{ru.filters}</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4">
          <div>
            <div className="mb-2 text-[13px] font-medium tracking-wide text-muted-foreground uppercase">{ru.view}</div>
            <div className="flex flex-wrap gap-2">
              {VIEWS.map((item) => (
                <Chip key={item.value} active={draft.view === item.value} onClick={() => onDraft({ view: item.value })}>
                  {item.label}
                </Chip>
              ))}
            </div>
            {draft.view === 'country' && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Chip active={false} onClick={onExpandGroups}>
                  {ru.expandGroups}
                </Chip>
                <Chip active={false} onClick={onCollapseGroups}>
                  {ru.collapseGroups}
                </Chip>
              </div>
            )}
          </div>
          <div>
            <div className="mb-2 text-[13px] font-medium tracking-wide text-muted-foreground uppercase">{ru.sort}</div>
            <div className="flex flex-wrap gap-2">
              {SORTS.map((item) => (
                <Chip key={item.value} active={draft.sort === item.value} onClick={() => onDraft({ sort: item.value })}>
                  {item.label}
                </Chip>
              ))}
            </div>
          </div>
          {(unverifiedCount > 0 || unstableCount > 0) && (
            <div className="overflow-hidden rounded-2xl bg-card">
              {unstableCount > 0 && (
                <label className="flex items-center justify-between gap-3 px-4 py-3">
                  <span>{ru.showUnstable}</span>
                  <Switch
                    checked={draft.showUnstable}
                    onCheckedChange={(value) => onDraft({ showUnstable: value })}
                  />
                </label>
              )}
              {unverifiedCount > 0 && unstableCount > 0 && <Separator />}
              {unverifiedCount > 0 && (
                <label className="flex items-center justify-between gap-3 px-4 py-3">
                  <span>{ru.showUnverified}</span>
                  <Switch
                    checked={draft.showUnverified}
                    onCheckedChange={(value) => onDraft({ showUnverified: value })}
                  />
                </label>
              )}
            </div>
          )}
          <div>
            <div className="mb-2 text-[13px] font-medium tracking-wide text-muted-foreground uppercase">{ru.ping}</div>
            <div className="flex flex-wrap gap-2">
              {THRESHOLDS.map((item) => (
                <Chip
                  key={item.value}
                  active={thresholdKey(draft.threshold) === item.value}
                  onClick={() => onDraft({ threshold: item.value === 'all' ? null : Number(item.value) })}
                >
                  {item.label}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-[13px] font-medium tracking-wide text-muted-foreground uppercase">
              {ru.protocol}
            </div>
            <div className="flex flex-wrap gap-2">
              <Chip active={draft.protocol === null} onClick={() => onDraft({ protocol: null })}>
                {ru.all}
              </Chip>
              {protocols.map((item) => (
                <Chip
                  key={item.id}
                  active={draft.protocol === item.id}
                  onClick={() => onDraft({ protocol: item.id })}
                >
                  {`${protocolLabel(item.id)} · ${formatCount(item.count)}`}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-[13px] font-medium tracking-wide text-muted-foreground uppercase">
              {ru.connection}
            </div>
            <div className="flex flex-wrap gap-2">
              <Chip active={draft.transport === null} onClick={() => onDraft({ transport: null })}>
                {ru.all}
              </Chip>
              {transports.map((item) => (
                <Chip
                  key={item.id}
                  active={draft.transport === item.id}
                  onClick={() => onDraft({ transport: item.id })}
                >
                  {`${transportLabel(item.id)} · ${formatCount(item.count)}`}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-[13px] font-medium tracking-wide text-muted-foreground uppercase">
              {ru.security}
            </div>
            <div className="flex flex-wrap gap-2">
              <Chip active={draft.security === null} onClick={() => onDraft({ security: null })}>
                {ru.all}
              </Chip>
              {securities.map((item) => (
                <Chip
                  key={item.id}
                  active={draft.security === item.id}
                  onClick={() => onDraft({ security: item.id })}
                >
                  {`${securityLabel(item.id)} · ${formatCount(item.count)}`}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-[13px] font-medium tracking-wide text-muted-foreground uppercase">
              {ru.country}
            </div>
            <div className="overflow-hidden rounded-2xl bg-card">
              <ScrollArea className="h-56">
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                  onClick={() => onDraft({ country: null })}
                >
                  <span>{ru.allCountries}</span>
                  {draft.country === null && <span className="text-primary">●</span>}
                </button>
                {countries.map((item) => (
                  <div key={item.code}>
                    <Separator />
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-4 py-3 text-left"
                      onClick={() => onDraft({ country: item.code })}
                    >
                      <span>
                        {item.name} <span className="text-muted-foreground">{item.code}</span>
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {draft.country === item.code ? '●' : formatCount(item.count)}
                      </span>
                    </button>
                  </div>
                ))}
              </ScrollArea>
            </div>
          </div>
        </div>
        <SheetFooter className="shrink-0 flex-row gap-2 border-t border-border bg-popover pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button variant="secondary" className="flex-1" onClick={onReset}>
            {ru.resetFilters}
          </Button>
          <Button className="flex-1" onClick={onApply}>
            {ru.showCount(resultCount)}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
