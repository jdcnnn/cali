import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import App from './App.tsx'
import './styles/modal-system.css'
import './styles/workspace-normalization.css'
import { ThemeProvider } from './theme/ThemeProvider.tsx'
import { initializeSounds } from './lib/sounds'

const disposeSounds = initializeSounds()
if (import.meta.hot) import.meta.hot.dispose(disposeSounds)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider><App /></ThemeProvider>
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then(registration => registration.update())
      .catch(error => {
        console.error('Cali service worker registration failed.', error)
      })
  })
}
