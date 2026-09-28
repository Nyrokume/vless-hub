import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ResponsivePanel } from '@/components/responsive-panel'
import { securityLabel, transportLabel } from '@/lib/format'
import { THRESHOLDS, thresholdKey } from '@/lib/settings'
import { useMediaQuery } from '@/lib/use-media'

function keepSingle(value: string, apply: (value: string) => void) {
  if (value) apply(value)
}

export function FilterSheet({
  open,
  onOpenChange,
  countries,
  transports,
  securities,
  country,
  transport,
  security,
  threshold,
  onCountry,
  onTransport,
  onSecurity,
  onThreshold,
  onReset,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  countries: { code: string; name: string; count: number }[]
  transports: { id: string; count: number }[]
  securities: { id: string; count: number }[]
  country: string | null
  transport: string | null
  security: string | null
  threshold: number | null
  onCountry: (code: string | null) => void
  onTransport: (id: string | null) => void
  onSecurity: (id: string | null) => void
  onThreshold: (value: number | null) => void
  onReset: () => void
}) {
  const desktop = useMediaQuery('(min-width: 1024px)')

  return (
    <ResponsivePanel
      open={open}
      onOpenChange={onOpenChange}
      desktop={desktop}
      title="Фильтры"
      description="Страна, транспорт, безопасность и порог задержки."
    >
      <FieldGroup>
        <Field>
          <FieldLabel>Задержка</FieldLabel>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={2}
            value={thresholdKey(threshold)}
            onValueChange={(value) =>
              keepSingle(value, (next) => onThreshold(next === 'all' ? null : Number(next)))
            }
            className="flex w-full flex-wrap justify-start"
          >
            {THRESHOLDS.map((item) => (
              <ToggleGroupItem key={item.value} value={item.value}>
                {item.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
        <Field>
          <FieldLabel>Транспорт</FieldLabel>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={2}
            value={transport ?? 'all'}
            onValueChange={(value) =>
              keepSingle(value, (next) => onTransport(next === 'all' ? null : next))
            }
            className="flex w-full flex-wrap justify-start"
          >
            <ToggleGroupItem value="all">Все</ToggleGroupItem>
            {transports.map((item) => (
              <ToggleGroupItem key={item.id} value={item.id}>
                {`${transportLabel(item.id)} · ${item.count}`}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
        <Field>
          <FieldLabel>Безопасность</FieldLabel>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={2}
            value={security ?? 'all'}
            onValueChange={(value) =>
              keepSingle(value, (next) => onSecurity(next === 'all' ? null : next))
            }
            className="flex w-full flex-wrap justify-start"
          >
            <ToggleGroupItem value="all">Все</ToggleGroupItem>
            {securities.map((item) => (
              <ToggleGroupItem key={item.id} value={item.id}>
                {`${securityLabel(item.id)} · ${item.count}`}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
        <Field>
          <FieldLabel htmlFor="country-filter">Страна</FieldLabel>
          <Select
            value={country ?? 'all'}
            onValueChange={(value) => onCountry(value === 'all' ? null : value)}
          >
            <SelectTrigger id="country-filter" className="w-full">
              <SelectValue placeholder="Все страны" />
            </SelectTrigger>
            <SelectContent position="popper" className="max-h-72">
              <SelectGroup>
                <SelectItem value="all">Все страны</SelectItem>
                {countries.map((item) => (
                  <SelectItem key={item.code} value={item.code}>
                    {`${item.name} · ${item.code} · ${item.count}`}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </FieldGroup>
      <Button variant="secondary" className="w-full" onClick={onReset}>
        Сбросить страну и протокол
      </Button>
    </ResponsivePanel>
  )
}
