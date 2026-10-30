import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import guitarUrl from '../assets/guitar.webp'
import { BOSS_NOTE } from '../content/bossNote'
import { db } from '../db/db'
import { Icon } from '../components/Icon'
import { NewSheetDialog } from '../components/NewSheetDialog'
import { pickScoreFile } from '../lib/pickFiles'
import { GP_EXTENSIONS } from '../music/gpImport'

const RECENT = 5
const GROUPS = 8
const two = (n: number) => String(n).padStart(2, '0')

/** A heading with a link or button on the right. */
function Head({ title, side }: { title: string; side?: ReactNode }) {
  return (
    <div className="dash-head">
      <h2>{title}</h2>
      {side}
    </div>
  )
}

/** Sections or songbooks as raised pills: the first few, the rest on "show all". */
function Pills({ items, empty }: { items: { id: string; to: string; name: string; count: number }[]; empty: string }) {
  const { t } = useTranslation()
  const [all, setAll] = useState(false)
  if (!items.length) return <p className="muted small dash-empty">{empty}</p>
  const shown = all ? items : items.slice(0, GROUPS)
  return (
    <div className="dash-pills">
      {shown.map((x) => (
        <Link key={x.id} to={x.to} className="dash-pill" title={t('dash.sheets', { count: x.count })}>
          {x.name}
          <small>{x.count}</small>
        </Link>
      ))}
      {items.length > GROUPS && (
        <button className="dash-pill dash-more" onClick={() => setAll(!all)}>
          {all ? t('dash.showLess') : t('dash.showAll', { count: items.length })}
        </button>
      )}
    </div>
  )
}

/** The author's note at the bottom, quiet like a watermark: greeting, reminders and links. */
function BossNote() {
  const { t } = useTranslation()
  return (
    <aside className="dash-note">
      <h2>{BOSS_NOTE.title}</h2>
      <p>{BOSS_NOTE.text}</p>
      <div className="dash-note-links">
        {BOSS_NOTE.instagram && (
          <a href={BOSS_NOTE.instagram} target="_blank" rel="noreferrer">Instagram @bossplaysloud</a>
        )}
        {BOSS_NOTE.sponsor && (
          <a href={BOSS_NOTE.sponsor} target="_blank" rel="noreferrer">{t('dash.sponsor')}</a>
        )}
      </div>
    </aside>
  )
}

/**
 * The home page, a bento of soft panels: counts and today's date, the title with the main actions,
 * recent sheets, sections and songbooks, then the author's note. Searching opens all sheets.
 */
export function DashboardPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  const sheets = useLiveQuery(() => db.sheets.toArray(), [])
  const sections = useLiveQuery(() => db.sections.orderBy('order').toArray(), [])
  const songbooks = useLiveQuery(() => db.songbooks.orderBy('order').toArray(), [])
  if (!sheets || !sections || !songbooks) return null

  const recent = [...sheets].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RECENT)
  const countIn = (id: string | null) => sheets.filter((s) => s.sectionId === id).length
  const unsorted = countIn(null)
  const date = (d: Date) => `${two(d.getMonth() + 1)}/${two(d.getDate())}`

  return (
    <div className="page dashboard">
      <div className="dash-bar">
        <span className="dash-brand">BEPRO</span>
        <form
          className="dash-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            navigate('/all', { state: { query: query.trim() } })
          }}
        >
          <Icon name="search" size={16} />
          <input type="search" value={query} placeholder={t('dash.search')} aria-label={t('common.search')} onChange={(e) => setQuery(e.target.value)} />
        </form>
        <Link className="btn btn-icon" to="/settings" aria-label={t('nav.settings')} title={t('nav.settings')}>
          <Icon name="settings" />
        </Link>
      </div>

      <div className="dash-bento">
        <section className="dash-panel dash-stats">
          <div className="dash-stat-top">
            <Link to="/all" style={{ color: 'inherit', textDecoration: 'none' }}>
              <div className="dash-num">{two(sheets.length)}</div>
              <div className="dash-num-label">{t('dash.sheetsLabel')}</div>
            </Link>
            <div className="dash-date">
              <small>{t('dash.today')}</small>
              <div>{date(new Date())}</div>
            </div>
          </div>
          <div className="dash-stat-list">
            <span><b>{two(sections.length)}</b><small>{t('nav.sections')}</small></span>
            <span><b>{two(songbooks.length)}</b><small>{t('nav.songbooks')}</small></span>
            <Link to="/unsorted"><b>{two(unsorted)}</b><small>{t('nav.unsorted')}</small></Link>
          </div>
        </section>

        <section className="dash-panel dash-hero">
          <img className="dash-guitar" src={guitarUrl} alt="" aria-hidden="true" draggable={false} />
          <div>
            <h1 className="dash-display">BePro</h1>
            <p className="dash-sub">{t('app.tagline')}<br />{t('dash.tagline')}</p>
          </div>
          <div className="dash-actions">
            <button className="btn" onClick={() => pickScoreFile(GP_EXTENSIONS, (file) => navigate('/import-gp', { state: { file, sectionId: null } }))}>
              <Icon name="upload" />
              {t('gp.button')}
            </button>
            <button className="btn" onClick={() => navigate('/recognize')}>
              <Icon name="camera" />
              {t('ai.fromImage')}
            </button>
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Icon name="plus" />
              {t('sheet.new')}
            </button>
          </div>
        </section>

        <section className="dash-panel dash-recent">
          <Head title={t('dash.recent')} side={sheets.length > 0 && <Link className="dash-link" to="/all">{t('dash.viewAll', { count: sheets.length })}</Link>} />
          {recent.length ? (
            <div className="dash-well">
              {recent.map((s) => (
                <Link key={s.id} to={`/sheet/${s.id}`} className="dash-row">
                  <span className="dash-dot" style={{ '--c': `var(--type-${s.type})` } as CSSProperties} />
                  <span className="dash-row-title">{s.title}</span>
                  <span className="dash-row-type">{t(`sheetType.${s.type}`)}</span>
                  <span className="dash-row-date">{date(new Date(s.updatedAt))}</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="muted small dash-empty">{t('dash.noSheets')}</p>
          )}
        </section>

        <section className="dash-panel dash-groups">
          <div>
            <Head title={t('nav.sections')} side={unsorted > 0 && <Link className="dash-link" to="/unsorted">{t('dash.unsorted', { count: unsorted })}</Link>} />
            <Pills items={sections.map((s) => ({ id: s.id, to: `/section/${s.id}`, name: s.name, count: countIn(s.id) }))} empty={t('dash.noSections')} />
          </div>
          <div>
            <Head title={t('nav.songbooks')} />
            <Pills items={songbooks.map((b) => ({ id: b.id, to: `/songbook/${b.id}`, name: b.name, count: b.entries.length }))} empty={t('dash.noSongbooks')} />
          </div>
        </section>
      </div>

      <BossNote />

      <NewSheetDialog open={creating} onClose={() => setCreating(false)} sectionId={null} />
    </div>
  )
}
