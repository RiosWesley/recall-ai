import { useEffect, useState } from 'react'
import {
  MessageSquare, Upload, Clock, Sparkles,
  ArrowRight, Network, Users
} from 'lucide-react'
import type { Page } from '../App'

interface HomePageProps {
  navigate: (page: Page) => void
}

// Mock data — will come from IPC when integrated
const HAS_DATA = true // Toggle to false to see empty state

const MEMORY_STATS = HAS_DATA
  ? [
    { label: 'Pessoas na memória', value: '6', sub: 'em 3 conversas', icon: Users, color: 'var(--accent-emerald)' },
    { label: 'Conversas importadas', value: '3', sub: 'últimas: há 2h', icon: MessageSquare, color: 'var(--accent-cyan)' },
    { label: 'Memórias registradas', value: '4.821', sub: 'mensagens indexadas', icon: Sparkles, color: 'var(--accent-amber)' },
    { label: 'Última busca', value: 'hoje', sub: 'receita de bolo de cenoura', icon: Clock, color: '#a78bfa' },
  ]
  : [
    { label: 'Pessoas', value: '—', sub: 'importe conversas para começar', icon: Users, color: 'var(--text-muted)' },
    { label: 'Conversas', value: '—', sub: 'nenhuma fonte adicionada', icon: MessageSquare, color: 'var(--text-muted)' },
    { label: 'Memórias', value: '—', sub: 'aguardando dados', icon: Sparkles, color: 'var(--text-muted)' },
    { label: 'Última busca', value: '—', sub: 'nenhuma busca realizada', icon: Clock, color: 'var(--text-muted)' },
  ]

const FEATURED_PEOPLE = [
  { initials: 'MS', name: 'Maria', color: '#00d97e', count: 4821 },
  { initials: 'AP', name: 'Ana', color: '#38bdf8', count: 3200 },
  { initials: 'JS', name: 'João', color: '#f0a500', count: 892 },
]

const RECENT_MEMORIES = [
  {
    id: 'm1',
    person: 'Maria Santos',
    personColor: '#00d97e',
    personInitials: 'MS',
    excerpt: 'Receita de bolo de cenoura com cobertura de chocolate... o segredo é usar cenoura bem fresca.',
    chat: 'Maria — Família',
    when: 'há 14 mar 2024',
  },
  {
    id: 'm2',
    person: 'Ana Pereira',
    personColor: '#38bdf8',
    personInitials: 'AP',
    excerpt: 'Planning da sprint 12 confirmado para segunda-feira às 14h. Por favor confirmar presença.',
    chat: 'Trabalho — Squad',
    when: 'há 1d',
  },
  {
    id: 'm3',
    person: 'João Silva',
    personColor: '#f0a500',
    personInitials: 'JS',
    excerpt: 'Link do repositório atualizado — precisa dar merge na branch main antes do deploy.',
    chat: 'João Silva',
    when: 'há 3d',
  },
]

export default function HomePage({ navigate }: HomePageProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 50)
    return () => clearTimeout(t)
  }, [])

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
          {HAS_DATA ? 'Sua memória está ativa.' : 'Bem-vindo ao Recall.ai'}
        </h1>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
          {HAS_DATA
            ? 'Tudo aqui fica no seu computador — offline, privado, seu.'
            : 'Importe suas conversas para construir sua memória digital — 100% offline.'}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid-4" style={{ marginBottom: '24px' }}>
        {MEMORY_STATS.map((stat, i) => (
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

      {HAS_DATA ? (
        <>
          {/* Featured People */}
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
              {FEATURED_PEOPLE.map((p, i) => (
                <div
                  key={p.initials}
                  className="result-card animate-fade-in-up"
                  onClick={() => navigate('people')}
                  style={{
                    animationDelay: `${200 + i * 60}ms`,
                    flex: 1, display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px',
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
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '2px' }}>
                      {p.name}
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)' }}>
                      {p.count.toLocaleString('pt-BR')} msgs
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Memories */}
          <div>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: '10px',
              textTransform: 'uppercase', letterSpacing: '0.08em',
              color: 'var(--text-muted)', marginBottom: '12px',
            }}>
              Memórias recentes
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {RECENT_MEMORIES.map((mem, i) => (
                <div
                  key={mem.id}
                  className="result-card animate-fade-in-up"
                  style={{ animationDelay: `${350 + i * 60}ms` }}
                  onClick={() => navigate('search')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <div style={{
                      width: '22px', height: '22px',
                      borderRadius: '5px',
                      background: `${mem.personColor}18`,
                      border: `1px solid ${mem.personColor}40`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: '700', color: mem.personColor }}>
                        {mem.personInitials}
                      </span>
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: mem.personColor, fontWeight: '500' }}>
                      {mem.person}
                    </div>
                    <div style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-muted)' }}>
                      {mem.when}
                    </div>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.65', userSelect: 'text' }}>
                    {mem.excerpt}
                  </div>
                  <div style={{
                    marginTop: '8px',
                    fontFamily: 'var(--font-mono)', fontSize: '10px',
                    color: 'var(--text-muted)',
                  }}>
                    {mem.chat}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
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
      )}
    </div>
  )
}
