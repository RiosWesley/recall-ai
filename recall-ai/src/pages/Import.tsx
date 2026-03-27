import { useState, useCallback, useEffect } from 'react'
import { Upload, FileText, Archive, CheckCircle2, X, RefreshCw } from 'lucide-react'
import type { Page } from '../App'

interface ImportPageProps {
  navigate: (page: Page) => void
}

type ImportStage = 'idle' | 'reading' | 'parsing' | 'chunking' | 'embedding' | 'storing' | 'done' | 'error'

const STAGES: { id: ImportStage; label: string; description: string }[] = [
  { id: 'reading', label: 'Lendo arquivo', description: 'Abrindo e validando o arquivo exportado' },
  { id: 'parsing', label: 'Parseando mensagens', description: 'Extraindo mensagens do formato WhatsApp' },
  { id: 'chunking', label: 'Segmentando chunks', description: 'Agrupando mensagens por janela de tempo' },
  { id: 'embedding', label: 'Gerando embeddings', description: 'Vetorizando com all-MiniLM-L6-v2' },
  { id: 'storing', label: 'Salvando no banco', description: 'Persistindo vetores no SQLite' },
]

const STAGE_ORDER: ImportStage[] = ['reading', 'parsing', 'chunking', 'embedding', 'storing', 'done']

export default function ImportPage({ navigate }: ImportPageProps) {
  const [dragActive, setDragActive] = useState(false)
  const [stage, setStage] = useState<ImportStage>('idle')
  const [fileName, setFileName] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [messageCount, setMessageCount] = useState(0)

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

  // Simulated import pipeline for UI demo
  const startImport = (file: File) => {
    setFileName(file.name)
    setStage('reading')
    setProgress(0)

    const simulateStages = async () => {
      const stages = ['reading', 'parsing', 'chunking', 'embedding', 'storing'] as const
      for (let i = 0; i < stages.length; i++) {
        setStage(stages[i])
        // simulate varying durations per stage
        const duration = [400, 600, 800, 2000, 500][i]
        await sleep(duration)
        setProgress(Math.round(((i + 1) / stages.length) * 100))
      }
      setMessageCount(4821)
      setStage('done')
    }

    simulateStages()
  }

  const reset = () => {
    setStage('idle')
    setFileName(null)
    setProgress(0)
    setMessageCount(0)
  }

  const stageIndex = STAGE_ORDER.indexOf(stage)

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-header__eyebrow">Pipeline de Ingestão</div>
        <h1 className="page-header__title">Importar Conversa</h1>
        <p className="page-header__desc">
          Arraste um export do WhatsApp (.txt ou .zip) para indexação semântica.
        </p>
      </div>

      {stage === 'idle' ? (
        <>
          {/* Drop Zone */}
          <div
            className={`dropzone ${dragActive ? 'dropzone--active' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragActive(true) }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => document.getElementById('file-input')?.click()}
            style={{ marginBottom: '24px' }}
          >
            <input
              id="file-input"
              type="file"
              accept=".txt,.zip"
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />
            <Upload className="dropzone__icon" />
            <div className="dropzone__title">
              {dragActive ? 'Solte aqui para importar' : 'Arraste seu export do WhatsApp'}
            </div>
            <div className="dropzone__subtitle">
              ou clique para selecionar o arquivo
            </div>
            <div className="dropzone__formats">.txt · .zip</div>
          </div>

          {/* Instructions */}
          <div style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            padding: '20px',
          }}>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--text-muted)',
              marginBottom: '12px',
            }}>
              Como exportar do WhatsApp
            </div>
            <div className="stack-sm">
              {[
                'Abra a conversa no WhatsApp',
                'Toque nos 3 pontos → Mais → Exportar conversa',
                'Selecione "Sem mídia" (recomendado)',
                'Salve o arquivo .txt ou .zip',
                'Importe aqui acima',
              ].map((step, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10px',
                    color: 'var(--accent-emerald)',
                    background: 'var(--accent-emerald-subtle)',
                    border: '1px solid rgba(0,217,126,0.15)',
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {i + 1}
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)', paddingTop: '2px' }}>
                    {step}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : stage === 'done' ? (
        /* Success State */
        <div style={{ animation: 'fadeInUp 0.4s ease' }}>
          <div style={{
            background: 'var(--accent-emerald-subtle)',
            border: '1px solid rgba(0,217,126,0.2)',
            borderRadius: 'var(--radius-md)',
            padding: '32px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
            textAlign: 'center',
            marginBottom: '20px',
          }}>
            <CheckCircle2 size={40} style={{ color: 'var(--accent-emerald)' }} />
            <div style={{
              fontSize: '18px',
              fontWeight: '700',
              color: 'var(--text-primary)',
              letterSpacing: '-0.02em',
            }}>
              Importação concluída
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--accent-emerald-dim)' }}>
              {messageCount.toLocaleString('pt-BR')} mensagens indexadas — prontas para busca semântica
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>
              {fileName}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
            <button className="btn btn--primary" onClick={() => navigate('search')} style={{ gap: '8px' }}>
              Buscar agora
            </button>
            <button className="btn btn--ghost" onClick={reset} style={{ gap: '8px' }}>
              <RefreshCw size={13} />
              Importar outro
            </button>
          </div>
        </div>
      ) : (
        /* Progress State */
        <div style={{ animation: 'fadeInUp 0.3s ease' }}>
          <div style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            padding: '20px',
            marginBottom: '16px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <FileText size={16} style={{ color: 'var(--accent-emerald)' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-secondary)' }}>
                {fileName}
              </span>
              <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--accent-emerald)' }}>
                {progress}%
              </span>
            </div>

            {/* Progress bar */}
            <div style={{
              height: '2px',
              background: 'var(--border-default)',
              borderRadius: '2px',
              marginBottom: '20px',
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                width: `${progress}%`,
                background: 'var(--accent-emerald)',
                borderRadius: '2px',
                transition: 'width 0.4s ease',
                boxShadow: '0 0 8px rgba(0,217,126,0.4)',
              }} />
            </div>

            {/* Stage Steps */}
            <div className="progress-steps">
              {STAGES.map((s, i) => {
                const sIdx = STAGE_ORDER.indexOf(s.id)
                const isDone = sIdx < stageIndex
                const isActive = s.id === stage

                return (
                  <div
                    key={s.id}
                    className={`progress-step ${isActive ? 'progress-step--active' : ''} ${isDone ? 'progress-step--done' : ''}`}
                  >
                    <div className="progress-step__indicator">
                      {isDone ? '✓' : isActive ? <span className="spinner" style={{ width: '10px', height: '10px' }} /> : i + 1}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="progress-step__label">{s.label}</div>
                      {isActive && (
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', marginTop: '1px' }}>
                          {s.description}
                        </div>
                      )}
                    </div>
                    {isActive && (
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--accent-emerald-dim)' }}>
                        Em andamento
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
