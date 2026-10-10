/**
 * Cámara + MediaPipe Hand Landmarker: entrega las manos detectadas en cada fotograma.
 *
 * Este módulo se carga con import() solo al activar el control con las manos: trae la
 * librería de MediaPipe y su WebAssembly (13 MB), que no hacen falta para nada más.
 * Todo corre en local: ni el vídeo ni los puntos salen del equipo. MediaPipe intenta enviar
 * estadísticas de uso a odml.pa.googleapis.com y no ofrece forma de desactivarlo: lo impide la
 * Content-Security-Policy de index.html (default-src 'self'), y en la consola queda el aviso
 * del bloqueo. No hay que añadir un connect-src que lo deje pasar.
 */
import { HandLandmarker } from '@mediapipe/tasks-vision'
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'
import type { HandFrame } from './gestures'

/** El modelo no va en el repositorio: lo descarga `npm run models` (ver scripts/fetch-models.mjs). */
const MODEL_URL = `${import.meta.env.BASE_URL}models/hand_landmarker.task`

/** Por qué no se pudo empezar, para dar al usuario un mensaje que le sirva. */
export class TrackerError extends Error {
  constructor(
    readonly reason: 'model' | 'camera',
    cause: unknown
  ) {
    super(cause instanceof Error ? cause.message : String(cause))
  }
}

export interface Tracker {
  stop: () => void
}

async function loadModel(): Promise<Uint8Array> {
  const response = await fetch(MODEL_URL)
  // El servidor de desarrollo responde con index.html a lo que no existe.
  if (!response.ok || response.headers.get('content-type')?.includes('text/html')) throw new Error(`${MODEL_URL}: ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * Enciende la cámara sobre `video` y llama a `onHands` con cada fotograma analizado
 * (lista vacía si no hay manos a la vista).
 */
export async function startTracker(video: HTMLVideoElement, onHands: (hands: HandFrame[], time: number) => void): Promise<Tracker> {
  let landmarker: HandLandmarker
  try {
    landmarker = await HandLandmarker.createFromOptions(
      { wasmLoaderPath, wasmBinaryPath },
      { baseOptions: { modelAssetBuffer: await loadModel(), delegate: 'GPU' }, runningMode: 'VIDEO', numHands: 2 }
    )
  } catch (err) {
    throw new TrackerError('model', err)
  }

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
    })
    video.srcObject = stream
    await video.play()
  } catch (err) {
    landmarker.close()
    throw new TrackerError('camera', err)
  }

  let stopped = false
  let request = 0
  const onFrame = (): void => {
    if (stopped) return
    const time = performance.now()
    const result = landmarker.detectForVideo(video, time)
    onHands(
      result.landmarks.map((landmarks, i) => ({ landmarks, handedness: result.handedness[i]?.[0]?.categoryName ?? String(i) })),
      time
    )
    request = video.requestVideoFrameCallback(onFrame)
  }
  request = video.requestVideoFrameCallback(onFrame)

  return {
    stop() {
      stopped = true
      video.cancelVideoFrameCallback(request)
      for (const track of stream.getTracks()) track.stop()
      video.srcObject = null
      landmarker.close()
    }
  }
}
