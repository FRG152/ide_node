// Descarga los modelos que la app carga en local y que no van en el repositorio (son binarios
// de varios MB). Se ejecuta tras `npm install`; a mano: `npm run models`.
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const MODELS = [
  {
    // Control con las manos (src/renderer/src/hands/tracker.ts)
    file: 'src/renderer/public/models/hand_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    bytes: 7819105
  }
]

for (const model of MODELS) {
  const target = path.join(root, model.file)
  try {
    if (statSync(target).size === model.bytes) continue
  } catch {
    // aún no está
  }
  try {
    const response = await fetch(model.url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = Buffer.from(await response.arrayBuffer())
    if (data.length !== model.bytes) throw new Error(`tamaño inesperado: ${data.length} bytes`)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, data)
    console.log(`Modelo descargado: ${model.file}`)
  } catch (err) {
    // Sin el modelo la app funciona igual; solo falta la función que lo usa.
    console.warn(`No se pudo descargar ${model.file} (${err.message}). Vuelve a intentarlo con "npm run models".`)
  }
}
