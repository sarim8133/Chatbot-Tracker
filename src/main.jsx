import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import { initErrorSink } from './errlog'

// Register global error/rejection handlers before render, so a boot-time throw is
// captured too. The boundary catches render crashes; initErrorSink catches the rest.
initErrorSink()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
