import { useState, useCallback, useRef } from 'react'
import {
  Upload, FileText, CheckCircle2, RefreshCw,
  UserPlus, Users, ChevronRight, Check, Edit3,
  Search, Merge, AlertCircle, X
} from 'lucide-react'
import type { Page } from '../App'

interface ImportPageProps {
  navigate: (page: Page) => void
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ImportStage =
  | 'idle'
  | 'reading'
  | 'parsing'
  | 'dedup'       // NEW: person deduplication review
  | 'chunking'
  | 'embedding'
  | 'storing'
  | 'done'
  | 'error'

interface DetectedSender {
  rawName: string          // Nome do WhatsApp (pode ser apelido)
  messageCount: number     // Qtd de msgs nessa conversa
  resolution:
    | { type: 'new'; canonicalName: string }          // Criar como nova pessoa
    | { type: 'merge'; existingId: string }           // Vincular a existente
    | null                                             // Ainda não decidido
}

interface ExistingPerson {
  id: string
  name: string
  initials: string
  color: string
  chats: string[]
  messageCount: number
}

// ─── Mock data: pessoas já no grafo ──────────────────────────────────────────
const GRAPH_PEOPLE: ExistingPerson[] = [
  { id: 'p1', name: 'Maria Santos',  initials: 'MS', color: '#00d97e', chats: ['Maria — Família'], messageCount: 4821 },
  { id: 'p2', name: 'João Silva',    initials: 'JS', color: '#38bdf8', chats: ['João Silva'], messageCount: 892 },
  { id: 'p3', name: 'Ana Pereira',   initials: 'AP', color: '#f0a500', chats: ['Trabalho — Squad'], messageCount: 3200 },
  { id: 'p4', name: 'Carlos Mendes', initials: 'CM', color: '#a78bfa', chats: ['Trabalho — Squad'], messageCount: 1540 },
  { id: 'p5', name: 'Beatriz Lima',  initials: 'BL', color: '#f43f5e', chats: ['Maria — Família'], messageCount: 2100 },
]

// ─── Pipeline stages ──────────────────────────────────────────────────────────
const PRE_DEDUP_STAGES = [
  { id: 'reading' as const, label: 'Lendo arquivo',       description: 'Abrindo e validando o arquivo exportado' },
  { id: 'parsing' as const, label: 'Parseando mensagens', description: 'Extraindo mensagens do formato WhatsApp' },
]

const POST_DEDUP_STAGES = [
  { id: 'chunking'  as const, label: 'Segmentando chunks',  description: 'Agrupando mensagens por janela de tempo' },
  { id: 'embedding' as const, label: 'Gerando embeddings',  description: 'Vetorizando semanticamente' },
  { id: 'storing'   as const, label: 'Salvando no banco',   description: 'Persistindo vetores e pessoas no SQLite' },
]

const ALL_STAGES = [...PRE_DEDUP_STAGES, ...POST_DEDUP_STAGES]
const STAGE_ORDER: ImportStage[] = ['reading', 'parsing', 'dedup', 'chunking', 'embedding', 'storing', 'done']

// ─── Helpers ──────────────────────────────────────────────────────────────────
function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
  return dp[m][n]
}

/** Sugere pessoas existentes ordenadas por similaridade de nome */
function suggestMatches(rawName: string, people: ExistingPerson[]): ExistingPerson[] {
  // Remove emojis and special chars for comparison
  const clean = rawName.replace(/[^\w\s]/gu, '').trim().toLowerCase()
  if (!clean) return []

  return [...people]
    .map(p => {
      const fullName = p.name.toLowerCase()
      const firstName = fullName.split(' ')[0]
      // Compare against full name and first name separately, take best score
      const scoreA = levenshtein(clean, fullName)
      const scoreB = levenshtein(clean, firstName)
      // Also check if clean is a prefix of the full name or first name
      const isPrefixFull = fullName.startsWith(clean) || clean.startsWith(firstName.slice(0, 3))
      const isPrefixFirst = firstName.startsWith(clean.slice(0, 3))
      const bonus = (isPrefixFull || isPrefixFirst) ? -3 : 0
      return { p, score: Math.min(scoreA, scoreB) + bonus }
    })
    .filter(x => x.score <= 6)
    .sort((a, b) => a.score - b.score)
    .map(x => x.p)
}


