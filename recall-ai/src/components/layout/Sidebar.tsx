import { useState, useEffect, useCallback } from 'react'
import {
  LayoutDashboard, Search, MessageSquare,
  Settings, Network, Clock,
  MessageCircle, Plus, Trash2
} from 'lucide-react'
import type { Page } from '../../App'
import type { Chat } from '../../shared/types'

interface SidebarProps {
  currentPage: Page
  navigate: (page: Page, chatId?: string) => void
}

export default function Sidebar({ currentPage, navigate }: SidebarProps) {
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [chats, setChats] = useState<Chat[]>([])

  const refreshChats = useCallback(async () => {
    try {
      const data = await window.api.getChats()
      setChats(data)
    } catch (err) {
      console.error('[Sidebar] Failed to load chats:', err)
    }
  }, [])

  useEffect(() => {
    refreshChats()

    // Re-fetch chats after import completes
    const unsub = window.api.onImportProgress((progress) => {
      if (progress.stage === 'done') {
        refreshChats()
      }
    })

    return () => unsub()
  }, [refreshChats])

  const handleChatClick = (chatId: string) => {
    setActiveChatId(chatId)
    navigate('chat', chatId)
  }

  const handleDeleteChat = async (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation()
    try {
      await window.api.deleteChat(chatId)
      setChats((prev) => prev.filter((c) => c.id !== chatId))
      if (activeChatId === chatId) setActiveChatId(null)
    } catch (err) {
      console.error('[Sidebar] Failed to delete chat:', err)
    }
  }

  /** Format a Unix timestamp as a relative label (pt-BR style). */
  function formatRelative(ts: number | null): string {
    if (!ts) return '—'
    const diffMs = Date.now() - ts * 1000
    const diffMin = Math.floor(diffMs / 60_000)
    if (diffMin < 1) return 'agora'
    if (diffMin < 60) return `${diffMin}min atrás`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return `${diffHr}h atrás`
    const diffDay = Math.floor(diffHr / 24)
    if (diffDay < 7) return `${diffDay}d atrás`
    return new Date(ts * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
  }

  // Assign a deterministic color from name hash
  const CHAT_COLORS = ['#00d97e', '#38bdf8', '#f0a500', '#a78bfa', '#f43f5e', '#fb923c']
  function colorFor(id: string): string {
    let h = 0
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
    return CHAT_COLORS[h % CHAT_COLORS.length]
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

        {chats.length === 0 ? (
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
            {chats.map(chat => (
              <div
                key={chat.id}
                className={`chat-item ${activeChatId === chat.id ? 'active' : ''}`}
                onClick={() => handleChatClick(chat.id)}
                style={{ position: 'relative' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flex: 1, minWidth: 0 }}>
                  <div style={{
                    width: '5px', height: '5px', borderRadius: '50%',
                    background: colorFor(chat.id), flexShrink: 0, opacity: 0.8,
                  }} />
                  <span className="chat-item__name">{chat.name}</span>
                </div>
                <div className="chat-item__meta" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <MessageCircle size={9} style={{ display: 'inline' }} />
                  <span>{chat.message_count.toLocaleString('pt-BR')}</span>
                  <span>·</span>
                  <span>{formatRelative(chat.last_message_at)}</span>
                  {/* Delete button — visible on hover */}
                  <button
                    title="Excluir chat"
                    onClick={(e) => handleDeleteChat(e, chat.id)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-muted)', padding: '0', marginLeft: '2px',
                      opacity: 0, transition: 'opacity 0.15s',
                      display: 'flex', alignItems: 'center',
                    }}
                    className="chat-delete-btn"
                  >
                    <Trash2 size={9} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="sidebar__divider" style={{ margin: '12px 0 8px' }} />

        {/* Search History — static empty state for now (populated in TASK 2.5) */}
        <div className="sidebar__label">
          <Clock size={9} style={{ display: 'inline', marginRight: '4px' }} />
          Buscas Recentes
        </div>

        <div className="sidebar__nav" style={{ marginTop: '4px' }}>
          <div style={{ padding: '8px', fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center' }}>
            Nenhuma busca ainda
          </div>
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

        {/* Offline Status */}
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
              {chats.length} fonte{chats.length !== 1 ? 's' : ''} · 100% local
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
