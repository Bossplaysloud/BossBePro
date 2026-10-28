import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom'
import { BackupReminder } from './components/BackupReminder'
import { Icon } from './components/Icon'
import { Sidebar } from './components/Sidebar'
import { ToastProvider } from './components/Toast'
import { requestPersistentStorage } from './db/db'
import { ImportGpPage } from './pages/ImportGpPage'
import { LibraryPage } from './pages/LibraryPage'
import { PrintSheetPage } from './pages/PrintSheetPage'
import { RecognizePage } from './pages/RecognizePage'
import { SettingsPage } from './pages/SettingsPage'
import { SheetPage } from './pages/SheetPage'
import { SongbookPage } from './pages/SongbookPage'
import { SongbookReader } from './pages/SongbookReader'

function Shell() {
  const { t } = useTranslation()
  const [drawer, setDrawer] = useState(false)
  const location = useLocation()

  return (
    <div className="shell">
      <header className="topbar">
        <button className="btn btn-ghost btn-icon" onClick={() => setDrawer(true)} aria-label={t('nav.menu')}>
          <Icon name="menu" />
        </button>
        <div className="brand">
          <img src="./favicon.svg" alt="" />
          {t('app.name')}
        </div>
      </header>
      <div className={`drawer-backdrop${drawer ? ' open' : ''}`} onClick={() => setDrawer(false)} />
      <Sidebar open={drawer} onNavigate={() => setDrawer(false)} />
      <main className="main">
        <Routes>
          <Route path="/" element={<LibraryPage scope={{ kind: 'all' }} />} />
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
      </main>
      <BackupReminder />
    </div>
  )
}

export default function App() {
  useEffect(() => void requestPersistentStorage(), [])
  return (
    <ToastProvider>
      <HashRouter>
        <Shell />
      </HashRouter>
    </ToastProvider>
  )
}