function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ImportPage({ navigate }: ImportPageProps) {
  const [dragActive, setDragActive]     = useState(false)
  const [stage, setStage]               = useState<ImportStage>('idle')
  const [fileName, setFileName]         = useState<string | null>(null)
  const [progress, setProgress]         = useState(0)
  const [messageCount, setMessageCount] = useState(0)

  // Dedup state
  const [senders, setSenders]           = useState<DetectedSender[]>([])
  const [currentIdx, setCurrentIdx]     = useState(0)
  const [newPersonCount, setNewPersonCount] = useState(0)
  const [mergedCount, setMergedCount]   = useState(0)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(false)
    const file = e.dataTransfer.files[0]
    if (file) startImport(file)
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) startImport(file)
  }

  const startImport = async (file: File) => {
    setFileName(file.name)
    setProgress(0)

    // Phase 1: reading + parsing
    for (let i = 0; i < PRE_DEDUP_STAGES.length; i++) {
      setStage(PRE_DEDUP_STAGES[i].id)
      await sleep([500, 800][i])
      setProgress(Math.round(((i + 1) / (ALL_STAGES.length + 1)) * 100))
    }

    // Simulate detected senders after parsing
    const detected: DetectedSender[] = [
      { rawName: 'Mah ❤️',       messageCount: 312, resolution: null },
      { rawName: 'Rafa',          messageCount: 89,  resolution: null },
      { rawName: 'Carlos',        messageCount: 204, resolution: null },
      { rawName: 'Você',          messageCount: 1450, resolution: null },
    ]
    setSenders(detected)
    setCurrentIdx(0)
    setStage('dedup')
  }

  const handleResolutionComplete = async (finalSenders: DetectedSender[]) => {
    const newCount = finalSenders.filter(s => s.resolution?.type === 'new').length
    const mergedCnt = finalSenders.filter(s => s.resolution?.type === 'merge').length
    setNewPersonCount(newCount)
    setMergedCount(mergedCnt)

    // Phase 2: post-dedup pipeline
    const base = PRE_DEDUP_STAGES.length
    for (let i = 0; i < POST_DEDUP_STAGES.length; i++) {
      setStage(POST_DEDUP_STAGES[i].id)
      await sleep([600, 2000, 500][i])
      setProgress(Math.round(((base + i + 2) / (ALL_STAGES.length + 1)) * 100))
    }
    setMessageCount(4821)
    setStage('done')
  }

  const reset = () => {
    setStage('idle')
    setFileName(null)
    setProgress(0)
    setMessageCount(0)
    setSenders([])
    setCurrentIdx(0)
  }

  const stageIndex = STAGE_ORDER.indexOf(stage)

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="page">
      <div className="page-header">
        <div className="page-header__eyebrow">Ingestão de Memória</div>
        <h1 className="page-header__title">Importar Conversa</h1>
        <p className="page-header__desc">
          Arraste um export do WhatsApp (.txt ou .zip) para adicionar à sua memória.
        </p>
      </div>

      {stage === 'idle' && <IdleView dragActive={dragActive} setDragActive={setDragActive} onDrop={handleDrop} onFileSelect={handleFileSelect} />}

      {stage === 'dedup' && (
        <DedupView
          senders={senders}
          currentIdx={currentIdx}
          setCurrentIdx={setCurrentIdx}
          setSenders={setSenders}
          onComplete={handleResolutionComplete}
          fileName={fileName!}
        />
      )}

      {stage === 'done' && (
        <DoneView
          fileName={fileName!}
          messageCount={messageCount}
          newPersonCount={newPersonCount}
          mergedCount={mergedCount}
          navigate={navigate}
          reset={reset}
        />
      )}

      {stage !== 'idle' && stage !== 'dedup' && stage !== 'done' && (
        <ProgressView
          stage={stage}
          stageIndex={stageIndex}
          progress={progress}
          fileName={fileName!}
        />
      )}
    </div>
  )
}

