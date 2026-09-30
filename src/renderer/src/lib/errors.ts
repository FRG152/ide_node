export function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  // Electron envuelve los errores del main: "Error invoking remote method '...': Error: <mensaje>"
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
