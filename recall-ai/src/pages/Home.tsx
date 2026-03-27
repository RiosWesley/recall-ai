import { useEffect, useState } from 'react'
import {
  MessageSquare, Search, Upload, Activity,
  ArrowRight, BrainCircuit, Cpu, Zap
} from 'lucide-react'
import type { Page } from '../App'

interface HomePageProps {
  navigate: (page: Page) => void
}

const STATS = [
  { label: 'Mensagens Indexadas', value: '0', sub: 'nenhuma conversa importada', icon: MessageSquare },
  { label: 'Buscas Realizadas', value: '0', sub: 'histórico vazio', icon: Search },
  { label: 'Chunks Vetorizados', value: '0', sub: 'aguardando dados', icon: Activity },
  { label: 'Tempo de Resposta', value: '—', sub: 'aguardando consulta', icon: Zap },
]

const FEATURES = [
  {
    icon: Search,
    title: 'Busca Semântica',
    desc: 'Encontre mensagens pelo significado, não apenas por palavras-chave exatas.',
    color: 'var(--accent-emerald)',
  },
  {
    icon: BrainCircuit,
    title: 'IA Generativa Local',
    desc: 'Pergunte sobre suas conversas e receba respostas contextuais com fontes.',
    color: 'var(--accent-cyan)',
  },
  {
    icon: Cpu,
    title: '100% Offline',
    desc: 'Seus dados jamais saem do seu computador. CPU e GPU suportados.',
    color: 'var(--accent-amber)',
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
      style={{
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.4s ease',
      }}
    >
      {/* Header */}
      <div className="page-header" style={{ marginBottom: '28px' }}>
        <div className="page-header__eyebrow">Dashboard</div>
        <h1 className="page-header__title">
          Bem-vindo ao{' '}
          <span style={{ color: 'var(--accent-emerald)' }}>Recall.ai</span>
        </h1>
        <p className="page-header__desc">
          Busca semântica e IA generativa para suas conversas — 100% offline.
        </p>
      </div>

      {/* Quick Actions */}
      <div style={{
        display: 'flex',
        gap: '10px',
        marginBottom: '28px',
      }}>
        <button
          className="btn btn--primary"
          onClick={() => navigate('import')}
          style={{ fontSize: '13px', padding: '10px 18px', gap: '8px' }}
        >
          <Upload size={14} />
          Importar Conversa
        </button>
        <button
          className="btn btn--ghost"
          onClick={() => navigate('search')}
          style={{ fontSize: '13px', padding: '10px 18px', gap: '8px' }}
        >
          <Search size={14} />
          Buscar
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            opacity: 0.5,
            marginLeft: '4px',
          }}>⌘K</span>
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid-4" style={{ marginBottom: '28px' }}>
        {STATS.map((stat, i) => (
          <div
            key={stat.label}
            className="stat-card animate-fade-in-up"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="stat-card__label">{stat.label}</span>
              <stat.icon
                size={14}
                style={{ color: 'var(--text-muted)', opacity: 0.5 }}
              />
            </div>
            <div className="stat-card__value">{stat.value}</div>
            <div className="stat-card__sub">{stat.sub}</div>
          </div>
        ))}
      </div>

      {/* Features Row */}
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '10px',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'var(--text-muted)',
        marginBottom: '12px',
      }}>
        Capacidades
      </div>
      <div className="grid-3" style={{ marginBottom: '28px' }}>
        {FEATURES.map((feat, i) => (
          <div
            key={feat.title}
            className="result-card animate-fade-in-up"
            style={{ animationDelay: `${200 + i * 80}ms`, cursor: 'default' }}
          >
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: 'var(--radius-sm)',
              background: `${feat.color}12`,
              border: `1px solid ${feat.color}25`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '10px',
            }}>
              <feat.icon size={15} style={{ color: feat.color }} />
            </div>
            <div style={{
              fontSize: '13px',
              fontWeight: '600',
              color: 'var(--text-primary)',
              marginBottom: '4px',
              letterSpacing: '-0.01em',
            }}>
              {feat.title}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.6' }}>
              {feat.desc}
            </div>
          </div>
        ))}
      </div>

      {/* Getting Started CTA */}
      <div style={{
        background: 'var(--accent-emerald-subtle)',
        border: '1px solid rgba(0, 217, 126, 0.18)',
        borderRadius: 'var(--radius-md)',
        padding: '20px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        animation: 'fadeInUp 0.5s ease 0.4s forwards',
        opacity: 0,
      }}>
        <div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            color: 'var(--accent-emerald-dim)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: '4px',
          }}>
            Primeiros Passos
          </div>
          <div style={{
            fontSize: '14px',
            fontWeight: '600',
            color: 'var(--text-primary)',
            letterSpacing: '-0.01em',
            marginBottom: '4px',
          }}>
            Exporte uma conversa do WhatsApp e importe aqui
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            Configurações → Conversas → Mais opções → Exportar conversa → Sem mídia
          </div>
        </div>
        <button
          className="btn btn--primary"
          onClick={() => navigate('import')}
          style={{ flexShrink: 0, gap: '8px' }}
        >
          Começar
          <ArrowRight size={13} />
        </button>
      </div>
    </div>
  )
}
