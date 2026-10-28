// Image handling for recognition: decoding (with EXIF orientation), PDF pages, rotate, crop, downscale.

export type Rotation = 0 | 90 | 180 | 270

export interface CropRect {
  x: number // 0–1, relative to the (rotated) image
  y: number
  w: number
  h: number
}

/** Longest side sent to the AI: enough for small TAB digits, small enough for every provider's limits. */
const MAX_SIDE = 2400

export async function decodeImage(file: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  bitmap.close()
  return canvas
}

async function pdfjs() {
  const lib = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  lib.GlobalWorkerOptions.workerSrc = worker.default
  return lib
}

export async function openPdf(file: Blob) {
  const lib = await pdfjs()
  return lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
}

/** Renders a PDF page (1-based) at a resolution good for reading small print. */
export async function renderPdfPage(doc: Awaited<ReturnType<typeof openPdf>>, page: number, targetWidth = 2000): Promise<HTMLCanvasElement> {
  const p = await doc.getPage(page)
  const base = p.getViewport({ scale: 1 })
  const viewport = p.getViewport({ scale: targetWidth / base.width })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await p.render({ canvas, canvasContext: ctx, viewport }).promise
  return canvas
}

export function rotate(src: HTMLCanvasElement, rotation: Rotation): HTMLCanvasElement {
  if (rotation === 0) return src
  const out = document.createElement('canvas')
  const swap = rotation === 90 || rotation === 270
  out.width = swap ? src.height : src.width
  out.height = swap ? src.width : src.height
  const ctx = out.getContext('2d')!
  ctx.translate(out.width / 2, out.height / 2)
  ctx.rotate((rotation * Math.PI) / 180)
  ctx.drawImage(src, -src.width / 2, -src.height / 2)
  return out
}

/** Crops (normalized rect) and scales down so the longest side is at most MAX_SIDE. */
export function cropAndScale(src: HTMLCanvasElement, crop: CropRect): HTMLCanvasElement {
  const sx = Math.round(crop.x * src.width)
  const sy = Math.round(crop.y * src.height)
  const sw = Math.max(1, Math.round(crop.w * src.width))
  const sh = Math.max(1, Math.round(crop.h * src.height))
  const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh))
  const out = document.createElement('canvas')
  out.width = Math.round(sw * scale)
  out.height = Math.round(sh * scale)
  const ctx = out.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, out.width, out.height)
  return out
}

export function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', quality))
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
