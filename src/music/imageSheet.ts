// Picture / PDF sheets: the sheet is the files themselves, shown as they are (no notation content).

export interface ImageSheetPage {
  assetId: string
  mime: string // image/* or application/pdf (a PDF shows all its pages)
  name: string
}

export const STICKY_COLORS = ['yellow', 'red', 'blue', 'green', 'white'] as const
export type StickyColor = (typeof STICKY_COLORS)[number]
export const STICKY_SIZES = ['s', 'm', 'l'] as const
export type StickySize = (typeof STICKY_SIZES)[number]

/** A note stuck on one picture (or one page of a PDF), placed as a fraction of its width and height. */
export interface Sticky {
  id: string
  assetId: string
  page: number // page of a PDF, 0 for a picture
  x: number
  y: number
  text: string
  color: StickyColor
  size: StickySize
}

/**
 * The sheet's own notes: free text, and stickies on the pages. Where they show (PDF, songbooks,
 * search) follows the settings unless this sheet says otherwise.
 */
export interface ImageNotes {
  text: string
  stickies: Sticky[]
  inPdf?: boolean
  inSongbook?: boolean
  searchable?: boolean
}

export interface ImageSheetContent {
  kind: 'images'
  version: 1
  pages: ImageSheetPage[]
  notes?: ImageNotes
}

export const EMPTY_NOTES: ImageNotes = { text: '', stickies: [] }

export const imageNotes = (c: unknown): ImageNotes => (isImageSheetContent(c) && c.notes) || EMPTY_NOTES

/** The note text and sticky texts, for search. */
export const notesText = (n: ImageNotes) => [n.text, ...n.stickies.map((s) => s.text)].join('\n')

export function isImageSheetContent(c: unknown): c is ImageSheetContent {
  return !!c && typeof c === 'object' && (c as ImageSheetContent).kind === 'images' && Array.isArray((c as ImageSheetContent).pages)
}

export const isPdf = (file: { type: string; name: string }) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

/** Whether a search finds a sheet by its picture-sheet notes (when they are searchable). */
export const notesMatch = (content: unknown, q: string, searchDefault: boolean) => {
  const n = imageNotes(content)
  return (n.searchable ?? searchDefault) && notesText(n).toLowerCase().includes(q)
}
