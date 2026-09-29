import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { HubProvider } from '@/lib/hub'
import { ReachProvider } from '@/lib/reach-context'
import { ServerCheckProvider } from '@/lib/server-check-context'
import { SettingsProvider } from '@/lib/settings'
import App from '@/App.tsx'
import '@/index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="v2hub-theme">
      <TooltipProvider>
        <SettingsProvider>
          <HubProvider>
            <ReachProvider>
              <ServerCheckProvider>
                <App />
                <Toaster position="top-center" />
              </ServerCheckProvider>
            </ReachProvider>
          </HubProvider>
        </SettingsProvider>
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
)
