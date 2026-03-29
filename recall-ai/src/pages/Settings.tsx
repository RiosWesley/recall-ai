import { useState } from 'react'
import { Cpu, Sliders, HardDrive, Shield, Trash2, FolderOpen, ChevronRight } from 'lucide-react'

interface SettingsSectionProps {
  title: string
  icon: React.ReactNode
  color?: string
  children: React.ReactNode
}

function SettingsSection({ title, icon, color = 'var(--accent-emerald)', children }: SettingsSectionProps) {
  return (
    <div style={{ marginBottom: '24px' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '10px',
      }}>
        <div style={{
          width: '24px',
          height: '24px',
          borderRadius: 'var(--radius-sm)',
          background: `${color}12`,
          border: `1px solid ${color}25`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <span style={{ color }}>{icon}</span>
        </div>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          fontWeight: '600',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--text-secondary)',
        }}>
          {title}
        </span>
      </div>
      <div className="settings-group">{children}</div>
    </div>
  )
}

interface ToggleRowProps {
  label: string
  desc: string
  value: boolean
  onChange: (v: boolean) => void
}

function ToggleRow({ label, desc, value, onChange }: ToggleRowProps) {
  return (
    <div className="settings-row">
      <div className="settings-row__info">
        <span className="settings-row__label">{label}</span>
        <span className="settings-row__desc">{desc}</span>
      </div>
      <button
        onClick={() => onChange(!value)}
        style={{
          width: '36px',
          height: '20px',
          borderRadius: '10px',
          background: value ? 'var(--accent-emerald)' : 'var(--border-strong)',
          border: 'none',
          cursor: 'pointer',
          position: 'relative',
          transition: 'background 0.2s ease',
          flexShrink: 0,
        }}
      >
        <span style={{
          position: 'absolute',
          width: '14px',
          height: '14px',
          borderRadius: '50%',
          background: '#fff',
          top: '3px',
          left: value ? '19px' : '3px',
          transition: 'left 0.2s ease',
        }} />
      </button>
    </div>
  )
}

interface SelectRowProps {
  label: string
  desc: string
  value: string
  options: string[]
  onChange: (v: string) => void
}

function SelectRow({ label, desc, value, options, onChange }: SelectRowProps) {
  return (
    <div className="settings-row">
      <div className="settings-row__info">
        <span className="settings-row__label">{label}</span>
        <span className="settings-row__desc">{desc}</span>
      </div>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          background: 'var(--bg-overlay)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          padding: '5px 8px',
          outline: 'none',
          cursor: 'pointer',
        }}
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

interface SliderRowProps {
  label: string
  desc: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
}

function SliderRow({ label, desc, value, min, max, step, format, onChange }: SliderRowProps) {
  return (
    <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
        <div className="settings-row__info">
          <span className="settings-row__label">{label}</span>
          <span className="settings-row__desc">{desc}</span>
        </div>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          color: 'var(--accent-emerald)',
          fontWeight: '600',
        }}>
          {format(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{
          width: '100%',
          accentColor: 'var(--accent-emerald)',
          cursor: 'pointer',
        }}
      />
    </div>
  )
}

