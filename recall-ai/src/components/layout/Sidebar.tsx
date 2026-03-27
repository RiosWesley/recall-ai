import { useState } from 'react'
import {
  LayoutDashboard, Search, MessageSquare,
  Settings, Network, ChevronRight, Clock,
  MessageCircle, Plus
} from 'lucide-react'
import type { Page } from '../../App'

interface SidebarProps {
  currentPage: Page
  navigate: (page: Page, chatId?: string) => void
}

// Mock sources — will be replaced with real data from IPC
const MOCK_SOURCES = [
  { id: '1', name: 'Maria — Família', messageCount: 4821, lastActive: '2h atrás', color: '#00d97e' },
  { id: '2', name: 'Trabalho — Squad', messageCount: 12340, lastActive: '1d atrás', color: '#38bdf8' },
  { id: '3', name: 'João Silva', messageCount: 892, lastActive: '3d atrás', color: '#f0a500' },
]

const MOCK_HISTORY = [
  { id: 'h1', query: 'receita de bolo de cenoura' },
  { id: 'h2', query: 'reunião de segunda-feira' },
  { id: 'h3', query: 'endereço da festa' },
]

export default function Sidebar({ currentPage, navigate }: SidebarProps) {
  const [activeChatId, setActiveChatId] = useState<string | null>(null)

  const handleChatClick = (chatId: string) => {
    setActiveChatId(chatId)
    navigate('chat', chatId)
  }

  return (
    <aside className="sidebar">
      {/* Primary Navigation */}
      <div className="sidebar__section">
        <nav className="sidebar__nav">
          <NavItem
            icon={<LayoutDashboard size={14} />}
            label="Início"
            active={currentPage === 'home'}
            onClick={() => navigate('home')}
          />
          <NavItem
            icon={<Network size={14} />}
            label="Pessoas"
            active={currentPage === 'people'}
            onClick={() => navigate('people')}
          />
          <NavItem
            icon={<Search size={14} />}
            label="Buscar"
            active={currentPage === 'search'}
            onClick={() => navigate('search')}
            badge="⌘K"
          />
        </nav>
      </div>

      <div className="sidebar__divider" />

      {/* Memory Sources */}
      <div className="sidebar__section" style={{ flex: 1, overflowY: 'auto', paddingBottom: '8px' }}>
        {/* Section Header */}
        <div className="sidebar__label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Fontes de Memória</span>
          <button
            title="Importar nova conversa"
            onClick={() => navigate('import')}
            style={{
              background: 'var(--bg-overlay)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '3px',
              width: '16px', height: '16px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              transition: 'background 0.15s, color 0.15s',
              flexShrink: 0,
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent-emerald-subtle)'
              ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--accent-emerald)'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-overlay)'
              ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'
            }}
          >
            <Plus size={10} />
          </button>
        </div>

        {MOCK_SOURCES.length === 0 ? (
          <div style={{
            padding: '16px 8px',
            fontSize: '11px',
            color: 'var(--text-muted)',
            textAlign: 'center',
            lineHeight: '1.6'
          }}>
            Nenhuma fonte adicionada.
            <br />
            <span
              style={{ color: 'var(--accent-emerald-dim)', cursor: 'pointer' }}
              onClick={() => navigate('import')}
            >
              Importar conversa →
            </span>
          </div>
        ) : (
          <div className="sidebar__nav" style={{ marginTop: '4px' }}>
            {MOCK_SOURCES.map(source => (
              <div
                key={source.id}
                className={`chat-item ${activeChatId === source.id ? 'active' : ''}`}
                onClick={() => handleChatClick(source.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                  {/* Color dot instead of generic icon */}
                  <div style={{
                    width: '5px', height: '5px', borderRadius: '50%',
                    background: source.color, flexShrink: 0, opacity: 0.8,
                  }} />
                  <span className="chat-item__name">{source.name}</span>
                </div>
                <div className="chat-item__meta">
                  <MessageCircle size={9} style={{ display: 'inline', marginRight: '3px' }} />
                  {source.messageCount.toLocaleString('pt-BR')} · {source.lastActive}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="sidebar__divider" style={{ margin: '12px 0 8px' }} />

        {/* Search History */}
        <div className="sidebar__label">
          <Clock size={9} style={{ display: 'inline', marginRight: '4px' }} />
          Buscas Recentes
        </div>

        <div className="sidebar__nav" style={{ marginTop: '4px' }}>
          {MOCK_HISTORY.length === 0 ? (
            <div style={{ padding: '8px', fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center' }}>
              Nenhuma busca ainda
            </div>
          ) : MOCK_HISTORY.map(item => (
            <div
              key={item.id}
              className="nav-item"
              style={{ fontSize: '11px', padding: '5px 8px' }}
              onClick={() => navigate('search')}
            >
              <Search size={11} style={{ opacity: 0.4, flexShrink: 0 }} />
              <span style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
                color: 'var(--text-muted)',
              }}>
                {item.query}
              </span>
              <ChevronRight size={10} style={{ opacity: 0.3, flexShrink: 0 }} />
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="sidebar__footer">
        <NavItem
          icon={<Settings size={14} />}
          label="Configurações"
          active={currentPage === 'settings'}
          onClick={() => navigate('settings')}
        />

        {/* Offline Status — simplified */}
        <div style={{
          marginTop: '8px',
          padding: '8px 10px',
          background: 'var(--bg-base)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          gap: '7px',
        }}>
          <span className="status-dot status-dot--ready" style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: '10px',
              color: 'var(--accent-emerald-dim)', fontWeight: '500',
            }}>
              Memória offline
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: '9px',
              color: 'var(--text-muted)', marginTop: '1px',
            }}>
              100% local · pronto
            </div>
          </div>
          <MessageSquare size={11} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
        </div>
      </div>
    </aside>
  )
}

/* ─── NavItem helper ─── */
function NavItem({
  icon, label, active, onClick, badge,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
  badge?: string
}) {
  return (
    <button
      className={`nav-item ${active ? 'active' : ''}`}
      onClick={onClick}
      style={{ width: '100%', textAlign: 'left' }}
    >
      <span className="nav-item__icon">{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {badge && <span className="nav-item__badge">{badge}</span>}
    </button>
  )
}
