import { toast } from 'sonner'

export async function copyText(text: string, message = 'Скопировано') {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.left = '-9999px'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    if (!ok) {
      toast.error('Не удалось скопировать')
      return
    }
  }
  toast.success(message)
}
