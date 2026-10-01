import { useMemo } from 'react'
import type { Language } from '../../../shared/ipc'
import { LANGUAGE_NAMES, useLanguageStore, useT } from '../i18n'
import { useEditorStore } from '../stores/editorStore'
import { useProjectStore } from '../stores/projectStore'
import { DEFAULT_FONT_SIZE, useZoomStore, windowZoomPercent, type ZoomTarget } from '../stores/zoomStore'

export function StatusBar() {
  const t = useT()
  const project = useProjectStore((s) => s.project)
  const index = useProjectStore((s) => s.index)
  const indexing = useProjectStore((s) => s.indexing)
  const truncated = useProjectStore((s) => s.indexTruncated)
  const error = useProjectStore((s) => s.error)
  const setError = useProjectStore((s) => s.setError)
  const unsaved = useEditorStore((s) => Object.keys(s.dirty).length)
  const { windowLevel, fontSize, resetWindow, resetFont } = useZoomStore()
  const { language, setLanguage } = useLanguageStore()

  const fileCount = useMemo(() => index.filter((e) => e.kind === 'file').length, [index])

  return (
    <footer className="statusbar">
      <span>
        {!project
          ? t('status.ready')
          : indexing
            ? t('status.indexing')
            : t('status.counts', { files: fileCount, folders: index.length - fileCount }) +
              (truncated ? t('status.truncated') : '')}
      </span>
      <span className="statusbar-right">
        {unsaved > 0 && <span>{t('status.unsaved', { count: unsaved })}</span>}
        {windowLevel !== 0 && (
          <button className="statusbar-item" onClick={resetWindow} title={t('status.zoomTitle')}>
            {t('status.zoom', { percent: windowZoomPercent(windowLevel) })}
          </button>
        )}
        {(['editor', 'terminal'] as ZoomTarget[])
          .filter((target) => fontSize[target] !== DEFAULT_FONT_SIZE)
          .map((target) => (
            <button key={target} className="statusbar-item" onClick={() => resetFont(target)} title={t('status.fontTitle')}>
              {t(target === 'editor' ? 'status.fontEditor' : 'status.fontTerminal', {
                percent: Math.round((fontSize[target] / DEFAULT_FONT_SIZE) * 100)
              })}
            </button>
          ))}
        <select
          className="statusbar-language"
          value={language}
          title={t('status.languageTitle')}
          onChange={(e) => setLanguage(e.target.value as Language)}
        >
          {(Object.keys(LANGUAGE_NAMES) as Language[]).map((lang) => (
            <option key={lang} value={lang}>
              {LANGUAGE_NAMES[lang]}
            </option>
          ))}
        </select>
      </span>
      {error && (
        <span className="statusbar-error">
          {error}
          <button onClick={() => setError(null)} title={t('status.dismiss')}>
            ✕
          </button>
        </span>
      )}
    </footer>
  )
}
