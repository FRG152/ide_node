import { useEffect, useState } from 'react'

/** Los glifos del indicador de Claude Code, en ida y vuelta. */
const FRAMES = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢']
const FRAME_MS = 120

export function Spinner() {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), FRAME_MS)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="claude-spinner" aria-hidden>
      {FRAMES[frame]}
    </span>
  )
}

/** Segundos desde `since` (se actualiza cada segundo); 0 si es null. */
export function useElapsedSeconds(since: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (since === null) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [since])
  return since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000))
}

/** "8s", "1m 05s". */
export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}
