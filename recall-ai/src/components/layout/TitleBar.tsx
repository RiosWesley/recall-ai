import { BrainCircuit } from 'lucide-react'
import type { Page } from '../../App'

const PAGE_LABELS: Record<Page, string> = {
  home: 'Dashboard',
  import: 'Importar Conversa',
  search: 'Busca Semântica',
  chat: 'Conversa com IA',
  settings: 'Configurações',
  people: 'Grafo de Pessoas',
}

interface TitleBarProps {
  currentPage: Page
}

export default function TitleBar({ currentPage }: TitleBarProps) {
  const handleMinimize = () => window.api?.windowMinimize()
  const handleMaximize = () => window.api?.windowMaximize()
  const handleClose = () => window.api?.windowClose()

  return (
    <header className="titlebar">
      {/* Logo area — left, fixed width matches sidebar */}
      <div className="titlebar__logo">
        <BrainCircuit size={15} style={{ color: 'var(--accent-emerald)' }} />
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          fontWeight: '600',
          color: 'var(--text-primary)',
          letterSpacing: '-0.01em',
        }}>
          recall<span style={{ color: 'var(--accent-emerald)' }}>.ai</span>
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '9px',
          color: 'var(--text-muted)',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          padding: '1px 5px',
          borderRadius: '2px',
          marginLeft: '4px',
        }}>
          v0.1
        </span>
      </div>

      {/* Current page breadcrumb */}
      <div className="titlebar__meta">
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          color: 'var(--text-muted)',
        }}>
          {PAGE_LABELS[currentPage]}
        </span>
      </div>

      {/* Window controls */}
      <div className="titlebar__controls">
        <button className="window-btn window-btn--minimize" onClick={handleMinimize} title="Minimizar" />
        <button className="window-btn window-btn--maximize" onClick={handleMaximize} title="Maximizar" />
        <button className="window-btn window-btn--close" onClick={handleClose} title="Fechar" />
      </div>
    </header>
  )
}
