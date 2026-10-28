import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { continuationHint, mergeRecognitions } from '../ai/merge'
import { fuseMeasured, measuredMeasures } from '../ai/measuredStaff'
import { buildStaffPrompt, markStaffImage, mergeStaffAnswers, STAFF_SCHEMA, staffGroups, staffLayout, staffToRecognition, subStaffLayout, type StaffAnswer } from '../ai/markedStaff'
import { buildMarkedPrompt, layoutFromDetection, MARKED_SCHEMA, markedToRecognition, markImage, mergeMarkedAnswers, subLayout, systemGroups, type MarkedAnswer } from '../ai/markedTab'
import { activeAi, AiError, recognize, requestJson } from '../ai/providers'
import { buildPrompt, type Recognition } from '../ai/schema'
import { toImportedSheet, type ImportedSheet } from '../ai/toContent'
import { ChartPreview } from '../components/ChordChartWorkspace'
import { CropBox } from '../components/CropBox'
import { Icon } from '../components/Icon'
import { JianpuView } from '../components/Jianpu'
import { ScoreView } from '../components/ScoreView'
import { useToast } from '../components/Toast'
import { ChartTidyDialog, TidyDialog } from '../components/TidyDialog'
import { TuningPicker, type TuningValue } from '../components/TuningPicker'
import { db, newId } from '../db/db'
import { createSheet, updateSheet } from '../db/repo'
import { blobToBase64, canvasToJpeg, cropAndScale, decodeImage, openPdf, renderPdfPage, rotate, type CropRect, type Rotation } from '../lib/image'
import { findSystems } from '../lib/systems'
import { deskewCanvas, detectCanvas, drawDetection, enhancedCanvas } from '../lib/tabDetectView'
import { melodyToAlphaTex, tabToAlphaTex } from '../music/alphatex'
import { isChordChartContent } from '../music/chordChart'
import { KEYS, transposeKey } from '../music/chords'
import { noteName } from '../music/instruments'
import { isMelodyContent, numberedBase } from '../music/melody'
import { TIME_SIGNATURES } from '../music/rhythm'
import { isTabContent } from '../music/tab'
import { isImageSheetContent } from '../music/imageSheet'

type Expected = 'auto' | 'tab' | 'staff' | 'numbered' | 'chord'
type Stage = 'pick' | 'pdf' | 'crop' | 'running' | 'review'

const FULL: CropRect = { x: 0, y: 0, w: 1, h: 1 }

/** One image to recognize, with its own rotation and crop. */
interface PageItem {
  id: string
  source: HTMLCanvasElement
  rotation: Rotation
  crop: CropRect
}

/** A horizontal band of a canvas, enlarged so the music is easy to read (at most 2400 px wide, 3×). */
function cropBand(src: HTMLCanvasElement, y0: number, y1: number) {
  const top = Math.max(0, Math.floor(y0))
  const h = Math.max(1, Math.min(src.height, Math.ceil(y1)) - top)
  const f = Math.max(1, Math.min(3, 2400 / src.width))
  const out = document.createElement('canvas')
  out.width = Math.round(src.width * f)
  out.height = Math.round(h * f)
  const ctx = out.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, top, src.width, h, 0, 0, out.width, out.height)
  return out
}

/**
 * One staff cut from the page, side margins left out, enlarged until the staff lines are about
 * 26 px apart (note heads then fill a space clearly), at most 4× and 3200 px wide.
 */
function cropStaff(src: HTMLCanvasElement, g: { x0: number; y0: number; x1: number; y1: number; spacing: number }, k: number) {
  const left = Math.max(0, Math.floor(g.x0 * k))
  const top = Math.max(0, Math.floor(g.y0 * k))
  const w = Math.max(1, Math.min(src.width, Math.ceil(g.x1 * k)) - left)
  const h = Math.max(1, Math.min(src.height, Math.ceil(g.y1 * k)) - top)
  const f = Math.max(1, Math.min(4, 26 / (g.spacing * k), 3200 / w))
  const out = document.createElement('canvas')
  out.width = Math.round(w * f)
  out.height = Math.round(h * f)
  const ctx = out.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, left, top, w, h, 0, 0, out.width, out.height)
  return out
}

