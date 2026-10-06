import { toast } from 'sonner'

import { ru } from '@/lib/ru'

function writeLegacy(text: string): boolean {
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('contenteditable', 'true')
  area.style.position = 'fixed'
  area.style.top = '0'
  area.style.left = '0'
  area.style.width = '1px'
  area.style.height = '1px'
  area.style.padding = '0'
  area.style.border = 'none'
  area.style.outline = 'none'
  area.style.boxShadow = 'none'
  area.style.background = 'transparent'
  area.style.fontSize = '16px'
  document.body.appendChild(area)
  const selection = document.getSelection()
  const saved = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  area.focus()
  area.select()
  try {
    area.setSelectionRange(0, text.length)
  } catch {
    // Old WebViews throw when the selection cannot be set.
  }
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  area.remove()
  if (saved && selection) {
    selection.removeAllRanges()
    selection.addRange(saved)
  }
  return ok
}

export async function copyText(text: string, message: string = ru.copied) {
  // Synchronous copy first. Waiting on the Clipboard API spends the tap, and iOS Safari then refuses the fallback.
  if (writeLegacy(text)) {
    toast.success(message)
    return
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      toast.success(message)
      return
    }
  } catch {
    // The button already tried the fallback.
  }
  toast.error(ru.copyFailed)
}
