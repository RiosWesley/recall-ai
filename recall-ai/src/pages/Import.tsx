import { useState, useCallback, useEffect } from 'react'
import {
  Upload, FileText, CheckCircle2, RefreshCw,
  Users, AlertCircle, Search, MessageCircle
} from 'lucide-react'
import type { Page } from '../App'

interface ImportPageProps {
  navigate: (page: Page) => void
}

// ─── Types ────────────────────────────────────────────────────────────────────

import type { ImportStageId } from '../shared/types'

type ImportStage = ImportStageId | 'idle'

// ─── Pipeline stages (display only) ──────────────────────────────────────────
const PIPELINE_STAGES = [
  { id: 'reading'  as const, label: 'Lendo arquivo',       description: 'Lendo e calculando hash do arquivo' },
  { id: 'parsing'  as const, label: 'Parseando mensagens', description: 'Extraindo mensagens do formato WhatsApp' },
  { id: 'fts_indexing' as const, label: 'FTS Indexing & Topologia',  description: 'Agrupando sessões temporalmente e salvando base nativa' },
  { id: 'nlp_summaries' as const, label: 'Batch Summaries',  description: 'Worker extraindo intenção em background' },
  { id: 'nlp_entities'  as const, label: 'Entity Resolving',   description: 'Consolidando dicionário estruturado e ações' },
]

const STAGE_ORDER: ImportStage[] = ['idle', 'reading', 'parsing', 'fts_indexing', 'nlp_summaries', 'nlp_entities', 'done', 'error']

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ImportPage({ navigate }: ImportPageProps) {
  const [dragActive, setDragActive]     = useState(false)
  const [stage, setStage]               = useState<ImportStage>('idle')
  const [fileName, setFileName]         = useState<string | null>(null)
  const [progress, setProgress]         = useState(0)
  const [detailMsg, setDetailMsg]       = useState<string | null>(null)
  const [messageCount, setMessageCount] = useState(0)
  const [errorMsg, setErrorMsg]         = useState<string | null>(null)
  const [explorableChatId, setExplorableChatId] = useState<string | null>(null)

  // Subscribe to real progress events from main process
  useEffect(() => {
    const unsub = window.api.onImportProgress((p) => {
      if (p.stage === 'done') {
        setStage('done')
        setProgress(100)
      } else if (p.stage === 'error') {
        setStage('error')
        setErrorMsg(p.detail ?? 'Erro desconhecido')
      } else {
        setStage(p.stage as ImportStage)
        setProgress(p.percent)
        setDetailMsg(p.detail ?? null)
      }
    })
    return () => unsub()
  }, [])

  const startImportFromPath = async (filePath: string, name: string) => {
    setFileName(name)
    setProgress(0)
    setStage('reading')
    setErrorMsg(null)
    setExplorableChatId(null)

    const result = await window.api.importChat(filePath)

    if (result.success) {
      setMessageCount(result.messageCount ?? 0)
      setExplorableChatId(result.chatId ?? null)
      // Note: we DO NOT setStage('done') here. The background task will emit NLP stages and finally 'done'.
    } else if (result.duplicate) {
      setStage('error')
      setErrorMsg('Este arquivo já foi importado. Cada conversa só pode ser importada uma vez.')
    } else {
      setStage('error')
      setErrorMsg(result.error ?? 'Falha desconhecida na importação.')
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(false)
    const file = e.dataTransfer.files[0]
    if (file) {
      // In Electron, File objects from drag & drop have a real path
      const filePath = (file as File & { path?: string }).path ?? file.name
      startImportFromPath(filePath, file.name)
    }
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const filePath = (file as File & { path?: string }).path ?? file.name
      startImportFromPath(filePath, file.name)
    }
  }

  const handleOpenDialog = async () => {
    const filePath = await window.api.openFileDialog()
    if (filePath) {
      const name = filePath.split(/[\/\\]/).pop() ?? filePath
      startImportFromPath(filePath, name)
    }
  }

  const reset = () => {
    setStage('idle')
    setFileName(null)
    setProgress(0)
    setDetailMsg(null)
    setMessageCount(0)
    setErrorMsg(null)
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

      {stage === 'idle' && (
        <IdleView
          dragActive={dragActive}
          setDragActive={setDragActive}
          onDrop={handleDrop}
          onFileSelect={handleFileSelect}
          onOpenDialog={handleOpenDialog}
        />
      )}

      {stage === 'done' && (
        <DoneView
          fileName={fileName!}
          messageCount={messageCount}
          navigate={navigate}
          reset={reset}
        />
      )}

      {stage === 'error' && (
        <ErrorView
          message={errorMsg ?? 'Erro desconhecido.'}
          reset={reset}
        />
      )}

      {stage !== 'idle' && stage !== 'done' && stage !== 'error' && (
        <ProgressView
          stage={stage}
          stageIndex={stageIndex}
          progress={progress}
          fileName={fileName!}
          detailMsg={detailMsg}
          explorableChatId={explorableChatId}
          navigate={navigate}
        />
      )}
    </div>
  )
}