/** Small preview of the rotated, cropped image. */
function thumbnail(p: PageItem) {
  const c = cropAndScale(rotate(p.source, p.rotation), p.crop)
  const scale = Math.min(1, 320 / Math.max(c.width, c.height))
  const out = document.createElement('canvas')
  out.width = Math.round(c.width * scale)
  out.height = Math.round(c.height * scale)
  out.getContext('2d')!.drawImage(c, 0, 0, out.width, out.height)
  return out.toDataURL('image/jpeg', 0.8)
}

export function RecognizePage() {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const navigate = useNavigate()
  const ai = activeAi()
  const [stage, setStage] = useState<Stage>('pick')
  const [expected, setExpected] = useState<Expected>('auto')
  const [stringsHint, setStringsHint] = useState(0)
  const [pages, setPages] = useState<PageItem[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [pdf, setPdf] = useState<{ doc: Awaited<ReturnType<typeof openPdf>>; page: number; preview: string } | null>(null)
  // Per-image results, kept across retries so a failure resumes where it stopped.
  const [results, setResults] = useState<{ pageId: string; blob: Blob; url: string; recognition: Recognition }[]>([])
  const [progress, setProgress] = useState({ index: 0, total: 0, elapsed: 0 })
  const [error, setError] = useState<string | null>(null)
  // What the TAB detector found on the image being edited (an overlay, for checking it).
  const [detected, setDetected] = useState<{ url: string; tabs: number; bars: number; numbers: number; uncertain: number; staves: number; measures: number } | null>(null)
  const abort = useRef<AbortController | null>(null)
  const thumbs = useMemo(() => new Map(pages.map((p) => [p.id, thumbnail(p)])), [pages])
  const editingPage = pages.find((p) => p.id === editing) ?? null
  const working = useMemo(() => (editingPage ? rotate(editingPage.source, editingPage.rotation) : null), [editingPage])

  const addCanvas = (source: HTMLCanvasElement) => {
    setPages((ps) => [...ps, { id: newId(), source, rotation: 0, crop: FULL }])
    setResults([]) // the image set changed: recognize again
  }
  const updatePage = (id: string, patch: Partial<PageItem>) => {
    setPages((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)))
    setResults([])
  }

  const load = async (files: File[]) => {
    setError(null)
    for (const file of files) {
      try {
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          const doc = await openPdf(file)
          const canvas = await renderPdfPage(doc, 1, 900)
          setPdf({ doc, page: 1, preview: canvas.toDataURL('image/jpeg', 0.8) })
          setStage('pdf')
          return // one PDF at a time: pick its pages next
        }
        addCanvas(await decodeImage(file))
      } catch {
        setError(t('ai.cannotOpen'))
      }
    }
    setStage('pick')
  }

  // Opened from a picture / PDF sheet ("?from=<sheet id>"): start with that sheet's files.
  const [params] = useSearchParams()
  const fromSheet = params.get('from')
  const loadedFrom = useRef<string | null>(null)
  useEffect(() => {
    if (!fromSheet || loadedFrom.current === fromSheet) return
    loadedFrom.current = fromSheet
    void (async () => {
      const sheet = await db.sheets.get(fromSheet)
      if (!sheet || !isImageSheetContent(sheet.content)) return
      const assets = await db.assets.bulkGet(sheet.content.pages.map((p) => p.assetId))
      const files = assets.flatMap((a) => (a ? [new File([a.blob], a.name, { type: a.mime })] : []))
      if (files.length) await load(files)
    })()
  })

  // Paste screenshots anywhere on this page; each paste adds an image.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.items ?? [])].filter((i) => i.type.startsWith('image/')).flatMap((i) => i.getAsFile() ?? [])
      if (files.length) {
        e.preventDefault()
        void load(files)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  const pick = (capture: boolean) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = capture ? 'image/*' : 'image/*,application/pdf'
    input.multiple = !capture
    if (capture) input.setAttribute('capture', 'environment')
    input.onchange = () => input.files?.length && void load([...input.files])
    input.click()
  }

  const showPdfPage = async (page: number) => {
    if (!pdf) return
    const canvas = await renderPdfPage(pdf.doc, page, 900)
    setPdf({ ...pdf, page, preview: canvas.toDataURL('image/jpeg', 0.8) })
  }

  const addPdfPages = async (all: boolean) => {
    if (!pdf) return
    const numbers = all ? Array.from({ length: pdf.doc.numPages }, (_, i) => i + 1) : [pdf.page]
    for (const n of numbers) addCanvas(await renderPdfPage(pdf.doc, n, 3000))
    toast(t('ai.pagesAdded', { count: numbers.length }))
    if (all) {
      setPdf(null)
      setStage('pick')
    }
  }

  const move = (id: string, dir: -1 | 1) => {
    setPages((ps) => {
      const i = ps.findIndex((p) => p.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= ps.length) return ps
      const next = [...ps]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
    setResults([])
  }

  // One image per line of music: the AI sees the digits larger and reads them more reliably.
  const splitSystems = () => {
    let added = 0
    const next = pages.flatMap((p) => {
      const ranges = findSystems(cropAndScale(rotate(p.source, p.rotation), p.crop))
      if (ranges.length < 2) return [p]
      added += ranges.length - 1
      return ranges.map(([a, b]) => ({ ...p, id: newId(), crop: { ...p.crop, y: p.crop.y + p.crop.h * a, h: p.crop.h * (b - a) } }))
    })
    if (!added) return toast(t('ai.splitNone'))
    setPages(next)
    setResults([])
    toast(t('ai.splitDone', { count: next.length }))
  }

  useEffect(() => setDetected(null), [editing])

  const showDetection = (p: PageItem) => {
    const canvas = deskewCanvas(cropAndScale(rotate(p.source, p.rotation), p.crop))
    const d = detectCanvas(canvas)
    const tabs = d.staves.filter((x) => x.kind === 'tab')
    setDetected({
      url: drawDetection(enhancedCanvas(canvas), d).toDataURL('image/png'),
      tabs: tabs.length,
      bars: tabs.reduce((n, x) => n + Math.max(0, x.barLines.length - 1), 0),
      numbers: tabs.reduce((n, x) => n + x.numbers.filter((k) => !k.stroke).length, 0),
      uncertain: tabs.reduce((n, x) => n + x.numbers.filter((k) => k.uncertain).length, 0),
      staves: d.staves.length - tabs.length,
      measures: staffLayout(d)?.measures.length ?? 0,
    })
  }

  const run = async () => {
    if (!ai || !pages.length) return
    setStage('running')
    setError(null)
    abort.current = new AbortController()
    const done = results.filter((r) => pages.some((p) => p.id === r.pageId))
    const started = Date.now()
    const timer = setInterval(() => setProgress((p) => ({ ...p, elapsed: Math.round((Date.now() - started) / 1000) })), 1000)
    try {
      for (let i = done.length; i < pages.length; i++) {
        setProgress({ index: i, total: pages.length, elapsed: Math.round((Date.now() - started) / 1000) })
        const page = pages[i]
        // A tilted scan or photo is levelled first (no change when it is already level).
        const canvas = deskewCanvas(cropAndScale(rotate(page.source, page.rotation), page.crop))
        const blob = await canvasToJpeg(canvas)
        const language = i18n.language === 'zh-TW' ? 'zh-TW' : 'en'
        const context = pages.length > 1 ? continuationHint(done.map((d) => d.recognition), i, pages.length) : undefined
        // TAB: the app finds the lines, columns and numbers itself; the AI only reads the marked boxes and the rhythm.
        const detection = expected === 'auto' || expected === 'tab' || expected === 'staff' ? detectCanvas(canvas) : null
        const layout = detection && expected !== 'staff' ? layoutFromDetection(detection) : null
        // Standard notation without TAB: the app finds staves and measures; the AI copies what is printed.
        const staff = detection && !detection.staves.some((x) => x.kind === 'tab') ? staffLayout(detection) : null
        let recognition: Recognition
        if (staff && detection) {
          // One request per staff, cut from the marked page and enlarged, so note heads, beams and
          // small marks are big enough to read.
          const marked = markStaffImage(enhancedCanvas(canvas), detection, staff)
          const k = marked.width / canvas.width
          const groups = staffGroups(detection, staff)
          const answers: StaffAnswer[] = []
          for (const g of groups) {
            const band = cropStaff(marked, g, k)
            const part = groups.length > 1 ? 'This image is one line of music cut from a page; transcribe only the measures listed. The key and time signature may only be printed on the first line of the page: keep using them.' : ''
            const answer = await requestJson(ai, { mime: 'image/jpeg', base64: await blobToBase64(await canvasToJpeg(band)) }, buildStaffPrompt(subStaffLayout(staff, g), { language, context: [context, part, answers[0] ? `Key signature so far: ${answers[0].keySignature} (sharps +, flats −); time signature ${answers[0].timeSignature ?? 'unknown'}.` : ''].filter(Boolean).join('\n') }), STAFF_SCHEMA, abort.current.signal)
            if (!answer || typeof answer !== 'object' || !Array.isArray((answer as StaffAnswer).measures)) throw new AiError('badOutput', JSON.stringify(answer).slice(0, 500))
            answers.push(answer as StaffAnswer)
          }
          // Measures the program read completely (note heads, stems, beams, dots, rests measured
          // on the image) replace the AI's copy; the AI still gives chord symbols, ties and the like.
          const keySig = detection.staves.find((x) => x.kind === 'staff')?.keySignature
          const fused = fuseMeasured(mergeStaffAnswers(answers), measuredMeasures(detection, staff), staff, keySig)
          recognition = staffToRecognition(fused.answer, staff)
          if (fused.fallback.length) recognition.warnings = [...recognition.warnings, t('ai.measuredFallback', { list: fused.fallback.join(', ') })]
        } else if (detection && layout && layout.columns.length >= 3) {
          // One request per line of music, cut from the marked page and enlarged, so that stems,
          // flags, tuplet numbers and grace notes are big enough to read.
          const marked = markImage(enhancedCanvas(canvas), detection, layout)
          const k = marked.width / canvas.width
          const groups = systemGroups(detection, layout)
          const answers: MarkedAnswer[] = []
          for (const g of groups) {
            const band = groups.length > 1 ? cropBand(marked, g.y0 * k, g.y1 * k) : marked
            const part = groups.length > 1 ? `This image is one line of music cut from a page; transcribe only the columns and measures listed below.` : ''
            const answer = await requestJson(ai, { mime: 'image/jpeg', base64: await blobToBase64(await canvasToJpeg(band)) }, buildMarkedPrompt(subLayout(layout, g), { language, context: [context, part].filter(Boolean).join('\n') }), MARKED_SCHEMA, abort.current.signal)
            if (!answer || typeof answer !== 'object' || !Array.isArray((answer as MarkedAnswer).columns)) throw new AiError('badOutput', JSON.stringify(answer).slice(0, 500))
            answers.push(answer as MarkedAnswer)
          }
          recognition = markedToRecognition(mergeMarkedAnswers(answers), layout)
        } else {
          const prompt = buildPrompt({ language, expected, strings: stringsHint || undefined, context })
          recognition = await recognize(ai, { mime: 'image/jpeg', base64: await blobToBase64(blob) }, prompt, abort.current.signal)
        }
        done.push({ pageId: page.id, blob, url: URL.createObjectURL(blob), recognition })
        setResults([...done])
      }
      const merged = mergeRecognitions(done.map((d) => d.recognition), (n, w) => t('ai.imageWarning', { n, text: w }))
      if (merged.notation === 'unknown') throw new AiError('other', t('ai.notMusic'))
      setStage('review')
    } catch (e) {
      if ((e as Error).name === 'AbortError') return setStage('pick')
      const code = e instanceof AiError ? e.code : 'other'
      const detail = e instanceof AiError && code === 'other' && e.message !== 'other' ? `（${e.message.slice(0, 200)}）` : ''
      setError(`${pages.length > 1 ? t('ai.failedAt', { n: done.length + 1, total: pages.length }) : ''}${t(`ai.error.${code}`)}${detail}`)
      setStage('pick')
    } finally {
      clearInterval(timer)
    }
  }

  if (!ai) {
    return (
      <div className="page" style={{ maxWidth: 720 }}>
        <div className="page-header"><h1>{t('ai.title')}</h1></div>
        <div className="panel stack">
          <p style={{ margin: 0 }}>{t('ai.noKey')}</p>
          <div><Link className="btn btn-primary" to="/settings">{t('ai.goSettings')}</Link></div>
        </div>
      </div>
    )
  }

  const merged = stage === 'review' && results.length ? mergeRecognitions(results.map((r) => r.recognition), (n, w) => t('ai.imageWarning', { n, text: w })) : null
  const resumable = results.length > 0 && results.length < pages.length

  return (
    <div className="page">
      <div className="page-header">
        <button className="btn btn-ghost btn-icon" onClick={() => navigate(-1)} aria-label={t('common.back')}><Icon name="back" /></button>
        <h1>{t('ai.title')}</h1>
        <span className="muted small">{t('ai.using', { provider: t(`ai.provider.${ai.provider}`), model: ai.model || '—' })}</span>
      </div>

      {error && <div className="ai-error" role="alert">{error}</div>}

      {stage === 'pick' && (
        <div className="panel stack">
          <div className="field-row">
            <label className="field">
              <span>{t('ai.expected')}</span>
              <select className="select" value={expected} onChange={(e) => (setExpected(e.target.value as Expected), setResults([]))}>
                <option value="auto">{t('ai.auto')}</option>
                {(['tab', 'staff', 'numbered', 'chord'] as const).map((x) => <option key={x} value={x}>{t(`sheetType.${x}`)}</option>)}
              </select>
            </label>
            <label className="field">
              <span>{t('ai.stringsHint')}</span>
              <select className="select" value={stringsHint} onChange={(e) => (setStringsHint(Number(e.target.value)), setResults([]))}>
                <option value={0}>{t('ai.auto')}</option>
                {[4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{t('sheet.stringsN', { count: n })}</option>)}
              </select>
            </label>
          </div>
          <div className="pick-buttons">
            <button className={`btn${pages.length ? '' : ' btn-primary'}`} onClick={() => pick(false)}><Icon name="upload" />{pages.length ? t('ai.addMore') : t('ai.chooseFile')}</button>
            <button className="btn" onClick={() => pick(true)}><Icon name="camera" />{t('ai.takePhoto')}</button>
          </div>
          <p className="muted small" style={{ margin: 0 }}>{t('ai.pasteHint')}</p>

          {pages.length > 0 && (
            <>
              <div className="page-list">
                {pages.map((p, i) => (
                  <div key={p.id} className={`page-item${results.some((r) => r.pageId === p.id) ? ' done' : ''}`}>
                    <span className="page-no">{i + 1}</span>
                    <img src={thumbs.get(p.id)} alt="" onClick={() => (setEditing(p.id), setStage('crop'))} />
                    <div className="page-actions">
                      <button className="btn btn-icon" onClick={() => (setEditing(p.id), setStage('crop'))} aria-label={t('ai.editImage')} title={t('ai.editImage')}><Icon name="edit" /></button>
                      <button className="btn btn-icon" disabled={i === 0} onClick={() => move(p.id, -1)} aria-label={t('ai.moveUp')} title={t('ai.moveUp')}><Icon name="prev" /></button>
                      <button className="btn btn-icon" disabled={i === pages.length - 1} onClick={() => move(p.id, 1)} aria-label={t('ai.moveDown')} title={t('ai.moveDown')}><Icon name="next" /></button>
                      <button className="btn btn-icon" onClick={() => (setPages((ps) => ps.filter((x) => x.id !== p.id)), setResults([]))} aria-label={t('common.delete')} title={t('common.delete')}><Icon name="trash" /></button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="row">
                <p className="muted small" style={{ margin: 0, flex: 1 }}>{t('ai.orderHint')}</p>
                <button className="btn" onClick={splitSystems} title={t('ai.splitSystemsHint')}>{t('ai.splitSystems')}</button>
              </div>
              <div className="row">
                <span className="muted small">{t('ai.privacy', { provider: t(`ai.provider.${ai.provider}`) })}</span>
                <span className="spacer" />
                <button className="btn btn-primary" onClick={() => void run()}>
                  {resumable ? t('ai.resume', { n: results.length + 1 }) : t('ai.recognizeN', { count: pages.length })}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {stage === 'pdf' && pdf && (
        <div className="panel stack">
          <div className="row">
            <button className="btn btn-icon" disabled={pdf.page <= 1} onClick={() => void showPdfPage(pdf.page - 1)} aria-label={t('fretboard.prev')}><Icon name="prev" /></button>
            <span>{t('ai.pdfPage', { page: pdf.page, total: pdf.doc.numPages })}</span>
            <button className="btn btn-icon" disabled={pdf.page >= pdf.doc.numPages} onClick={() => void showPdfPage(pdf.page + 1)} aria-label={t('fretboard.next')}><Icon name="next" /></button>
            <span className="spacer" />
            <button className="btn" onClick={() => (setPdf(null), setStage('pick'))}>{t('ai.done')}</button>
            <button className="btn" onClick={() => void addPdfPages(true)}>{t('ai.addAllPages', { count: pdf.doc.numPages })}</button>
            <button className="btn btn-primary" onClick={() => void addPdfPages(false)}>{t('ai.addPage')}</button>
          </div>
          <img className="pdf-preview" src={pdf.preview} alt="" />
        </div>
      )}

      {stage === 'crop' && editingPage && working && (
        <div className="panel stack">
          <div className="row">
            <strong>{t('ai.imageN', { n: pages.indexOf(editingPage) + 1 })}</strong>
            <span className="small muted">{t('ai.cropHint')}</span>
            <span className="spacer" />
            <button className="btn" onClick={() => updatePage(editingPage.id, { rotation: ((editingPage.rotation + 270) % 360) as Rotation, crop: FULL })}>⟲ {t('ai.rotate')}</button>
            <button className="btn" onClick={() => updatePage(editingPage.id, { rotation: ((editingPage.rotation + 90) % 360) as Rotation, crop: FULL })}>⟳ {t('ai.rotate')}</button>
            <button className="btn" onClick={() => updatePage(editingPage.id, { crop: FULL })}>{t('ai.fullImage')}</button>
            <button className="btn" aria-pressed={!!detected} onClick={() => (detected ? setDetected(null) : showDetection(editingPage))}>{t('ai.detect.toggle')}</button>
          </div>
          {detected ? (
            <>
              <p className="small" style={{ margin: 0 }}>{detected.tabs ? t('ai.detect.summary', detected) : detected.staves ? t('ai.detect.staffSummary', detected) : t('ai.detect.none')}</p>
              <img className="pdf-preview" src={detected.url} alt="" />
            </>
          ) : (
            <CropBox source={working} crop={editingPage.crop} onChange={(crop) => updatePage(editingPage.id, { crop })} />
          )}
          <div className="row">
            <span className="spacer" />
            <button className="btn btn-primary" onClick={() => (setEditing(null), setDetected(null), setStage('pick'))}>{t('ai.done')}</button>
          </div>
        </div>
      )}

      {stage === 'running' && (
        <div className="panel stack ai-running">
          <div className="spinner" aria-hidden="true" />
          <strong>
            {progress.total > 1 ? `${t('ai.progress', { n: progress.index + 1, total: progress.total })} · ` : ''}
            {t('ai.running', { seconds: progress.elapsed })}
          </strong>
          <p className="muted small" style={{ margin: 0 }}>{t('ai.runningHint')}</p>
          <div><button className="btn" onClick={() => abort.current?.abort()}>{t('common.cancel')}</button></div>
        </div>
      )}

      {stage === 'review' && merged && (
        <Review
          result={merged}
          images={results.map((r) => r.url)}
          boundaries={results
            .filter((r) => r.recognition.notation !== 'unknown')
            .map((r) => r.recognition.measures.length)
            .reduce<number[]>((acc, n, i) => (i === 0 ? [n] : [...acc, acc[acc.length - 1] + n]), [])
            .slice(0, -1)}
          onRetry={() => (setResults([]), setStage('pick'))}
          onCreate={async (imported, sectionId) => {
            const now = Date.now()
            const imageIds: string[] = []
            for (const [i, r] of results.entries()) {
              const id = newId()
              imageIds.push(id)
              await db.assets.add({ id, kind: 'image', name: `${imported.title}-${i + 1}.jpg`, mime: 'image/jpeg', blob: r.blob, createdAt: now, updatedAt: now })
            }
            const id = await createSheet({ title: imported.title, type: imported.type, sectionId, instrument: imported.instrument, strings: imported.tuning.length, tuning: imported.tuning })
            await updateSheet(id, {
              content: imported.content,
              key: imported.key,
              timeSignature: imported.timeSignature,
              tempo: imported.tempo,
              sourceImageId: imageIds[0],
              sourceImageIds: imageIds,
            })
            try {
              localStorage.setItem('bepro.sheetMode', 'edit')
              localStorage.setItem('bepro.sourcePanel', 'side')
            } catch {
              /* storage unavailable */
            }
            toast(t('ai.created'))
            navigate(`/sheet/${id}`, { replace: true })
          }}
        />
      )}
    </div>
  )
}

function Review({ result, images, boundaries, onRetry, onCreate }: {
  result: Recognition
  images: string[] // object URLs of the cropped images, in order
  boundaries: number[] // bar indexes where images 2…n start
  onRetry: () => void
  onCreate: (s: ImportedSheet, sectionId: string | null) => Promise<void>
}) {
  const { t } = useTranslation()
  const sections = useLiveQuery(() => db.sections.orderBy('order').toArray(), []) ?? []
  const [section, setSection] = useState<string | null>(null)
  const [title, setTitle] = useState(result.title ?? '')
  const [key, setKey] = useState<string | null>(null)
  const [ts, setTs] = useState<string | null>(null)
  const [tuning, setTuning] = useState<TuningValue | null>(null)
  const [busy, setBusy] = useState(false)
  const [tidyOpen, setTidyOpen] = useState(false)
  // Tidied content, valid only for the conversion it was made from (changing key/tuning reconverts).
  const [tidied, setTidied] = useState<{ from: ImportedSheet['content']; content: ImportedSheet['content'] } | null>(null)

  const imported = useMemo(() => {
    // Overrides are applied to the transcription and converted again (numbered notation depends on the key).
    const r: Recognition = {
      ...result,
      ...(key ? { key } : {}),
      ...(ts ? { timeSignature: ts } : {}),
      ...(tuning ? { strings: tuning.tuning.length, tuning: [...tuning.tuning].reverse().map((m) => `${noteName(m)}${Math.floor(m / 12) - 1}`) } : {}),
    }
    const s = toImportedSheet(r, t('common.untitled'))
    return { ...s, title: title.trim() || s.title, ...(tuning ? { instrument: tuning.instrument } : {}) }
  }, [result, key, ts, tuning, title, t])
  const converted = imported
  const final: ImportedSheet = useMemo(
    () => (tidied && tidied.from === converted.content ? { ...converted, content: tidied.content } : converted),
    [tidied, converted],
  )

  // Warnings from the app's own checks arrive as "code:value".
  const warnings = final.warnings.map((w) => {
    const m = /^(unreadable|columns|tuplets|reflowed|lengthWrong|grace|uncertainString):(.*)$/.exec(w)
    if (!m) return w
    return m[1] === 'reflowed' || m[1] === 'lengthWrong' ? t(`ai.check.${m[1]}`, { list: m[2] }) : t(m[1] === 'unreadable' ? 'ai.unreadable' : `ai.check.${m[1]}`, { count: Number(m[2]) })
  })
  const tex = useMemo(() => {
    if (isTabContent(final.content)) return tabToAlphaTex(final.content, { title: final.title, tempo: final.tempo, tuning: final.tuning, timeSignature: final.timeSignature })
    if (isMelodyContent(final.content) && final.type === 'staff')
      return melodyToAlphaTex(final.content, { title: final.title, tempo: final.tempo, timeSignature: final.timeSignature, key: final.key, clef: final.instrument === 'bass' ? 'bass' : final.instrument === 'ukulele' ? 'treble' : 'treble8' })
    return null
  }, [final])
  const measures = 'measures' in final.content ? final.content.measures.length : 0
  const noop = () => {}

  return (
    <div className="review-grid">
      <section className="panel review-image">
        <h2>{t('ai.original')}{images.length > 1 ? `（${images.length}）` : ''}</h2>
        <div className="review-images">
          {images.map((u, i) => <img key={u} src={u} alt={`${t('ai.original')} ${i + 1}`} />)}
        </div>
      </section>
      <section className="stack">
        <div className="panel stack">
          <h2 style={{ margin: 0 }}>{t('ai.result')}</h2>
          <p className="small" style={{ margin: 0 }}>
            {t('ai.detected', { type: t(`sheetType.${final.type}`) })}
            {measures ? ` · ${t('ai.measures', { count: measures })}` : ''}
          </p>
          {warnings.length > 0 && (
            <ul className="ai-warnings">
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          <label className="field">
            <span>{t('sheet.title')}</span>
            <input className="input" value={title} placeholder={final.title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          {final.type !== 'chord' && (
            <TuningPicker value={tuning ?? { instrument: final.instrument, tuning: final.tuning }} onChange={setTuning} />
          )}
          <div className="field-row">
            <label className="field">
              <span>{t('sheet.key')}</span>
              <select className="select" value={final.key} onChange={(e) => setKey(e.target.value)}>
                {KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            {final.type !== 'chord' && (
              <label className="field">
                <span>{t('sheet.timeSignature')}</span>
                <select className="select" value={final.timeSignature.join('/')} onChange={(e) => setTs(e.target.value)}>
                  {TIME_SIGNATURES.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              </label>
            )}
            <label className="field">
              <span>{t('sheet.section')}</span>
              <select className="select" value={section ?? ''} onChange={(e) => setSection(e.target.value || null)}>
                <option value="">{t('nav.unsorted')}</option>
                {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </div>
          <div className="tidy-callout">
            <span className="small">{tidied && tidied.from === converted.content ? t('tidy.applied') : t('tidy.reviewHint')}</span>
            <button className="btn" onClick={() => setTidyOpen(true)}>{t('tidy.button')}</button>
          </div>
          <p className="muted small" style={{ margin: 0 }}>{t('ai.reviewHint')}</p>
          <div className="row">
            <button className="btn" onClick={onRetry} disabled={busy}>{t('ai.retry')}</button>
            <span className="spacer" />
            <button className="btn btn-primary" disabled={busy} onClick={() => (setBusy(true), void onCreate(final, section).finally(() => setBusy(false)))}>
              {t('ai.create')}
            </button>
          </div>
        </div>
        {tex ? (
          <ScoreView key={tex} tex={tex} visible profile={final.type === 'tab' ? 'tab' : 'score'} range={[0, 0]} onMeasureClick={noop} onApi={noop} onBeat={noop} onStatus={noop} />
        ) : isMelodyContent(final.content) ? (
          <JianpuView content={final.content} base={numberedBase(final.tuning, final.key)} keyName={final.key} timeSignature={final.timeSignature} tempo={final.tempo} title={final.title} range={[0, 0]} playing={null} onMeasureClick={noop} />
        ) : isChordChartContent(final.content) ? (
          <ChartPreview
            text={final.content.text}
            active={null}
            onChord={noop}
            large={false}
            header={
              <div className="chart-status">
                <span className="chip-static">{t('chart.writtenKey', { key: final.key })}</span>
                {final.content.meta?.originalKey && <span className="chip-static">{t('chart.songKey', { key: final.content.meta.originalKey })}</span>}
                {final.content.capo ? (
                  <span className="chip-static on">{t('chart.capoInfo', { capo: final.content.capo, shape: final.key, sound: transposeKey(final.key, final.content.capo) })}</span>
                ) : null}
              </div>
            }
          />
        ) : null}
      </section>
      {isChordChartContent(final.content) ? (
        <ChartTidyDialog open={tidyOpen} onClose={() => setTidyOpen(false)} chart={final.content} onApply={(c) => setTidied({ from: converted.content, content: c })} />
      ) : (
        <TidyDialog
          open={tidyOpen}
          onClose={() => setTidyOpen(false)}
          content={final.content}
          timeSignature={final.timeSignature}
          overlaps={tidied ? undefined : boundaries}
          onApply={(c) => setTidied({ from: converted.content, content: c })}
        />
      )}
    </div>
  )
}
