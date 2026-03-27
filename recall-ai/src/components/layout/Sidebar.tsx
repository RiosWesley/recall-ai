import { useState } from 'react'
import {
  LayoutDashboard, Upload, Search, MessageSquare,
  Settings, MessageCircle, Clock, ChevronRight
} from 'lucide-react'
import type { Page } from '../../App'

interface SidebarProps {
  currentPage: Page
  navigate: (page: Page, chatId?: string) => void
}

// Mock chats — will be replaced with real data from IPC
const MOCK_CHATS = [
  { id: '1', name: 'Maria — Família', messageCount: 4821, lastActive: '2h atrás' },
  { id: '2', name: 'Trabalho — Squad', messageCount: 12340, lastActive: '1d atrás' },
  { id: '3', name: 'João Silva', messageCount: 892, lastActive: '3d atrás' },
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
            label="Dashboard"
            active={currentPage === 'home'}
            onClick={() => navigate('home')}
          />
          <NavItem
            icon={<Upload size={14} />}
            label="Importar"
            active={currentPage === 'import'}
            onClick={() => navigate('import')}
          />
          <NavItem
            icon={<Search size={14} />}
            label="Busca"
            active={currentPage === 'search'}
            onClick={() => navigate('search')}
            badge="⌘K"
          />
        </nav>
      </div>

      <div className="sidebar__divider" />

      {/* Chats */}
      <div className="sidebar__section" style={{ flex: 1, overflowY: 'auto', paddingBottom: '8px' }}>
        <div className="sidebar__label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Conversas</span>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            color: 'var(--text-muted)',
            background: 'var(--bg-base)',
            padding: '1px 5px',
            borderRadius: '2px',
          }}>
            {MOCK_CHATS.length}
          </span>
        </div>

        {MOCK_CHATS.length === 0 ? (
          <div style={{
            padding: '16px 8px',
            fontSize: '11px',
            color: 'var(--text-muted)',
            textAlign: 'center',
            lineHeight: '1.6'
          }}>
            Nenhuma conversa importada ainda.
            <br />
            <span
              style={{ color: 'var(--accent-emerald-dim)', cursor: 'pointer' }}
              onClick={() => navigate('import')}
            >
              Importar agora →
            </span>
          </div>
        ) : (
          <div className="sidebar__nav" style={{ marginTop: '4px' }}>
            {MOCK_CHATS.map(chat => (
              <div
                key={chat.id}
                className={`chat-item ${activeChatId === chat.id ? 'active' : ''}`}
                onClick={() => handleChatClick(chat.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <MessageCircle size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  <span className="chat-item__name">{chat.name}</span>
                </div>
                <div className="chat-item__meta">
                  {chat.messageCount.toLocaleString('pt-BR')} msgs · {chat.lastActive}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="sidebar__divider" style={{ margin: '12px 0 8px' }} />

        {/* Search History */}
        <div className="sidebar__label">
          <Clock size={10} style={{ display: 'inline', marginRight: '4px' }} />
          Histórico
        </div>

        <div className="sidebar__nav" style={{ marginTop: '4px' }}>
          {MOCK_HISTORY.map(item => (
            <div
              key={item.id}
              className="nav-item"
              style={{ fontSize: '11px', padding: '5px 8px' }}
              onClick={() => navigate('search')}
            >
              <Search size={11} style={{ opacity: 0.5 }} />
              <span style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
              }}>
                {item.query}
              </span>
              <ChevronRight size={10} style={{ opacity: 0.3 }} />
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

        {/* Model Status */}
        <div style={{
          marginTop: '8px',
          padding: '8px 10px',
          background: 'var(--bg-base)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-subtle)',
        }}>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '9px',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: '6px',
          }}>
            Modelo
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
            <span className="status-dot status-dot--ready" />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-secondary)' }}>
              Gemma 3 270M
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className="status-dot status-dot--ready" />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-secondary)' }}>
              MiniLM-L6-v2
            </span>
          </div>
          <div style={{
            marginTop: '6px',
            fontFamily: 'var(--font-mono)',
            fontSize: '9px',
            color: 'var(--accent-emerald-dim)',
          }}>
            CPU · 100% offline
          </div>
        </div>
      </div>
    </aside>
  )
}

/* ─── NavItem helper ─── */
function NavItem({
  icon,
  label,
  active,
  onClick,
  badge,
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