// ─── Idle View ────────────────────────────────────────────────────────────────
function IdleView({
  dragActive, setDragActive, onDrop, onFileSelect, onOpenDialog,
}: {
  dragActive: boolean
  setDragActive: (v: boolean) => void
  onDrop: (e: React.DragEvent) => void
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
  onOpenDialog: () => void
}) {
  return (
    <>
      <div
        className={`dropzone ${dragActive ? 'dropzone--active' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragActive(true) }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        onClick={() => document.getElementById('file-input')?.click()}
        style={{ marginBottom: '16px' }}
      >
        <input id="file-input" type="file" accept=".txt,.zip" style={{ display: 'none' }} onChange={onFileSelect} />
        <Upload className="dropzone__icon" />
        <div className="dropzone__title">
          {dragActive ? 'Solte aqui para importar' : 'Arraste seu export do WhatsApp'}
        </div>
        <div className="dropzone__subtitle">ou use o botão abaixo para selecionar o arquivo</div>
        <div className="dropzone__formats">.txt · .zip</div>
      </div>

      {/* Native file dialog button */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
        <button
          className="btn btn--ghost"
          onClick={(e) => { e.stopPropagation(); onOpenDialog() }}
          style={{ gap: '8px', fontSize: '12px' }}
        >
          <Upload size={12} />
          Selecionar arquivo...
        </button>
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

// ─── Error View ───────────────────────────────────────────────────────────────
function ErrorView({ message, reset }: { message: string; reset: () => void }) {
  return (
    <div style={{ animation: 'fadeInUp 0.3s ease' }}>
      <div style={{
        background: 'rgba(244,63,94,0.06)',
        border: '1px solid rgba(244,63,94,0.2)',
        borderRadius: 'var(--radius-md)',
        padding: '28px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px',
        textAlign: 'center', marginBottom: '16px',
      }}>
        <AlertCircle size={36} style={{ color: 'var(--danger)' }} />
        <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)' }}>
          Falha na importação
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-secondary)', maxWidth: '400px' }}>
          {message}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button className="btn btn--ghost" onClick={reset} style={{ gap: '8px' }}>
          <RefreshCw size={13} />
          Tentar novamente
        </button>
      </div>
    </div>
  )
}

// ─── Progress View ────────────────────────────────────────────────────────────
function ProgressView({ stage, stageIndex, progress, fileName, detailMsg, explorableChatId, navigate }: {
  stage: ImportStage, stageIndex: number, progress: number, fileName: string, detailMsg: string | null,
  explorableChatId: string | null, navigate: (page: Page, chatId?: string) => void
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
          {PIPELINE_STAGES.map((s, i) => {
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
                  {isActive && (
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {s.description}
                      {detailMsg && <div style={{ color: 'var(--accent-emerald)', marginTop: '6px', fontWeight: 600 }}>[ {detailMsg} ]</div>}
                    </div>
                  )}
                </div>
                {isActive && <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--accent-emerald-dim)' }}>Em andamento</div>}
              </div>
            )
          })}
        </div>
      </div>
      
      {explorableChatId && (
        <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'center', animation: 'fadeInUp 0.3s ease' }}>
          <button 
             className="btn btn--primary" 
             onClick={() => navigate('chat', explorableChatId)}
             style={{ gap: '8px', fontSize: '13px', padding: '10px 24px' }}>
            <MessageCircle size={15} />
            Chat disponível! Explorar agora
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Done View ────────────────────────────────────────────────────────────────
function DoneView({ fileName, messageCount, navigate, reset }: {
  fileName: string, messageCount: number
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
