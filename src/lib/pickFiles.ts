/** Opens the file picker for images and PDFs (several at once). */
export function pickSheetFiles(onFiles: (files: File[]) => void) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*,application/pdf'
  input.multiple = true
  input.onchange = () => input.files?.length && onFiles([...input.files])
  input.click()
}

/** Opens the file picker for one Guitar Pro / MusicXML file. */
export function pickScoreFile(accept: string[], onFile: (file: File) => void) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = accept.join(',')
  input.onchange = () => input.files?.[0] && onFile(input.files[0])
  input.click()
}
