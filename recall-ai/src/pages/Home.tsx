import { useEffect, useState, useCallback } from 'react'
import {
  MessageSquare, Upload, Clock, Sparkles,
  ArrowRight, Network, Users
} from 'lucide-react'
import type { Page } from '../App'
import type { Person, Chat } from '../shared/types'

interface HomePageProps {
  navigate: (page: Page) => void
}

interface HomeStats {
  peopleCount: number
  chatCount: number
  messageCount: number
  tagCount: number
  memoriesCount: number
}

interface FeaturedPerson {
  id: string
  initials: string
  name: string
  color: string
  count: number
  tags: string[]
}

interface RecentChat {
  id: string
  name: string
  messageCount: number
  lastMessageAt: number | null
}

export default function HomePage({ navigate }: HomePageProps) {
  const [visible, setVisible] = useState(false)
  const [stats, setStats] = useState<HomeStats | null>(null)
  const [featuredPeople, setFeaturedPeople] = useState<FeaturedPerson[]>([])
  const [recentChats, setRecentChats] = useState<RecentChat[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    try {
      const [chats, people] = await Promise.all([
        window.api.getChats(),
        window.api.getPeople(),
      ])

      // Compute stats
      const totalMessages = chats.reduce((sum: number, c: Chat) => sum + c.message_count, 0)

      // Fetch tags + memories for top people in parallel (cap at 5)
      const topPeople = [...people]
        .sort((a: Person, b: Person) => b.message_count - a.message_count)
        .slice(0, 5)

      const knowledgeResults = await Promise.all(
        topPeople.map((p: Person) =>
          window.api.getPersonKnowledge(p.id).catch(() => ({ tags: [], memories: [] }))
        )
      )

      const totalTags = knowledgeResults.reduce((sum, k) => sum + k.tags.length, 0)
      const totalMemories = knowledgeResults.reduce((sum, k) => sum + k.memories.length, 0)

      setStats({
        peopleCount: people.length,
        chatCount: chats.length,
        messageCount: totalMessages,
        tagCount: totalTags,
        memoriesCount: totalMemories,
      })

      // Featured people (top 3 by message count) with initials + tags
      const featured: FeaturedPerson[] = topPeople.slice(0, 3).map((p: Person, idx: number) => ({
        id: p.id,
        initials: p.name.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase(),
        name: p.name.split(' ')[0],
        color: p.color,
        count: p.message_count,
        tags: knowledgeResults[idx]?.tags.slice(0, 2).map((t: { tag: string }) => t.tag) ?? [],
      }))
      setFeaturedPeople(featured)

      // Recent chats (last 3 by last_message_at)
      const recent: RecentChat[] = [...chats]
        .sort((a: Chat, b: Chat) => (b.last_message_at ?? 0) - (a.last_message_at ?? 0))
        .slice(0, 3)
        .map((c: Chat) => ({
          id: c.id,
          name: c.name,
          messageCount: c.message_count,
          lastMessageAt: c.last_message_at,
        }))
      setRecentChats(recent)
    } catch (err) {
      console.error('[Home] Failed to load data', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 50)
    loadData()
    return () => clearTimeout(t)
  }, [loadData])

  const hasData = !loading && (stats?.chatCount ?? 0) > 0

  const memoryStats = hasData && stats
    ? [
        { label: 'Pessoas na memória', value: String(stats.peopleCount), sub: `em ${stats.chatCount} conversa${stats.chatCount !== 1 ? 's' : ''}`, icon: Users, color: 'var(--accent-emerald)' },
        { label: 'Conversas importadas', value: String(stats.chatCount), sub: `${stats.messageCount.toLocaleString('pt-BR')} mensagens`, icon: MessageSquare, color: 'var(--accent-cyan)' },
        { label: 'Tags extraídas', value: String(stats.tagCount), sub: `via Map-Reduce`, icon: Sparkles, color: 'var(--accent-amber)' },
        { label: 'Memórias biográficas', value: String(stats.memoriesCount), sub: 'registradas pela IA', icon: Clock, color: '#a78bfa' },
      ]
    : [
        { label: 'Pessoas', value: loading ? '…' : '—', sub: 'importe conversas para começar', icon: Users, color: 'var(--text-muted)' },
        { label: 'Conversas', value: loading ? '…' : '—', sub: 'nenhuma fonte adicionada', icon: MessageSquare, color: 'var(--text-muted)' },
        { label: 'Tags', value: loading ? '…' : '—', sub: 'aguardando dados', icon: Sparkles, color: 'var(--text-muted)' },
        { label: 'Memórias', value: loading ? '…' : '—', sub: 'aguardando IA', icon: Clock, color: 'var(--text-muted)' },
      ]

  return (
    <div
      className="page"
      style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.4s ease' }}
    >
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '10px',
          color: 'var(--accent-emerald-dim)',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          marginBottom: '6px',
        }}>
          ⬤ memória offline · pronto
        </div>
        <h1 style={{
          fontSize: '22px', fontWeight: '700',
          color: 'var(--text-primary)', letterSpacing: '-0.025em',
          lineHeight: 1.2, marginBottom: '6px',
        }}>
          {hasData ? 'Sua memória está ativa.' : 'Bem-vindo ao Recall.ai'}
        </h1>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
          {hasData
            ? 'Tudo aqui fica no seu computador — offline, privado, seu.'
            : 'Importe suas conversas para construir sua memória digital — 100% offline.'}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid-4" style={{ marginBottom: '24px' }}>
        {memoryStats.map((stat, i) => (
          <div
            key={stat.label}
            className="stat-card animate-fade-in-up"
            style={{ animationDelay: `${i * 60}ms`, cursor: 'default' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: '9px',
                color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em',
              }}>
                {stat.label}
              </span>
              <stat.icon size={12} style={{ color: stat.color, opacity: 0.7 }} />
            </div>
            <div style={{
              fontSize: '24px', fontWeight: '700',
              color: stat.color === 'var(--text-muted)' ? 'var(--text-disabled)' : 'var(--text-primary)',
              letterSpacing: '-0.03em', lineHeight: 1,
              marginBottom: '5px',
            }}>
              {stat.value}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{stat.sub}</div>
          </div>
        ))}
      </div>

      {hasData ? (
        <>
          {/* Featured People */}
          {featuredPeople.length > 0 && (
            <div style={{ marginBottom: '24px' }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: '12px',
              }}>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: '10px',
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                  color: 'var(--text-muted)',
                }}>
                  Pessoas em destaque
                </div>
                <button
                  className="btn btn--ghost"
                  onClick={() => navigate('people')}
                  style={{ fontSize: '11px', padding: '4px 10px', gap: '5px' }}
                >
                  <Network size={11} />
                  Ver grafo
                  <ArrowRight size={10} />
                </button>
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                {featuredPeople.map((p, i) => (
                  <div
                    key={p.id}
                    className="result-card animate-fade-in-up"
                    onClick={() => navigate('people')}
                    style={{
                      animationDelay: `${200 + i * 60}ms`,
                      flex: 1, display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{
                      width: '36px', height: '36px', flexShrink: 0,
                      borderRadius: '8px',
                      background: `${p.color}18`,
                      border: `1.5px solid ${p.color}40`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: '700', color: p.color }}>
                        {p.initials}
                      </span>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '2px' }}>
                        {p.name}
                      </div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                        {p.count.toLocaleString('pt-BR')} msgs
                      </div>
                      {p.tags.length > 0 && (
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          {p.tags.map(tag => (
                            <span key={tag} style={{
                              fontFamily: 'var(--font-mono)', fontSize: '9px',
                              background: `${p.color}14`,
                              border: `1px solid ${p.color}30`,
                              color: p.color,
                              padding: '1px 5px', borderRadius: '2px',
                              opacity: 0.85,
                            }}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Chats */}
          {recentChats.length > 0 && (
            <div>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: '10px',
                textTransform: 'uppercase', letterSpacing: '0.08em',
                color: 'var(--text-muted)', marginBottom: '12px',
              }}>
                Conversas recentes
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {recentChats.map((chat, i) => {
                  const ts = chat.lastMessageAt
                    ? new Date(chat.lastMessageAt * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
                    : null

                  return (
                    <div
                      key={chat.id}
                      className="result-card animate-fade-in-up"
                      style={{ animationDelay: `${350 + i * 60}ms`, cursor: 'pointer' }}
                      onClick={() => navigate('chat')}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <MessageSquare size={13} style={{ color: 'var(--accent-emerald)', flexShrink: 0 }} />
                        <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {chat.name}
                        </div>
                        {ts && (
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-muted)', flexShrink: 0 }}>
                            {ts}
                          </div>
                        )}
                      </div>
                      <div style={{
                        marginTop: '6px',
                        fontFamily: 'var(--font-mono)', fontSize: '10px',
                        color: 'var(--text-muted)',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      }}>
                        <span>{chat.messageCount.toLocaleString('pt-BR')} mensagens</span>
                        <span style={{ color: 'var(--accent-emerald)', opacity: 0.7 }}>Perguntar à IA →</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      ) : !loading ? (
        /* Empty State CTA */
        <div style={{
          background: 'var(--accent-emerald-subtle)',
          border: '1px solid rgba(0, 217, 126, 0.18)',
          borderRadius: 'var(--radius-md)',
          padding: '24px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px',
          animation: 'fadeInUp 0.5s ease 0.3s forwards', opacity: 0,
        }}>
          <div>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: '10px',
              color: 'var(--accent-emerald-dim)', textTransform: 'uppercase',
              letterSpacing: '0.08em', marginBottom: '6px',
            }}>
              Primeiros passos
            </div>
            <div style={{
              fontSize: '14px', fontWeight: '600',
              color: 'var(--text-primary)', letterSpacing: '-0.01em', marginBottom: '4px',
            }}>
              Exporte uma conversa do WhatsApp e importe aqui
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              WhatsApp → Conversa → ⋮ → Mais → Exportar conversa → Sem mídia
            </div>
          </div>
          <button
            className="btn btn--primary"
            onClick={() => navigate('import')}
            style={{ flexShrink: 0, gap: '8px' }}
          >
            <Upload size={13} />
            Importar
          </button>
        </div>
      ) : null}
    </div>
  )
}
