import { lazy, Suspense } from 'react'

// Parked design route (code-split): reachable only by URL, never linked from app nav.
const DesignShowcase = lazy(() => import('./design/DesignShowcase'))

export default function App() {
  if (window.location.pathname === '/design') {
    return (
      <Suspense fallback={null}>
        <DesignShowcase />
      </Suspense>
    )
  }
  return (
    <main>
      <h1>Sandlot</h1>
    </main>
  )
}
