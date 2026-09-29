import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import { AuthGate } from './shell/AuthGate'
import { GameScreen, Landing, NotFound } from './shell/routes'

// Parked design route (code-split): reachable only by URL, never linked from app nav.
const DesignShowcase = lazy(() => import('./design/DesignShowcase'))

/**
 * The route table (ADR-0029). `/design` sits outside the auth gate on purpose —
 * the showcase is public and works signed out. Everything else is behind it.
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/design"
          element={
            <Suspense fallback={null}>
              <DesignShowcase />
            </Suspense>
          }
        />
        <Route element={<AuthGate />}>
          <Route index element={<Landing />} />
          <Route path="game/:id" element={<GameScreen />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