export default function SettingsPage() {
  const [gpu, setGpu] = useState('auto')
  const [topK, setTopK] = useState(5)
  const [alpha, setAlpha] = useState(0.7)
  const [temp, setTemp] = useState(0.3)
  const [history, setHistory] = useState(true)
  const [analytics, setAnalytics] = useState(false)


  return (
    <div className="page">
      <div className="page-header">
        <div className="page-header__eyebrow">Preferências</div>
        <h1 className="page-header__title">Configurações</h1>
        <p className="page-header__desc">
          Personalize o comportamento do modelo, performance e privacidade.
        </p>
      </div>

      {/* Model Settings */}
      <SettingsSection title="Modelo & Inferência" icon={<Cpu size={12} />}>
        <SelectRow
          label="Backend de GPU"
          desc="Aceleração de hardware para inferência de IA"
          value={gpu}
          options={['auto', 'cuda', 'metal', 'vulkan', 'cpu']}
          onChange={setGpu}
        />
        <SliderRow
          label="Temperatura"
          desc="Controla a criatividade das respostas (menor = mais determinístico)"
          value={temp}
          min={0}
          max={1}
          step={0.05}
          format={v => v.toFixed(2)}
          onChange={setTemp}
        />
        <div className="settings-row">
          <div className="settings-row__info">
            <span className="settings-row__label">Modelo LLM</span>
            <span className="settings-row__desc">Gemma 3 270M INT4 GGUF · ~150MB</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="badge badge--emerald">Carregado</span>
            <button className="btn btn--ghost" style={{ fontSize: '11px', padding: '4px 8px', gap: '5px' }}>
              <FolderOpen size={11} />
              Trocar
            </button>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row__info">
            <span className="settings-row__label">Modelo de Embedding</span>
            <span className="settings-row__desc">all-MiniLM-L6-v2 GGUF · ~25MB · dim 384</span>
          </div>
          <span className="badge badge--emerald">Ativo</span>
        </div>
      </SettingsSection>

      {/* Search Settings */}
      <SettingsSection title="Busca & RAG" icon={<Sliders size={12} />} color="var(--accent-cyan)">
        <SliderRow
          label="Top-K resultados"
          desc="Número de chunks recuperados para o contexto da IA"
          value={topK}
          min={1}
          max={20}
          step={1}
          format={v => String(v)}
          onChange={setTopK}
        />
        <SliderRow
          label="Alpha (busca híbrida)"
          desc="Peso entre busca semântica (1.0) e keyword (0.0)"
          value={alpha}
          min={0}
          max={1}
          step={0.05}
          format={v => v.toFixed(2)}
          onChange={setAlpha}
        />
        <ToggleRow
          label="Histórico de buscas"
          desc="Salvar consultas recentes na sidebar"
          value={history}
          onChange={setHistory}
        />
      </SettingsSection>

      {/* Storage */}
      <SettingsSection title="Armazenamento" icon={<HardDrive size={12} />} color="var(--accent-amber)">
        <div className="settings-row">
          <div className="settings-row__info">
            <span className="settings-row__label">Banco de dados</span>
            <span className="settings-row__desc">SQLite · better-sqlite3 · sqlite-vec</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>
              0 MB
            </span>
            <button className="btn btn--ghost" style={{ fontSize: '11px', padding: '4px 8px', gap: '5px' }}>
              <FolderOpen size={11} />
              Abrir
            </button>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row__info">
            <span className="settings-row__label">Diretório de modelos</span>
            <span className="settings-row__desc">Onde os arquivos GGUF são armazenados</span>
          </div>
          <button className="btn btn--ghost" style={{ fontSize: '11px', padding: '4px 8px', gap: '5px' }}>
            <FolderOpen size={11} />
            Escolher
          </button>
        </div>
        <div className="settings-row" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div className="settings-row__info">
            <span className="settings-row__label" style={{ color: 'var(--danger)' }}>
              Limpar todos os dados
            </span>
            <span className="settings-row__desc">
              Remove todas as conversas e embeddings do banco local
            </span>
          </div>
          <button
            className="btn"
            style={{
              background: 'var(--danger-glow)',
              border: '1px solid rgba(244,63,94,0.25)',
              color: 'var(--danger)',
              fontSize: '11px',
              padding: '5px 10px',
              gap: '6px',
            }}
          >
            <Trash2 size={11} />
            Limpar
          </button>
        </div>
      </SettingsSection>

      {/* Privacy */}
      <SettingsSection title="Privacidade" icon={<Shield size={12} />} color="var(--accent-cyan)">
        <ToggleRow
          label="Métricas de performance"
          desc="Coleta local de latência e uso de recursos (nunca enviado)"
          value={analytics}
          onChange={setAnalytics}
        />
        <div className="settings-row">
          <div className="settings-row__info">
            <span className="settings-row__label">Verificação de privacidade</span>
            <span className="settings-row__desc">Confirma que nenhum dado é enviado para servidores externos</span>
          </div>
          <span className="badge badge--emerald">
            ✓ 100% offline
          </span>
        </div>
      </SettingsSection>

      {/* Version info */}
      <div style={{
        padding: '16px 0',
        borderTop: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>
          Recall.ai v0.1.0-dev · Electron + React + node-llama-cpp
        </span>
        <button className="btn btn--ghost" style={{ fontSize: '11px', gap: '5px', padding: '5px 10px' }}>
          Verificar atualizações <ChevronRight size={11} />
        </button>
      </div>
    </div>
  )
}
