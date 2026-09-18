import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import type { JSX } from 'react'
import { AnalyzePage } from './pages/AnalyzePage'
import { TestsPage } from './pages/TestsPage'
import { LivePage } from './pages/LivePage'
import { ProductListing } from './demo/ProductListing'
import { NoteComposer } from './demo/NoteComposer'

export default function App(): JSX.Element {
  const location = useLocation()
  if (location.pathname === '/demo') {
    return <ProductListing />
  }
  if (location.pathname === '/notes') {
    return <NoteComposer />
  }

  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="brand">
          Evidence Replay
        </NavLink>
        <nav>
          <NavLink to="/" end>
            Analyze
          </NavLink>
          <NavLink to="/demo">Demo defect</NavLink>
          <NavLink to="/tests">Tests</NavLink>
          <NavLink to="/live">Live beta</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<AnalyzePage />} />
          <Route path="/tests" element={<TestsPage />} />
          <Route path="/live" element={<LivePage />} />
        </Routes>
      </main>
    </div>
  )
}
