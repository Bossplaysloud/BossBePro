import { lazy, Suspense, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HashRouter, Link, Route, Routes, useLocation } from 'react-router-dom'
import { BackupReminder } from './components/BackupReminder'
import { BrandName } from './components/BrandName'
import { Icon } from './components/Icon'
import { Sidebar } from './components/Sidebar'
import { ToastProvider } from './components/Toast'
import { requestPersistentStorage } from './db/db'
import { useSidebarHidden } from './lib/settings'
import { DashboardPage } from './pages/DashboardPage'

// The home page comes with the app; every other page is its own file, loaded right after the
// home page has shown (so opening the app is quick) or on the way to it, whichever comes first.
const pages = {
  library: () => import('./pages/LibraryPage'),
  songbook: () => import('./pages/SongbookPage'),
  reader: () => import('./pages/SongbookReader'),
  sheet: () => import('./pages/SheetPage'),
  print: () => import('./pages/PrintSheetPage'),
  settings: () => import('./pages/SettingsPage'),
  recognize: () => import('./pages/RecognizePage'),
  importGp: () => import('./pages/ImportGpPage'),
}
const LibraryPage = lazy(() => pages.library().then((m) => ({ default: m.LibraryPage })))
const SongbookPage = lazy(() => pages.songbook().then((m) => ({ default: m.SongbookPage })))
const SongbookReader = lazy(() => pages.reader().then((m) => ({ default: m.SongbookReader })))
const SheetPage = lazy(() => pages.sheet().then((m) => ({ default: m.SheetPage })))
const PrintSheetPage = lazy(() => pages.print().then((m) => ({ default: m.PrintSheetPage })))
const SettingsPage = lazy(() => pages.settings().then((m) => ({ default: m.SettingsPage })))
const RecognizePage = lazy(() => pages.recognize().then((m) => ({ default: m.RecognizePage })))
const ImportGpPage = lazy(() => pages.importGp().then((m) => ({ default: m.ImportGpPage })))

function Shell() {
  const { t } = useTranslation()
  const [drawer, setDrawer] = useState(false)
  const location = useLocation()
  const [hidden, setHidden] = useSidebarHidden()

  return (
    <div className={`shell${hidden ? ' sidebar-hidden' : ''}`}>
      <header className="topbar">
        <button className="btn btn-ghost btn-icon" onClick={() => setDrawer(true)} aria-label={t('nav.menu')}>
          <Icon name="menu" />
        </button>
        <Link to="/" className="brand" aria-label={t('nav.home')}>
          <img src="./favicon.svg" alt="" />
          <BrandName />
        </Link>
      </header>
      <div className={`drawer-backdrop${drawer ? ' open' : ''}`} onClick={() => setDrawer(false)} />
      <Sidebar open={drawer} onNavigate={() => setDrawer(false)} />
      {hidden && (
        <button className="btn btn-icon sidebar-show" onClick={() => setHidden(false)} aria-label={t('nav.showSidebar')} title={t('nav.showSidebar')}>
          <Icon name="sidebar" />
        </button>
      )}
      <main className="main">
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/all" element={<LibraryPage scope={{ kind: 'all' }} />} />
            <Route path="/unsorted" element={<LibraryPage scope={{ kind: 'unsorted' }} />} />
            <Route path="/section/:id" element={<LibraryPage key={location.pathname} />} />
            <Route path="/songbook/:id" element={<SongbookPage key={location.pathname} />} />
            <Route path="/songbook/:id/play/:pos" element={<SongbookReader />} />
            <Route path="/sheet/:id" element={<SheetPage />} />
            <Route path="/sheet/:id/pdf" element={<PrintSheetPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/recognize" element={<RecognizePage />} />
            <Route path="/import-gp" element={<ImportGpPage key={location.key} />} />
          </Routes>
        </Suspense>
      </main>
      <BackupReminder />
    </div>
  )
}

export default function App() {
  useEffect(() => void requestPersistentStorage(), [])
  // Once the first page is up, fetch the other pages in the background.
  useEffect(() => {
    const id = window.setTimeout(() => Object.values(pages).forEach((load) => void load().catch(() => {})), 300)
    return () => window.clearTimeout(id)
  }, [])
  return (
    <ToastProvider>
      <HashRouter>
        <Shell />
      </HashRouter>
    </ToastProvider>
  )
}