// ─── Idle View ────────────────────────────────────────────────────────────────
function IdleView({
  dragActive, setDragActive, onDrop, onFileSelect,
}: {
  dragActive: boolean
  setDragActive: (v: boolean) => void
  onDrop: (e: React.DragEvent) => void
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <>
      <div
        className={`dropzone ${dragActive ? 'dropzone--active' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragActive(true) }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        onClick={() => document.getElementById('file-input')?.click()}
        style={{ marginBottom: '24px' }}
      >
        <input id="file-input" type="file" accept=".txt,.zip" style={{ display: 'none' }} onChange={onFileSelect} />
        <Upload className="dropzone__icon" />
        <div className="dropzone__title">
          {dragActive ? 'Solte aqui para importar' : 'Arraste seu export do WhatsApp'}
        </div>
        <div className="dropzone__subtitle">ou clique para selecionar o arquivo</div>
        <div className="dropzone__formats">.txt · .zip</div>
      </div>

      <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: '20px' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '12px' }}>
          Como exportar do WhatsApp
        </div>
        <div className="stack-sm">
          {['Abra a conversa no WhatsApp', 'Toque nos 3 pontos → Mais → Exportar conversa', 'Selecione "Sem mídia" (recomendado)', 'Salve o arquivo .txt ou .zip', 'Importe aqui acima'].map((step, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--accent-emerald)', background: 'var(--accent-emerald-subtle)', border: '1px solid rgba(0,217,126,0.15)', width: '20px', height: '20px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {i + 1}
              </span>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)', paddingTop: '2px' }}>{step}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

// ─── Person Deduplication View ────────────────────────────────────────────────
function DedupView({
  senders, currentIdx, setCurrentIdx, setSenders, onComplete, fileName,
}: {
  senders: DetectedSender[]
  currentIdx: number
  setCurrentIdx: (n: number) => void
  setSenders: React.Dispatch<React.SetStateAction<DetectedSender[]>>
  onComplete: (final: DetectedSender[]) => void
  fileName: string
}) {
  const current = senders[currentIdx]
  const [searchQuery, setSearchQuery] = useState('')
  const [editingName, setEditingName] = useState(current?.rawName ?? '')
  const [showSearch, setShowSearch] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  // Reset local state when sender changes
  const handleSenderChange = (idx: number) => {
    setCurrentIdx(idx)
    setEditingName(senders[idx]?.rawName ?? '')
    setSearchQuery('')
    setShowSearch(false)
  }

  const suggestions = suggestMatches(current?.rawName ?? '', GRAPH_PEOPLE)
  const filteredPeople = searchQuery.trim()
    ? GRAPH_PEOPLE.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : GRAPH_PEOPLE

  const resolveAs = (resolution: DetectedSender['resolution']) => {
    setSenders(prev => prev.map((s, i) => i === currentIdx ? { ...s, resolution } : s))
  }

  const resolveAsNew = () => {
    resolveAs({ type: 'new', canonicalName: editingName.trim() || current.rawName })
  }

  const resolveAsMerge = (personId: string) => {
    resolveAs({ type: 'merge', existingId: personId })
  }

  const handleNext = () => {
    if (currentIdx < senders.length - 1) {
      handleSenderChange(currentIdx + 1)
    } else {
      onComplete(senders)
    }
  }

  const allResolved = senders.every(s => s.resolution !== null)
  const resolvedCount = senders.filter(s => s.resolution !== null).length

  // Skip "Você" automatically on first render — mark as 'new' silently
  if (current?.rawName === 'Você' && current.resolution === null) {
    setSenders(prev => prev.map((s, i) => i === currentIdx
      ? { ...s, resolution: { type: 'new', canonicalName: 'Você' } }
      : s
    ))
  }

  if (!current) return null

  // Skip auto-resolved
  const shouldSkip = current.resolution !== null && current.rawName === 'Você'

  return (
    <div style={{ animation: 'fadeInUp 0.3s ease' }}>
      {/* Header card */}
      <div style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        padding: '16px 20px',
        marginBottom: '16px',
        display: 'flex', alignItems: 'center', gap: '12px',
      }}>
        <AlertCircle size={15} style={{ color: 'var(--accent-amber)', flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '2px' }}>
            Identificando pessoas em <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-emerald)' }}>{fileName}</span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Revise cada remetente para evitar duplicatas no seu grafo de pessoas.
          </div>
        </div>
        {/* Progress pills */}
        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
          {senders.map((s, i) => (
            <button
              key={i}
              onClick={() => handleSenderChange(i)}
              title={s.rawName}
              style={{
                width: '28px', height: '6px',
                borderRadius: '3px',
                border: 'none',
                cursor: 'pointer',
                background: s.resolution !== null
                  ? 'var(--accent-emerald)'
                  : i === currentIdx
                    ? 'var(--accent-amber)'
                    : 'var(--border-default)',
                transition: 'background 0.2s',
              }}
            />
          ))}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)', flexShrink: 0 }}>
          {resolvedCount}/{senders.length}
        </div>
      </div>

      {/* Sender card */}
      <div style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        marginBottom: '12px',
      }}>
        {/* Sender avatar + raw name */}
        <div style={{
          padding: '20px 24px',
          background: 'var(--bg-overlay)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', alignItems: 'center', gap: '14px',
        }}>
          <div style={{
            width: '44px', height: '44px',
            borderRadius: '10px',
            background: 'rgba(240,165,0,0.12)',
            border: '1.5px solid rgba(240,165,0,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: '700', color: 'var(--accent-amber)' }}>
              {initials(current.rawName.replace(/[^a-zA-Z\s]/g, '').trim() || 'XX')}
            </span>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>
              Nome detectado no WhatsApp
            </div>
            <div style={{ fontSize: '18px', fontWeight: '700', color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              {current.rawName}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)' }}>mensagens</div>
            <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              {current.messageCount}
            </div>
          </div>
        </div>

        {/* Resolution options */}
        <div style={{ padding: '20px 24px' }}>

          {/* Option A: Link to existing */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: '10px',
              textTransform: 'uppercase', letterSpacing: '0.08em',
              color: 'var(--text-muted)', marginBottom: '10px',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}>
              <Merge size={10} />
              Vincular a pessoa existente no grafo
            </div>

            {/* Suggestions (top matches by similarity) */}
            {suggestions.length > 0 && (
              <div style={{ marginBottom: '8px' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '6px', fontFamily: 'var(--font-mono)' }}>
                  Sugestões por similaridade:
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  {suggestions.slice(0, 3).map(p => (
                    <PersonMatchCard
                      key={p.id}
                      person={p}
                      selected={current.resolution?.type === 'merge' && current.resolution.existingId === p.id}
                      onSelect={() => resolveAsMerge(p.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Search all people */}
            {!showSearch ? (
              <button
                onClick={() => { setShowSearch(true); setTimeout(() => searchRef.current?.focus(), 50) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  background: 'none', border: '1px dashed var(--border-default)',
                  borderRadius: 'var(--radius-sm)', padding: '6px 12px',
                  cursor: 'pointer', color: 'var(--text-muted)',
                  fontSize: '11px', fontFamily: 'var(--font-mono)',
                  width: '100%', justifyContent: 'center',
                  transition: 'border-color 0.15s, color 0.15s',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent-emerald)'
                  ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--accent-emerald)'
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-default)'
                  ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'
                }}
              >
                <Search size={11} />
                Buscar outra pessoa...
              </button>
            ) : (
              <div>
                <div style={{ position: 'relative', marginBottom: '6px' }}>
                  <Search size={12} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    ref={searchRef}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Buscar no grafo..."
                    style={{
                      width: '100%',
                      background: 'var(--bg-overlay)', border: '1px solid var(--border-focus)',
                      borderRadius: 'var(--radius-sm)', padding: '7px 10px 7px 30px',
                      fontFamily: 'var(--font-sans)', fontSize: '12px',
                      color: 'var(--text-primary)', outline: 'none',
                    }}
                  />
                  <button onClick={() => setShowSearch(false)} style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                    <X size={12} />
                  </button>
                </div>
                <div style={{ maxHeight: '160px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {filteredPeople.length === 0 ? (
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center', padding: '12px' }}>
                      Nenhuma pessoa encontrada
                    </div>
                  ) : filteredPeople.map(p => (
                    <PersonMatchCard
                      key={p.id}
                      person={p}
                      selected={current.resolution?.type === 'merge' && current.resolution.existingId === p.id}
                      onSelect={() => { resolveAsMerge(p.id); setShowSearch(false) }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <div style={{ flex: 1, height: '1px', background: 'var(--border-subtle)' }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)' }}>ou</span>
            <div style={{ flex: 1, height: '1px', background: 'var(--border-subtle)' }} />
          </div>

          {/* Option B: Create new */}
          <div>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: '10px',
              textTransform: 'uppercase', letterSpacing: '0.08em',
              color: 'var(--text-muted)', marginBottom: '10px',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}>
              <UserPlus size={10} />
              Criar como nova pessoa
            </div>

            <div style={{
              background: current.resolution?.type === 'new' ? 'var(--accent-emerald-subtle)' : 'var(--bg-overlay)',
              border: `1px solid ${current.resolution?.type === 'new' ? 'rgba(0,217,126,0.25)' : 'var(--border-subtle)'}`,
              borderRadius: 'var(--radius-sm)', padding: '12px 14px',
              display: 'flex', alignItems: 'center', gap: '10px',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
              onClick={resolveAsNew}
            >
              <div style={{
                width: '32px', height: '32px',
                borderRadius: '7px',
                background: 'rgba(0,217,126,0.12)',
                border: '1px solid rgba(0,217,126,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <UserPlus size={14} style={{ color: 'var(--accent-emerald)' }} />
              </div>

              {/* Editable name */}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginBottom: '4px' }}>
                  Nome canônico (editável):
                </div>
                <input
                  value={editingName}
                  onChange={e => {
                    setEditingName(e.target.value)
                    // Auto-select "new" when typing
                    setSenders(prev => prev.map((s, i) =>
                      i === currentIdx
                        ? { ...s, resolution: { type: 'new', canonicalName: e.target.value } }
                        : s
                    ))
                  }}
                  onClick={e => {
                    e.stopPropagation()
                    resolveAsNew()
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    borderBottom: `1px solid ${current.resolution?.type === 'new' ? 'var(--accent-emerald)' : 'var(--border-default)'}`,
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-sans)',
                    fontSize: '14px',
                    fontWeight: '600',
                    letterSpacing: '-0.01em',
                    padding: '2px 0',
                    outline: 'none',
                    width: '100%',
                    transition: 'border-color 0.2s',
                    userSelect: 'text',
                  }}
                  placeholder={current.rawName}
                />
              </div>

              <div style={{
                width: '20px', height: '20px',
                borderRadius: '50%',
                background: current.resolution?.type === 'new' ? 'var(--accent-emerald)' : 'var(--border-default)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, transition: 'background 0.2s',
              }}>
                {current.resolution?.type === 'new' && <Check size={11} color="#000" />}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {/* Skip button (back) */}
        <button
          className="btn btn--ghost"
          style={{ fontSize: '12px', gap: '6px', opacity: currentIdx === 0 ? 0.3 : 1 }}
          disabled={currentIdx === 0}
          onClick={() => handleSenderChange(currentIdx - 1)}
        >
          ← Anterior
        </button>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* Skip without resolving */}
          {current.resolution === null && (
            <button
              className="btn btn--ghost"
              style={{ fontSize: '12px' }}
              onClick={() => {
                resolveAs({ type: 'new', canonicalName: current.rawName })
                setTimeout(handleNext, 50)
              }}
            >
              Pular (manter nome)
            </button>
          )}

          {/* Next / Finish */}
          <button
            className="btn btn--primary"
            style={{ gap: '8px', fontSize: '13px' }}
            disabled={current.resolution === null}
            onClick={handleNext}
          >
            {currentIdx === senders.length - 1 ? (
              <>
                <Check size={13} />
                {allResolved ? 'Continuar importação' : 'Finalizar revisão'}
              </>
            ) : (
              <>
                Próxima pessoa
                <ChevronRight size={13} />
              </>
            )}
          </button>
        </div>
      </div>

      {/* People overview strip */}
      <div style={{ marginTop: '16px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {senders.map((s, i) => {
          const res = s.resolution
          const merged = res?.type === 'merge' ? GRAPH_PEOPLE.find(p => p.id === res.existingId) : null
          return (
            <button
              key={i}
              onClick={() => handleSenderChange(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '4px 10px 4px 6px',
                background: res !== null ? 'var(--accent-emerald-subtle)' : i === currentIdx ? 'var(--bg-hover)' : 'var(--bg-elevated)',
                border: `1px solid ${res !== null ? 'rgba(0,217,126,0.2)' : i === currentIdx ? 'var(--border-strong)' : 'var(--border-subtle)'}`,
                borderRadius: '20px',
                cursor: 'pointer',
                fontSize: '11px',
                color: res !== null ? 'var(--accent-emerald)' : 'var(--text-secondary)',
                transition: 'all 0.15s',
              }}
            >
              {res !== null
                ? <Check size={10} style={{ color: 'var(--accent-emerald)' }} />
                : i === currentIdx
                  ? <Edit3 size={10} style={{ color: 'var(--accent-amber)' }} />
                  : <Users size={10} />
              }
              <span>
                {res?.type === 'merge' && merged ? `${s.rawName} → ${merged.name}` : 
                 res?.type === 'new' ? (res.canonicalName || s.rawName) :
                 s.rawName}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Person Match Card ────────────────────────────────────────────────────────
function PersonMatchCard({
  person, selected, onSelect,
}: {
  person: ExistingPerson
  selected: boolean
  onSelect: () => void
}) {
  return (
    <div
      onClick={onSelect}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '8px 12px',
        background: selected ? `${person.color}12` : 'var(--bg-overlay)',
        border: `1px solid ${selected ? `${person.color}40` : 'var(--border-subtle)'}`,
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => {
        if (!selected) {
          (e.currentTarget as HTMLDivElement).style.background = `${person.color}08`
          ;(e.currentTarget as HTMLDivElement).style.borderColor = `${person.color}25`
        }
      }}
      onMouseLeave={e => {
        if (!selected) {
          (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-overlay)'
          ;(e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-subtle)'
        }
      }}
    >
      {/* Mini avatar */}
      <div style={{
        width: '28px', height: '28px',
        borderRadius: '6px',
        background: `${person.color}18`,
        border: `1px solid ${person.color}35`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: '700', color: person.color }}>
          {person.initials}
        </span>
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '1px' }}>
          {person.name}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-muted)', display: 'flex', gap: '6px' }}>
          <span>{person.messageCount.toLocaleString('pt-BR')} msgs</span>
          <span>·</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {person.chats.join(', ')}
          </span>
        </div>
      </div>

      {/* Selection indicator */}
      <div style={{
        width: '18px', height: '18px',
        borderRadius: '50%',
        background: selected ? person.color : 'var(--border-default)',
        border: `1.5px solid ${selected ? person.color : 'var(--border-strong)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, transition: 'all 0.15s',
      }}>
        {selected && <Check size={10} color="#000" />}
      </div>
    </div>
  )
}

