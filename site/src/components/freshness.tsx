import { useEffect, useState } from 'react'
import { checkedAge } from '@/lib/format'
import { ru } from '@/lib/ru'

export function Freshness({ iso }: { iso: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const timer = window.setInterval(tick, 15_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
  const age = checkedAge(iso, now)
  if (!age) return null
  return <span data-freshness="">{ru.updatedAgo(age)}</span>
}
