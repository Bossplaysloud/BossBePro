// Copies alphaTab's runtime assets (music font, later the default SoundFont) into public/
// so they are served and precached. alphaTab's own Vite plugin is broken in 1.8.x.
import { cpSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules/@coderline/alphatab/dist')
const dst = join(root, 'public/alphatab')

mkdirSync(join(dst, 'font'), { recursive: true })
for (const f of ['Bravura.woff2', 'Bravura.woff', 'Bravura.otf', 'Bravura-OFL.txt']) {
  cpSync(join(src, 'font', f), join(dst, 'font', f))
}

// The synthesizer always runs in a Web Worker, which alphaTab loads from "./alphaTab.worker.mjs" next to
// the bundled chunk that contains alphaTab (dist/assets/ in production builds).
mkdirSync(join(root, 'public/assets'), { recursive: true })
cpSync(join(src, 'alphaTab.worker.min.mjs'), join(root, 'public/assets/alphaTab.worker.mjs'))
cpSync(join(src, 'alphaTab.core.min.mjs'), join(root, 'public/assets/alphaTab.core.mjs'))

// Built-in playback sounds (General MIDI, SONiVOX EAS).
mkdirSync(join(dst, 'soundfont'), { recursive: true })
for (const f of ['sonivox.sf2', 'LICENSE', 'README.md']) {
  cpSync(join(src, 'soundfont', f), join(dst, 'soundfont', f))
}
