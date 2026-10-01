import { localePref } from './i18n'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './app/App'
import { GuestApp } from './features/share/GuestApp'
import { api } from './api/client'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } }
})

const guest = location.pathname.startsWith('/s/')
// generated titles and messages follow the language of the app
if (!guest) void api('/api/settings/locale', { method: 'PUT', json: { pref: localePref(), system: navigator.language } }).catch(() => undefined)
if (guest) {
  document.body.style.userSelect = 'auto'
  document.body.style.overflow = 'auto'
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.classList.toggle('dark', dark)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {guest ? (
      <GuestApp />
    ) : (
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    )}
  </StrictMode>
)
