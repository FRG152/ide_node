/**
 * Monaco empaquetado en local (sin CDN): los workers los genera Vite con `?worker`.
 */
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import CssWorker from 'monaco-editor/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    switch (label) {
      case 'json':
        return new JsonWorker()
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker()
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker()
      case 'typescript':
      case 'javascript':
        return new TsWorker()
      default:
        return new EditorWorker()
    }
  }
}

// El servicio de TypeScript de Monaco solo ve los archivos abiertos, no el proyecto
// (ni node_modules), así que los errores semánticos serían casi todos falsos
// ("no se encuentra el módulo..."). Dejamos solo los de sintaxis.
for (const defaults of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
  defaults.setCompilerOptions({
    target: monaco.typescript.ScriptTarget.ESNext,
    module: monaco.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
    jsx: monaco.typescript.JsxEmit.ReactJSX,
    allowJs: true,
    allowNonTsExtensions: true,
    esModuleInterop: true
  })
  defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false })
}

/** Tema del editor con la paleta de Claude Code (ver styles.css). */
export const CLAUDE_THEME = 'claude-code'
monaco.editor.defineTheme(CLAUDE_THEME, {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '8a877e', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'd77757' },
    { token: 'keyword.control', foreground: 'd77757' },
    { token: 'storage', foreground: 'd77757' },
    { token: 'string', foreground: 'c4d39a' },
    { token: 'number', foreground: 'b1b9f9' },
    { token: 'regexp', foreground: 'eb9f7f' },
    { token: 'type', foreground: '6fb8ad' },
    { token: 'type.identifier', foreground: '6fb8ad' },
    { token: 'delimiter', foreground: 'a8a69d' },
    { token: 'tag', foreground: 'eb9f7f' },
    { token: 'attribute.name', foreground: 'b1b9f9' },
    { token: 'attribute.value', foreground: 'c4d39a' }
  ],
  colors: {
    'editor.background': '#1f1e1d',
    'editor.foreground': '#f5f4ef',
    'editor.lineHighlightBackground': '#262624',
    'editor.lineHighlightBorder': '#00000000',
    'editorLineNumber.foreground': '#5c5b55',
    'editorLineNumber.activeForeground': '#d77757',
    'editorCursor.foreground': '#d77757',
    'editor.selectionBackground': '#d7775750',
    'editor.inactiveSelectionBackground': '#d7775728',
    'editor.selectionHighlightBackground': '#d7775722',
    'editor.findMatchBackground': '#ffc10755',
    'editor.findMatchHighlightBackground': '#ffc10726',
    'editorIndentGuide.background1': '#30302e',
    'editorIndentGuide.activeBackground1': '#52514c',
    'editorBracketMatch.background': '#d7775730',
    'editorBracketMatch.border': '#d77757',
    'editorWidget.background': '#262624',
    'editorWidget.border': '#52514c',
    'editorSuggestWidget.background': '#262624',
    'editorSuggestWidget.border': '#52514c',
    'editorSuggestWidget.selectedBackground': '#3a3936',
    'editorHoverWidget.background': '#262624',
    'editorHoverWidget.border': '#52514c',
    'input.background': '#30302e',
    'input.border': '#52514c',
    'focusBorder': '#d77757',
    'minimap.background': '#1f1e1d',
    'scrollbar.shadow': '#00000000',
    'scrollbarSlider.background': '#d7775738',
    'scrollbarSlider.hoverBackground': '#eb9f7fb0',
    'scrollbarSlider.activeBackground': '#d77757'
  }
})

export { monaco }
