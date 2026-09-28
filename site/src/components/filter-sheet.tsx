import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { protocolLabel, securityLabel, transportLabel } from '@/lib/format'
import { THRESHOLDS, thresholdKey } from '@/lib/settings'
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
  country,
  transport,
  security,
  protocol,
  threshold,
  onCountry,
  onTransport,
  onSecurity,
  onProtocol,
  onThreshold,
  onReset,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  countries: { code: string; name: string; count: number }[]
  transports: { id: string; count: number }[]
  securities: { id: string; count: number }[]
  protocols: { id: string; count: number }[]
  country: string | null
  transport: string | null
  security: string | null
  protocol: string | null
  threshold: number | null
  onCountry: (code: string | null) => void
  onTransport: (id: string | null) => void
  onSecurity: (id: string | null) => void
  onProtocol: (id: string | null) => void
  onThreshold: (value: number | null) => void
  onReset: () => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[88dvh] gap-3 overflow-y-auto rounded-t-3xl">
        <SheetHeader className="pr-10 text-left">
          <SheetTitle>Фильтры</SheetTitle>
          <SheetDescription>Протокол, страна, транспорт, безопасность и порог задержки.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          <div>
            <div className="mb-2 text-[13px] font-medium tracking-wide text-muted-foreground uppercase">
              Задержка
            </div>
            <div className="flex flex-wrap gap-2">
              {THRESHOLDS.map((item) => (
                <Chip
                  key={item.value}
                  active={thresholdKey(threshold) === item.value}
                  onClick={() => onThreshold(item.value === 'all' ? null : Number(item.value))}
                >
                  {item.label}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-[13px] font-medium tracking-wide text-muted-foreground uppercase">
              Протокол
            </div>
            <div className="flex flex-wrap gap-2">
              <Chip active={protocol === null} onClick={() => onProtocol(null)}>
                Все
              </Chip>
              {protocols.map((item) => (
                <Chip
                  key={item.id}
                  active={protocol === item.id}
                  onClick={() => onProtocol(item.id)}
                >
                  {`${protocolLabel(item.id)} · ${item.count}`}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-[13px] font-medium tracking-wide text-muted-foreground uppercase">
              Транспорт
            </div>
            <div className="flex flex-wrap gap-2">
              <Chip active={transport === null} onClick={() => onTransport(null)}>
                Все
              </Chip>
              {transports.map((item) => (
                <Chip
                  key={item.id}
                  active={transport === item.id}
                  onClick={() => onTransport(item.id)}
                >
                  {`${transportLabel(item.id)} · ${item.count}`}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-[13px] font-medium tracking-wide text-muted-foreground uppercase">
              Безопасность
            </div>
            <div className="flex flex-wrap gap-2">
              <Chip active={security === null} onClick={() => onSecurity(null)}>
                Все
              </Chip>
              {securities.map((item) => (
                <Chip
                  key={item.id}
                  active={security === item.id}
                  onClick={() => onSecurity(item.id)}
                >
                  {`${securityLabel(item.id)} · ${item.count}`}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-[13px] font-medium tracking-wide text-muted-foreground uppercase">
              Страна
            </div>
            <div className="overflow-hidden rounded-2xl bg-card">
              <ScrollArea className="h-56">
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                  onClick={() => onCountry(null)}
                >
                  <span>Все страны</span>
                  {country === null && <span className="text-primary">●</span>}
                </button>
                {countries.map((item) => (
                  <div key={item.code}>
                    <Separator />
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-4 py-3 text-left"
                      onClick={() => onCountry(item.code)}
                    >
                      <span>
                        {item.name}{' '}
                        <span className="text-muted-foreground">{item.code}</span>
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {country === item.code ? '●' : item.count}
                      </span>
                    </button>
                  </div>
                ))}
              </ScrollArea>
            </div>
          </div>
          <Button variant="secondary" className="w-full" onClick={onReset}>
            Сбросить страну и протокол
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
