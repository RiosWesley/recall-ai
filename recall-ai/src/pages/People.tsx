import { useState, useRef, useEffect, useCallback } from 'react'
import {
  X, Upload, Tag, MessageSquare, Clock, ChevronRight,
  Network, User, Edit3, Check, Plus
} from 'lucide-react'
import type { Page } from '../App'

interface PeoplePageProps {
  navigate: (page: Page) => void
}

// ─── Mock Data ────────────────────────────────────────────────────────────────
interface Person {
  id: string
  name: string
  initials: string
  color: string
  tags: string[]
  messageCount: number
  chats: string[]
  lastSeen: string
  bio: string
  keyMemories: string[]
  photoUrl?: string
}

interface Relation {
  a: string
  b: string
  strength: number // 0.0 – 1.0
}

const MOCK_PEOPLE: Person[] = [
  {
    id: 'p1',
    name: 'Maria Santos',
    initials: 'MS',
    color: '#00d97e',
    tags: ['família', 'próxima'],
    messageCount: 4821,
    chats: ['Maria — Família'],
    lastSeen: 'há 2h',
    bio: 'Irmã mais velha. Sempre tem uma receita nova para compartilhar.',
    keyMemories: [
      'Mandou a receita de bolo de cenoura em março de 2024',
      'Planejamento da viagem de família para o carnaval',
      'Indicou o médico especialista para a consulta',
    ],
  },
  {
    id: 'p2',
    name: 'João Silva',
    initials: 'JS',
    color: '#38bdf8',
    tags: ['amigo', 'trabalho'],
    messageCount: 892,
    chats: ['João Silva', 'Trabalho — Squad'],
    lastSeen: 'há 3d',
    bio: 'Amigo de longa data. Colega no projeto atual.',
    keyMemories: [
      'Confirmou a reunião de segunda-feira às 14h',
      'Enviou o link do repositório do projeto',
      'Lembrou do aniversário da empresa',
    ],
  },
  {
    id: 'p3',
    name: 'Ana Pereira',
    initials: 'AP',
    color: '#f0a500',
    tags: ['trabalho', 'squad'],
    messageCount: 3200,
    chats: ['Trabalho — Squad'],
    lastSeen: 'há 1d',
    bio: 'Tech lead do squad. Referência técnica do time.',
    keyMemories: [
      'Revisou o pull request da feature de autenticação',
      'Compartilhou artigo sobre arquitetura de microsserviços',
      'Organizou o planning da sprint 12',
    ],
  },
  {
    id: 'p4',
    name: 'Carlos Mendes',
    initials: 'CM',
    color: '#a78bfa',
    tags: ['trabalho'],
    messageCount: 1540,
    chats: ['Trabalho — Squad'],
    lastSeen: 'há 5d',
    bio: 'Designer do produto. Responsável pelo sistema de design.',
    keyMemories: [
      'Enviou os assets atualizados do Figma',
      'Propôs redesign do onboarding',
    ],
  },
  {
    id: 'p5',
    name: 'Beatriz Lima',
    initials: 'BL',
    color: '#f43f5e',
    tags: ['família'],
    messageCount: 2100,
    chats: ['Maria — Família'],
    lastSeen: 'há 1sem',
    bio: 'Prima. Mora em São Paulo.',
    keyMemories: [
      'Avisou sobre o churrasco do próximo fim de semana',
      'Pediu indicação de hotel em Florianópolis',
    ],
  },
  {
    id: 'p6',
    name: 'Rafael Costa',
    initials: 'RC',
    color: '#06b6d4',
    tags: ['amigo'],
    messageCount: 450,
    chats: ['João Silva'],
    lastSeen: 'há 2sem',
    bio: 'Amigo do João. Aparece eventualmente nas conversas.',
    keyMemories: [
      'Mencionado como organizador do churras do fim de ano',
    ],
  },
]

const MOCK_RELATIONS: Relation[] = [
  { a: 'p1', b: 'p5', strength: 0.85 },  // Maria — Beatriz (família)
  { a: 'p1', b: 'p2', strength: 0.45 },  // Maria — João
  { a: 'p2', b: 'p3', strength: 0.9 },   // João — Ana (squad)
  { a: 'p2', b: 'p4', strength: 0.75 },  // João — Carlos (squad)
  { a: 'p3', b: 'p4', strength: 0.8 },   // Ana — Carlos (squad)
  { a: 'p2', b: 'p6', strength: 0.5 },   // João — Rafael
  { a: 'p1', b: 'p3', strength: 0.3 },   // Maria — Ana (fraco)
]

