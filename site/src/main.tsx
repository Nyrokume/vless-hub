import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { SettingsProvider } from '@/lib/settings'
import App from '@/App.tsx'
import '@/index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} storageKey="vless-hub-theme">
      <TooltipProvider>
        <SettingsProvider>
          <App />
          <Toaster position="top-center" />
        </SettingsProvider>
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
)
