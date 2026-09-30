/** Color de acento por extensión, para distinguir tipos de archivo de un vistazo en el grafo. */
const COLORS: Record<string, string> = {
  ts: '#3178c6',
  tsx: '#3178c6',
  js: '#e8d44d',
  jsx: '#e8d44d',
  mjs: '#e8d44d',
  cjs: '#e8d44d',
  json: '#cb8742',
  css: '#c965a8',
  scss: '#c965a8',
  html: '#e44d26',
  md: '#7fa7c9',
  py: '#4b8bbe',
  java: '#b07219',
  cs: '#178600',
  go: '#00add8',
  rs: '#dea584',
  png: '#a074c4',
  jpg: '#a074c4',
  jpeg: '#a074c4',
  svg: '#a074c4',
  gif: '#a074c4'
}

const DEFAULT_COLOR = '#6b6b6b'

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

export function colorForFile(name: string): string {
  return COLORS[extensionOf(name)] ?? DEFAULT_COLOR
}