// ─── Progress View ────────────────────────────────────────────────────────────
function ProgressView({ stage, stageIndex, progress, fileName }: {
  stage: ImportStage, stageIndex: number, progress: number, fileName: string
}) {
  return (
    <div style={{ animation: 'fadeInUp 0.3s ease' }}>
      <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: '20px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
          <FileText size={16} style={{ color: 'var(--accent-emerald)' }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-secondary)' }}>{fileName}</span>
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--accent-emerald)' }}>{progress}%</span>
        </div>
        <div style={{ height: '2px', background: 'var(--border-default)', borderRadius: '2px', marginBottom: '20px', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progress}%`, background: 'var(--accent-emerald)', borderRadius: '2px', transition: 'width 0.4s ease', boxShadow: '0 0 8px rgba(0,217,126,0.4)' }} />
        </div>
        <div className="progress-steps">
          {ALL_STAGES.map((s, i) => {
            const sIdx = STAGE_ORDER.indexOf(s.id)
            const isDone = sIdx < stageIndex
            const isActive = s.id === stage
            return (
              <div key={s.id} className={`progress-step ${isActive ? 'progress-step--active' : ''} ${isDone ? 'progress-step--done' : ''}`}>
                <div className="progress-step__indicator">
                  {isDone ? '✓' : isActive ? <span className="spinner" style={{ width: '10px', height: '10px' }} /> : i + 1}
                </div>
                <div style={{ flex: 1 }}>
                  <div className="progress-step__label">{s.label}</div>
                  {isActive && <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', marginTop: '1px' }}>{s.description}</div>}
                </div>
                {isActive && <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--accent-emerald-dim)' }}>Em andamento</div>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Done View ────────────────────────────────────────────────────────────────
function DoneView({ fileName, messageCount, newPersonCount, mergedCount, navigate, reset }: {
  fileName: string, messageCount: number, newPersonCount: number, mergedCount: number
  navigate: (page: Page) => void, reset: () => void
}) {
  return (
    <div style={{ animation: 'fadeInUp 0.4s ease' }}>
      <div style={{ background: 'var(--accent-emerald-subtle)', border: '1px solid rgba(0,217,126,0.2)', borderRadius: 'var(--radius-md)', padding: '32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', textAlign: 'center', marginBottom: '20px' }}>
        <CheckCircle2 size={40} style={{ color: 'var(--accent-emerald)' }} />
        <div style={{ fontSize: '18px', fontWeight: '700', color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
          Memória importada com sucesso
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--accent-emerald-dim)' }}>
          {messageCount.toLocaleString('pt-BR')} mensagens indexadas
        </div>

        {/* People summary */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
          {newPersonCount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'var(--bg-overlay)', border: '1px solid var(--border-default)', borderRadius: '4px', padding: '4px 10px' }}>
              <UserPlus size={11} style={{ color: 'var(--accent-emerald)' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-secondary)' }}>
                {newPersonCount} nova{newPersonCount > 1 ? 's' : ''} pessoa{newPersonCount > 1 ? 's' : ''}
              </span>
            </div>
          )}
          {mergedCount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'var(--bg-overlay)', border: '1px solid var(--border-default)', borderRadius: '4px', padding: '4px 10px' }}>
              <Merge size={11} style={{ color: 'var(--accent-cyan)' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-secondary)' }}>
                {mergedCount} vinculada{mergedCount > 1 ? 's' : ''} ao grafo
              </span>
            </div>
          )}
        </div>

        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{fileName}</div>
      </div>
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
        <button className="btn btn--primary" onClick={() => navigate('people')} style={{ gap: '8px' }}>
          <Users size={13} />
          Ver grafo de pessoas
        </button>
        <button className="btn btn--ghost" onClick={() => navigate('search')} style={{ gap: '8px' }}>
          <Search size={13} />
          Buscar memórias
        </button>
        <button className="btn btn--ghost" onClick={reset} style={{ gap: '8px' }}>
          <RefreshCw size={13} />
          Importar outro
        </button>
      </div>
    </div>
  )
}
