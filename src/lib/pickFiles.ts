/** Opens the file picker for images and PDFs (several at once). */
export function pickSheetFiles(onFiles: (files: File[]) => void) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*,application/pdf'
  input.multiple = true
  input.onchange = () => input.files?.length && onFiles([...input.files])
  input.click()
}

/** iPhone and iPad (iPads report themselves as a Mac with a touch screen). */
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

/**
 * Opens the file picker for one Guitar Pro / MusicXML file.
 * iOS greys out files whose extension it doesn't know (.gp, .gp5, .gpx…) when a filter is set, so there
 * every file can be chosen and a wrong one is caught when it's read.
 */
export function pickScoreFile(accept: string[], onFile: (file: File) => void) {
  const input = document.createElement('input')
  input.type = 'file'
  if (!isIOS()) input.accept = accept.join(',')
  // Kept in the page until a file is chosen: iOS can drop the change event of a detached input.
  input.style.display = 'none'
  document.body.append(input)
  input.onchange = () => {
    const file = input.files?.[0]
    input.remove()
    if (file) onFile(file)
  }
  input.click()
}
