import { useEffect, useRef } from 'react'
import { useT, type MessageKey } from '../i18n'
import { useHandsStore, type HandsStatus } from '../stores/handsStore'
import { createGestureEngine, type HandFrame } from './gestures'
import { createPointerDriver } from './pointer'

/**
 * Evento de ventana para mover el cursor con manos que no vienen de la cámara: otro sensor o
 * las pruebas, que así ejercitan los gestos sin cámara. `detail`: { hands: HandFrame[], time? }.
 */
export const HAND_FRAME_EVENT = 'ide:hand-frame'

const STATUS_TEXT: Record<HandsStatus, MessageKey> = {
  loading: 'hands.loading',
  searching: 'hands.searching',
  tracking: 'hands.tracking',
  'no-model': 'hands.noModel',
  'no-camera': 'hands.noCamera'
}

// Huesos de la mano entre los 21 puntos de MediaPipe, para dibujarla sobre la vista previa.
const BONES = [
  [0, 1, 2, 3, 4],
  [0, 5, 6, 7, 8],
  [5, 9, 10, 11, 12],
  [9, 13, 14, 15, 16],
  [13, 17, 18, 19, 20],
  [0, 17]
]

function drawHands(canvas: HTMLCanvasElement, hands: HandFrame[], pressed: boolean): void {
  const ctx = canvas.getContext('2d')!
  const { width, height } = canvas
  ctx.clearRect(0, 0, width, height)
  ctx.lineWidth = 2
  ctx.strokeStyle = pressed ? '#d77757' : '#b1b9f9'
  ctx.fillStyle = ctx.strokeStyle
  for (const { landmarks } of hands) {
    for (const bone of BONES) {
      ctx.beginPath()
      // La vista previa es un espejo, como el cursor.
      for (const i of bone) ctx.lineTo((1 - landmarks[i].x) * width, landmarks[i].y * height)
      ctx.stroke()
    }
    for (const tip of [4, 8]) {
      ctx.beginPath()
      ctx.arc((1 - landmarks[tip].x) * width, landmarks[tip].y * height, 4, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

/**
 * Control con las manos: un cursor que sigue a la mano y, abajo a la izquierda, lo que ve la
 * cámara con la mano detectada. Se monta solo mientras está activado.
 */
export function HandControl() {
  const t = useT()
  const status = useHandsStore((s) => s.status)
  const cursorRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const { setStatus } = useHandsStore.getState()
    const engine = createGestureEngine(createPointerDriver(cursorRef.current!), () => ({
      width: window.innerWidth,
      height: window.innerHeight
    }))
    const onHands = (hands: HandFrame[], time: number): void => {
      const { visible, pressed } = engine.update(hands, time)
      drawHands(overlayRef.current!, hands, pressed)
      const next = visible ? 'tracking' : 'searching'
      const current = useHandsStore.getState().status
      if (current !== next && (current === 'tracking' || current === 'searching')) setStatus(next)
    }
    const onExternalFrame = (event: Event): void => {
      const { hands, time } = (event as CustomEvent<{ hands: HandFrame[]; time?: number }>).detail
      if (useHandsStore.getState().status !== 'tracking') setStatus('tracking')
      onHands(hands, time ?? performance.now())
    }
    window.addEventListener(HAND_FRAME_EVENT, onExternalFrame)

    let cancelled = false
    let stop: (() => void) | null = null
    void (async () => {
      try {
        const { startTracker } = await import('./tracker')
        const tracker = await startTracker(videoRef.current!, onHands)
        if (cancelled) tracker.stop()
        else {
          stop = tracker.stop
          setStatus('searching')
        }
      } catch (err) {
        console.warn('Control con las manos:', err)
        if (!cancelled) setStatus((err as { reason?: string }).reason === 'camera' ? 'no-camera' : 'no-model')
      }
    })()

    return () => {
      cancelled = true
      stop?.()
      window.removeEventListener(HAND_FRAME_EVENT, onExternalFrame)
      engine.reset()
    }
  }, [])

  return (
    <>
      <div className={`hand-preview ${status}`}>
        <video ref={videoRef} muted playsInline />
        <canvas ref={overlayRef} width={176} height={132} />
        <span className="hand-status">{t(STATUS_TEXT[status])}</span>
      </div>
      <div ref={cursorRef} className="hand-cursor" hidden />
    </>
  )
}
