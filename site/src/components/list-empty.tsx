import { SadFace } from '@/components/sad-face'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'

export function ListEmpty({
  title,
  description,
  onReset,
}: {
  title: string
  description?: string
  onReset?: () => void
}) {
  return (
    <Empty className="gap-4 border-0 p-6 md:p-8">
      <EmptyHeader>
        <EmptyMedia
          variant="default"
          className="text-muted-foreground motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300"
        >
          <SadFace />
        </EmptyMedia>
        <EmptyTitle className="text-[15px] font-medium">{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {onReset ? (
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={onReset}>
            Сбросить фильтры
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  )
}