// ─── Force-directed layout (simplified) ──────────────────────────────────────
interface NodePos { id: string; x: number; y: number; vx: number; vy: number }

function initPositions(people: Person[], width: number, height: number): NodePos[] {
  return people.map((p, i) => {
    const angle = (i / people.length) * Math.PI * 2
    const radius = Math.min(width, height) * 0.3
    return {
      id: p.id,
      x: width / 2 + Math.cos(angle) * radius,
      y: height / 2 + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    }
  })
}

function runForce(nodes: NodePos[], relations: Relation[], width: number, height: number): NodePos[] {
  const next = nodes.map(n => ({ ...n }))
  const k = 0.08

  // Repulsion between all nodes
  for (let i = 0; i < next.length; i++) {
    for (let j = i + 1; j < next.length; j++) {
      const dx = next[j].x - next[i].x
      const dy = next[j].y - next[i].y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const repulse = 6000 / (dist * dist)
      next[i].vx -= (dx / dist) * repulse
      next[i].vy -= (dy / dist) * repulse
      next[j].vx += (dx / dist) * repulse
      next[j].vy += (dy / dist) * repulse
    }
  }

  // Attraction along edges
  for (const rel of relations) {
    const ni = next.find(n => n.id === rel.a)
    const nj = next.find(n => n.id === rel.b)
    if (!ni || !nj) continue
    const dx = nj.x - ni.x
    const dy = nj.y - ni.y
    const dist = Math.sqrt(dx * dx + dy * dy) || 1
    const target = 160 + (1 - rel.strength) * 80
    const force = (dist - target) * k * rel.strength
    ni.vx += (dx / dist) * force
    ni.vy += (dy / dist) * force
    nj.vx -= (dx / dist) * force
    nj.vy -= (dy / dist) * force
  }

  // Center gravity
  for (const n of next) {
    n.vx += (width / 2 - n.x) * 0.01
    n.vy += (height / 2 - n.y) * 0.01
  }

  // Dampen & apply
  const dampen = 0.85
  for (const n of next) {
    n.vx *= dampen
    n.vy *= dampen
    n.x += n.vx
    n.y += n.vy
    // Clamp to canvas
    n.x = Math.max(60, Math.min(width - 60, n.x))
    n.y = Math.max(60, Math.min(height - 60, n.y))
  }

  return next
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function PeoplePage({ navigate: _navigate }: PeoplePageProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ w: 800, h: 600 })
  const [positions, setPositions] = useState<NodePos[]>([])
  const [settled, setSettled] = useState(false)
  const [selected, setSelected] = useState<Person | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [editingBio, setEditingBio] = useState(false)
  const [bioDraft, setBioDraft] = useState('')
  const [newTag, setNewTag] = useState('')
  const [addingTag, setAddingTag] = useState(false)

  // Measure container
  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        setDims({ w: rect.width, h: rect.height })
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // Init positions
  useEffect(() => {
    if (dims.w > 0) {
      setPositions(initPositions(MOCK_PEOPLE, dims.w, dims.h))
      setSettled(false)
    }
  }, [dims])

  // Simulate force layout
  useEffect(() => {
    if (settled || positions.length === 0) return
    let frame = 0
    const maxFrames = 120
    let current = positions
    const tick = () => {
      current = runForce(current, MOCK_RELATIONS, dims.w, dims.h)
      setPositions([...current])
      frame++
      if (frame < maxFrames) {
        requestAnimationFrame(tick)
      } else {
        setSettled(true)
      }
    }
    requestAnimationFrame(tick)
  }, [settled, positions.length]) // eslint-disable-line

  const getPos = useCallback((id: string) =>
    positions.find(p => p.id === id) ?? { x: 0, y: 0 }, [positions])

  const getPerson = (id: string) => MOCK_PEOPLE.find(p => p.id === id)

  const nodeRadius = (p: Person) => {
    const base = 22
    const extra = Math.min(p.messageCount / 500, 14)
    return base + extra
  }

  return (
    <div className="page" style={{ padding: 0, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '18px 28px 14px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        flexShrink: 0,
        background: 'var(--bg-surface)',
      }}>
        <Network size={16} style={{ color: 'var(--accent-emerald)' }} />
        <div>
          <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
            Pessoas
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', marginTop: '1px' }}>
            {MOCK_PEOPLE.length} pessoas · {MOCK_RELATIONS.length} conexões · dados simulados
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* Legend */}
          {[
            { label: 'família', color: '#00d97e' },
            { label: 'trabalho', color: '#38bdf8' },
            { label: 'amigo', color: '#f0a500' },
          ].map(l => (
            <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: l.color, opacity: 0.8 }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)' }}>{l.label}</span>
            </div>
          ))}
          <div style={{ width: 1, height: 16, background: 'var(--border-subtle)', margin: '0 4px' }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-disabled)' }}>
            clique para explorar
          </span>
        </div>
      </div>

      {/* Graph + Panel */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        {/* SVG Graph */}
        <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <svg
            ref={svgRef}
            width={dims.w}
            height={dims.h}
            style={{ display: 'block' }}
          >
            <defs>
              {/* Radial gradient for glow */}
              {MOCK_PEOPLE.map(p => (
                <radialGradient key={`glow-${p.id}`} id={`glow-${p.id}`} cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor={p.color} stopOpacity="0.25" />
                  <stop offset="100%" stopColor={p.color} stopOpacity="0" />
                </radialGradient>
              ))}
              {/* Edge gradient */}
              {MOCK_RELATIONS.map((rel, i) => {
                const pa = getPerson(rel.a)
                const pb = getPerson(rel.b)
                if (!pa || !pb) return null
                return (
                  <linearGradient key={`edge-${i}`} id={`edge-${i}`} gradientUnits="userSpaceOnUse"
                    x1={getPos(rel.a).x} y1={getPos(rel.a).y}
                    x2={getPos(rel.b).x} y2={getPos(rel.b).y}
                  >
                    <stop offset="0%" stopColor={pa.color} stopOpacity={rel.strength * 0.6} />
                    <stop offset="100%" stopColor={pb.color} stopOpacity={rel.strength * 0.6} />
                  </linearGradient>
                )
              })}
            </defs>

            {/* Background grid dots */}
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <circle cx="20" cy="20" r="0.8" fill="var(--border-subtle)" opacity="0.6" />
            </pattern>
            <rect width={dims.w} height={dims.h} fill="url(#grid)" />

            {/* Edges */}
            {MOCK_RELATIONS.map((rel, i) => {
              const pa = getPos(rel.a)
              const pb = getPos(rel.b)
              const isHighlighted = hovered === rel.a || hovered === rel.b ||
                selected?.id === rel.a || selected?.id === rel.b
              return (
                <line
                  key={`edge-${i}`}
                  x1={pa.x} y1={pa.y}
                  x2={pb.x} y2={pb.y}
                  stroke={`url(#edge-${i})`}
                  strokeWidth={isHighlighted ? rel.strength * 2.5 : rel.strength * 1.5}
                  opacity={isHighlighted ? 0.9 : 0.35}
                  strokeLinecap="round"
                  style={{ transition: 'opacity 0.3s, stroke-width 0.3s' }}
                />
              )
            })}

            {/* Nodes */}
            {MOCK_PEOPLE.map(person => {
              const pos = getPos(person.id)
              if (!pos.x && !pos.y) return null
              const r = nodeRadius(person)
              const isSelected = selected?.id === person.id
              const isHovered = hovered === person.id
              const isActive = isSelected || isHovered
              const glowR = r * 2.5

              return (
                <g
                  key={person.id}
                  transform={`translate(${pos.x},${pos.y})`}
                  onClick={() => setSelected(isSelected ? null : person)}
                  onMouseEnter={() => setHovered(person.id)}
                  onMouseLeave={() => setHovered(null)}
                  style={{ cursor: 'pointer' }}
                >
                  {/* Glow halo */}
                  <circle
                    r={glowR}
                    fill={`url(#glow-${person.id})`}
                    opacity={isActive ? 1 : 0.4}
                    style={{ transition: 'opacity 0.3s, r 0.3s' }}
                  />

                  {/* Outer ring (selected) */}
                  {isActive && (
                    <circle
                      r={r + 5}
                      fill="none"
                      stroke={person.color}
                      strokeWidth={1.5}
                      opacity={0.5}
                      strokeDasharray="4 3"
                    >
                      <animateTransform
                        attributeName="transform"
                        type="rotate"
                        from="0" to="360"
                        dur="8s"
                        repeatCount="indefinite"
                      />
                    </circle>
                  )}

                  {/* Node circle */}
                  <circle
                    r={isActive ? r + 3 : r}
                    fill="var(--bg-elevated)"
                    stroke={person.color}
                    strokeWidth={isActive ? 2 : 1.5}
                    opacity={1}
                    style={{ transition: 'r 0.25s, stroke-width 0.25s' }}
                  />

                  {/* Initials */}
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={r > 30 ? 12 : 10}
                    fontWeight="600"
                    fill={person.color}
                    fontFamily="var(--font-mono)"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {person.initials}
                  </text>

                  {/* Name label */}
                  <text
                    y={r + 14}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={isActive ? '600' : '400'}
                    fill={isActive ? 'var(--text-primary)' : 'var(--text-secondary)'}
                    fontFamily="var(--font-sans)"
                    style={{ pointerEvents: 'none', userSelect: 'none', transition: 'fill 0.2s' }}
                  >
                    {person.name.split(' ')[0]}
                  </text>

                  {/* Message count pill on hover */}
                  {isHovered && !isSelected && (
                    <g transform={`translate(0, ${-(r + 14)})`}>
                      <rect
                        x={-32} y={-10} width={64} height={18}
                        rx={9}
                        fill="var(--bg-overlay)"
                        stroke={person.color}
                        strokeWidth={1}
                        opacity={0.95}
                      />
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={9}
                        fill="var(--text-secondary)"
                        fontFamily="var(--font-mono)"
                        style={{ pointerEvents: 'none' }}
                      >
                        {person.messageCount.toLocaleString('pt-BR')} msgs
                      </text>
                    </g>
                  )}
                </g>
              )
            })}
          </svg>

          {/* Empty state overlay */}
          {positions.length === 0 && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexDirection: 'column', gap: '12px',
            }}>
              <Network size={32} style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
              <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                Nenhuma pessoa identificada ainda.
              </div>
            </div>
          )}
        </div>

        {/* Person Detail Panel */}
        {selected && (
          <PersonPanel
            person={selected}
            onClose={() => setSelected(null)}
            editingBio={editingBio}
            bioDraft={bioDraft}
            setBioDraft={setBioDraft}
            setEditingBio={setEditingBio}
            newTag={newTag}
            setNewTag={setNewTag}
            addingTag={addingTag}
            setAddingTag={setAddingTag}
          />
        )}
      </div>
    </div>
  )
}

