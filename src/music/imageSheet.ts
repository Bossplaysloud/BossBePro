// Picture / PDF sheets: the sheet is the files themselves, shown as they are (no notation content).

export interface ImageSheetPage {
  assetId: string
  mime: string // image/* or application/pdf (a PDF shows all its pages)
  name: string
}

export interface ImageSheetContent {
  kind: 'images'
  version: 1
  pages: ImageSheetPage[]
}

export function isImageSheetContent(c: unknown): c is ImageSheetContent {
  return !!c && typeof c === 'object' && (c as ImageSheetContent).kind === 'images' && Array.isArray((c as ImageSheetContent).pages)
}

export const isPdf = (file: { type: string; name: string }) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