// ─── Person Detail Panel ──────────────────────────────────────────────────────
interface PanelProps {
  person: Person
  onClose: () => void
  editingBio: boolean
  bioDraft: string
  setBioDraft: (v: string) => void
  setEditingBio: (v: boolean) => void
  newTag: string
  setNewTag: (v: string) => void
  addingTag: boolean
  setAddingTag: (v: boolean) => void
}

function PersonPanel({
  person, onClose,
  editingBio, bioDraft, setBioDraft, setEditingBio,
  newTag, setNewTag, addingTag, setAddingTag,
}: PanelProps) {
  return (
    <div
      className="person-panel animate-slide-in"
      style={{
        width: '300px',
        flexShrink: 0,
        borderLeft: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface)',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      }}
    >
      {/* Panel Header */}
      <div style={{
        padding: '16px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
      }}>
        {/* Avatar */}
        <div style={{
          width: '52px', height: '52px', flexShrink: 0,
          borderRadius: '12px',
          background: `${person.color}18`,
          border: `1.5px solid ${person.color}40`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden',
          cursor: 'pointer',
        }}
          title="Clique para adicionar foto"
        >
          {person.photoUrl ? (
            <img src={person.photoUrl} alt={person.name}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: '16px',
              fontWeight: '700', color: person.color,
            }}>{person.initials}</span>
          )}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: 0,
            transition: 'opacity 0.2s',
          }}
            className="avatar-upload-overlay"
          >
            <Upload size={14} color="white" />
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: '14px', fontWeight: '600',
            color: 'var(--text-primary)', letterSpacing: '-0.01em',
          }}>
            {person.name}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '4px' }}>
            <Clock size={10} style={{ color: 'var(--text-muted)' }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)' }}>
              visto {person.lastSeen}
            </span>
          </div>
        </div>

        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', padding: '2px',
            borderRadius: '4px',
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Stats Row */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        gap: '1px', borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--border-subtle)',
      }}>
        {[
          { label: 'Mensagens', value: person.messageCount.toLocaleString('pt-BR') },
          { label: 'Chats', value: person.chats.length.toString() },
        ].map(s => (
          <div key={s.label} style={{
            padding: '10px 14px',
            background: 'var(--bg-surface)',
            display: 'flex', flexDirection: 'column', gap: '2px',
          }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {s.label}
            </div>
            <div style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Tags */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: '9px',
          color: 'var(--text-muted)', textTransform: 'uppercase',
          letterSpacing: '0.08em', marginBottom: '8px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span><Tag size={9} style={{ display: 'inline', marginRight: '4px' }} /> Tags</span>
          <button
            onClick={() => setAddingTag(!addingTag)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
          >
            <Plus size={12} />
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
          {person.tags.map(tag => (
            <span key={tag} style={{
              fontFamily: 'var(--font-mono)', fontSize: '10px',
              background: 'var(--bg-overlay)',
              border: '1px solid var(--border-default)',
              color: 'var(--text-secondary)',
              padding: '2px 8px', borderRadius: '3px',
            }}>
              {tag}
            </span>
          ))}
          {addingTag && (
            <input
              autoFocus
              value={newTag}
              onChange={e => setNewTag(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { setAddingTag(false); setNewTag('') } }}
              placeholder="nova tag..."
              style={{
                fontFamily: 'var(--font-mono)', fontSize: '10px',
                background: 'var(--bg-overlay)', border: '1px solid var(--accent-emerald)',
                color: 'var(--text-primary)', padding: '2px 8px',
                borderRadius: '3px', outline: 'none', width: '80px',
              }}
            />
          )}
        </div>
      </div>

      {/* Bio */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: '9px',
          color: 'var(--text-muted)', textTransform: 'uppercase',
          letterSpacing: '0.08em', marginBottom: '8px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span><User size={9} style={{ display: 'inline', marginRight: '4px' }} /> Sobre</span>
          {editingBio ? (
            <button
              onClick={() => setEditingBio(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-emerald)' }}
            >
              <Check size={12} />
            </button>
          ) : (
            <button
              onClick={() => { setEditingBio(true); setBioDraft(person.bio) }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
            >
              <Edit3 size={11} />
            </button>
          )}
        </div>
        {editingBio ? (
          <textarea
            autoFocus
            value={bioDraft}
            onChange={e => setBioDraft(e.target.value)}
            rows={3}
            style={{
              width: '100%', fontFamily: 'var(--font-sans)', fontSize: '12px',
              background: 'var(--bg-overlay)', border: '1px solid var(--border-focus)',
              color: 'var(--text-primary)', padding: '8px', borderRadius: '4px',
              outline: 'none', resize: 'vertical', lineHeight: '1.6',
            }}
          />
        ) : (
          <div style={{
            fontSize: '12px', color: 'var(--text-secondary)',
            lineHeight: '1.7', userSelect: 'text',
          }}>
            {person.bio || <em style={{ color: 'var(--text-muted)' }}>Sem descrição. Clique no lápis para adicionar.</em>}
          </div>
        )}
      </div>

      {/* Key Memories */}
      <div style={{ padding: '14px 16px', flex: 1 }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: '9px',
          color: 'var(--text-muted)', textTransform: 'uppercase',
          letterSpacing: '0.08em', marginBottom: '8px',
        }}>
          <MessageSquare size={9} style={{ display: 'inline', marginRight: '4px' }} />
          Memórias-chave
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {person.keyMemories.map((mem, i) => (
            <div key={i} style={{
              padding: '8px 10px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '11px',
              color: 'var(--text-secondary)',
              lineHeight: '1.6',
              display: 'flex', gap: '8px', alignItems: 'flex-start',
              cursor: 'pointer',
              transition: 'border-color 0.15s, background 0.15s',
            }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLDivElement).style.borderColor = `${person.color}40`
                ;(e.currentTarget as HTMLDivElement).style.background = `${person.color}08`
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-subtle)'
                ;(e.currentTarget as HTMLDivElement).style.background = 'var(--bg-elevated)'
              }}
            >
              <ChevronRight size={10} style={{ color: person.color, flexShrink: 0, marginTop: '2px' }} />
              <span style={{ userSelect: 'text' }}>{mem}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Chats list */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-subtle)' }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: '9px',
          color: 'var(--text-muted)', textTransform: 'uppercase',
          letterSpacing: '0.08em', marginBottom: '8px',
        }}>
          Fontes de memória
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {person.chats.map(chat => (
            <div key={chat} style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '5px 8px',
              background: 'var(--bg-elevated)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '11px', color: 'var(--text-secondary)',
            }}>
              <MessageSquare size={10} style={{ color: 'var(--text-muted)' }} />
              {chat}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
