import { useState, useRef, useEffect } from 'react'
import { Send, BrainCircuit, BookOpen, ChevronDown, Calendar, Filter, Database } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Page } from '../App'
import type { RAGStep } from '../shared/types'

interface ChatPageProps {
  navigate: (page: Page) => void
  chatId: string | null
}

interface Message {
  id: string
  role: 'user' | 'ai'
  content: string
  sources?: { meta: string, text: string }[]
  isStreaming?: boolean
  latency?: import('../shared/types').RAGLatency
}

const INITIAL_MESSAGES: Message[] = [
  {
    id: 'm0',
    role: 'ai',
    content: 'Contexto ativo e indexado. Como posso ajudar com os seus dados textuais hoje?',
  },
]

const STEP_LABELS: Record<string, string> = {
  booting: 'Acordando modelos e conferindo recursos...',
  searching: 'Buscando nas memórias e cruzando palavras-chave...',
  processing: 'Filtrando metadados e injetando no contexto...',
  synthesizing: 'Sintetizando informações em Qwen3.5 (Brain)...',
}

function ExpandableCitation({ source, index }: { source: { meta: string, text: string }, index: number }) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="citation-chip-container" style={{ marginBottom: '8px' }}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          width: '100%',
          background: 'var(--bg-subtle)',
          border: '1px solid var(--border-subtle)',
          padding: '8px 12px',
          borderRadius: '6px',
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'background 0.2s ease'
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-overlay)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-subtle)'}
      >
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '10px',
          color: 'var(--accent-emerald)',
          background: 'var(--accent-emerald-subtle)',
          padding: '2px 6px',
          borderRadius: '4px',
        }}>
          [{index + 1}]
        </div>
        <div style={{ color: 'var(--text-secondary)', fontSize: '12px', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {source.meta || 'Memória Recuperada'}
        </div>
        <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
        </motion.div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ 
              padding: '12px', 
              background: '#0a0a0d', 
              border: '1px solid var(--border-subtle)', 
              borderTop: 'none', 
              borderBottomLeftRadius: '6px', 
              borderBottomRightRadius: '6px',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--text-primary)',
              lineHeight: '1.6',
              whiteSpace: 'pre-wrap',
            }}>
              <div style={{ color: 'var(--text-disabled)', marginBottom: '8px', userSelect: 'none' }}>
                {"// RAW SLIDING WINDOW FRAGMENT"}
              </div>
              {source.text}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function ChatPage({ chatId }: ChatPageProps) {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES)
  const [input, setInput] = useState('')
  const [ragStep, setRagStep] = useState<RAGStep | null>(null)
  
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, ragStep])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || ragStep !== null) return

    const userMsg: Message = { id: `u${Date.now()}`, role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setRagStep('booting')

    const aiMsgId = `a${Date.now()}`
    let isFirstToken = true

    const unsubStep = window.api.onRAGStep((step: RAGStep) => {
      setRagStep(step)
    })

    const unsubToken = window.api.onRAGToken((token) => {
      if (isFirstToken) {
        setRagStep(null)
        isFirstToken = false
        setMessages(prev => [...prev, {
          id: aiMsgId,
          role: 'ai',
          content: token,
          isStreaming: true,
        }])
      } else {
        setMessages(prev => prev.map(m =>
          m.id === aiMsgId ? { ...m, content: m.content + token } : m
        ))
      }
    })

    const unsubDone = window.api.onRAGDone((response) => {
      unsubStep()
      unsubToken()
      unsubDone()

      const citations = response.context ? response.context.map((c: any) => ({
        meta: `[${c.date}] ${c.chatName} — ${c.sender !== 'System' ? c.sender : 'Root'}`,
        text: c.content
      })) : []

      if (isFirstToken) {
        setRagStep(null)
        setMessages(prev => [...prev, {
          id: aiMsgId,
          role: 'ai',
          content: response.answer || 'Não encontrei uma resposta.',
          isStreaming: false,
          sources: citations.length > 0 ? citations : undefined,
          latency: response.latency,
        }])
      } else {
        setMessages(prev => prev.map(m =>
          m.id === aiMsgId ? {
            ...m,
            isStreaming: false,
            content: response.answer,
            sources: citations.length > 0 ? citations : undefined,
            latency: response.latency,
          } : m
        ))
      }
    })

    try {
      await window.api.askRAG(text, { chatId: chatId || undefined })
    } catch (err: any) {
      unsubStep()
      unsubToken()
      unsubDone()
      setRagStep(null)
      
      setMessages(prev => [...prev, {
        id: `e${Date.now()}`,
        role: 'ai',
        content: `❌ **Aviso Crítico de Hardware:** ${err.message || 'Falha catastrófica ao processar dados (Possível instabilidade de GPU/OOM).'}\n\n*Por favor, verifique se a extensão do modelo cabe na VRAM alocada deste dispositivo.*`,
        isStreaming: false,
      }])
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px'
    }
  }, [input])

  return (
    <div className="chat-view" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)' }}>
      
      {/* Precision UI: Header de Metadados e Controles */}
      <div style={{
        padding: '16px 24px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'rgba(10, 10, 10, 0.85)',
        backdropFilter: 'blur(12px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        zIndex: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ 
            width: '32px', height: '32px', borderRadius: '8px', 
            background: 'var(--bg-overlay)', border: '1px solid var(--border-muted)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <BrainCircuit size={16} style={{ color: 'var(--accent-emerald)' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '14px', fontWeight: '500', color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
              Deep Synthesis
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-disabled)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {chatId ? `Target: ID-${chatId.split('-')[0]}` : 'Omni-Search Mode'}
            </span>
          </div>
        </div>

        {/* Temporal & Meta Filters */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)',
            padding: '6px 12px', borderRadius: '16px', color: 'var(--text-secondary)',
            fontSize: '11px', cursor: 'pointer', transition: 'all 0.2s'
          }}>
            <Calendar size={12} />
            Qualquer data
          </button>
          
          <button style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)',
            padding: '6px 12px', borderRadius: '16px', color: 'var(--text-secondary)',
            fontSize: '11px', cursor: 'pointer', transition: 'all 0.2s'
          }}>
            <Database size={12} />
            Apenas Entidades Reais
          </button>

          <button style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: 'none', border: '1px solid transparent',
            padding: '6px', borderRadius: '16px', color: 'var(--text-muted)',
            cursor: 'pointer'
          }}>
            <Filter size={14} />
          </button>
        </div>
      </div>

      {/* Message Flow */}
      <div className="chat-messages" style={{ flex: 1, padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <AnimatePresence initial={false}>
          {messages.map(msg => (
            <motion.div 
              key={msg.id} 
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              style={{
                display: 'flex', 
                flexDirection: 'column',
                alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                width: '100%'
              }}
            >
              <div style={{ 
                fontFamily: 'var(--font-mono)', 
                fontSize: '10px', 
                color: 'var(--text-disabled)', 
                marginBottom: '6px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                {msg.role === 'user' ? 'User_Input' : 'Qwen_Sys'}
              </div>
              
              <div style={{
                background: msg.role === 'user' ? 'var(--bg-overlay)' : 'transparent',
                border: msg.role === 'user' ? '1px solid var(--border-subtle)' : 'none',
                padding: msg.role === 'user' ? '12px 16px' : '0',
                borderRadius: '8px',
                color: 'var(--text-primary)',
                fontSize: '13px',
                lineHeight: '1.6',
                maxWidth: '85%',
                userSelect: 'text'
              }}>
                {msg.content}
                {msg.isStreaming && <motion.span animate={{ opacity: [1, 0] }} transition={{ repeat: Infinity, duration: 0.8 }} style={{ display: 'inline-block', width: '6px', height: '14px', background: 'var(--text-disabled)', marginLeft: '4px', verticalAlign: 'middle' }} />}
              </div>

              {/* Citations / Transparência Operacional */}
              {msg.sources && msg.sources.length > 0 && !msg.isStreaming && (
                <div style={{ marginTop: '16px', width: '100%', maxWidth: '85%' }}>
                  <div style={{ 
                    display: 'flex', alignItems: 'center', gap: '8px', 
                    marginBottom: '10px', color: 'var(--text-secondary)', fontSize: '11px', fontWeight: '500' 
                  }}>
                    <BookOpen size={12} />
                    Fontes Mapeadas ({msg.sources.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {msg.sources.map((s, i) => (
                      <ExpandableCitation key={i} source={s} index={i} />
                    ))}
                  </div>
                </div>
              )}
              
              {/* Telemetry Footer para AI messages */}
              {(msg.latency && !msg.isStreaming) && (
                <div style={{
                  marginTop: msg.sources && msg.sources.length > 0 ? '8px' : '12px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '9px',
                  color: 'var(--text-disabled)',
                  display: 'flex',
                  gap: '12px',
                  opacity: 0.7
                }}>
                  <span>RTT_SEARCH: {(msg.latency.embedding + msg.latency.search).toFixed(0)}MS</span>
                  <span>SYS_GEN: {msg.latency.generation.toFixed(0)}MS</span>
                </div>
              )}
            </motion.div>
          ))}

          {/* Granular Loading State / RAG Steps */}
          {ragStep && (
            <motion.div 
              initial={{ opacity: 0, y: 15 }} 
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginTop: '12px' }}
            >
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-disabled)', marginBottom: '6px', textTransform: 'uppercase' }}>
                System_Status
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 18px', background: 'var(--bg-subtle)', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                <div style={{ position: 'relative', width: '14px', height: '14px' }}>
                  <motion.div 
                    animate={{ rotate: 360 }} 
                    transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                    style={{ width: '100%', height: '100%', border: '2px solid var(--border-muted)', borderTopColor: 'var(--accent-emerald)', borderRadius: '50%' }}
                  />
                </div>
                <motion.span 
                  key={ragStep}
                  initial={{ opacity: 0, x: -5 }} animate={{ opacity: 1, x: 0 }}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-secondary)' }}
                >
                  {STEP_LABELS[ragStep] || ragStep}
                </motion.span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={bottomRef} style={{ height: '40px' }} />
      </div>

      {/* Bespoke Input Area */}
      <div style={{ padding: '0 24px 24px 24px', background: 'transparent' }}>
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '12px',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'flex-end',
          gap: '12px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.2)'
        }}>
          <textarea
            ref={textareaRef}
            placeholder="Questione o seu banco de memórias..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: 'var(--text-primary)',
              fontSize: '14px',
              resize: 'none',
              outline: 'none',
              maxHeight: '120px',
              fontFamily: 'inherit',
              paddingTop: '2px'
            }}
            rows={1}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || ragStep !== null}
            style={{
              background: input.trim() && ragStep === null ? 'var(--accent-emerald)' : 'var(--bg-overlay)',
              color: input.trim() && ragStep === null ? '#000' : 'var(--text-muted)',
              border: 'none',
              width: '32px', height: '32px',
              borderRadius: '8px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: input.trim() && ragStep === null ? 'pointer' : 'default',
              transition: 'all 0.2s ease',
            }}
          >
            <Send size={14} />
          </button>
        </div>
        <div style={{
          marginTop: '12px',
          fontFamily: 'var(--font-mono)',
          fontSize: '9px',
          color: 'var(--text-disabled)',
          display: 'flex',
          justifyContent: 'space-between',
          textTransform: 'uppercase',
          letterSpacing: '0.05em'
        }}>
          <span>Shift+Enter para quebra de linha</span>
          <span>Dual RAG Logic · Local VRAM Encrypted</span>
        </div>
      </div>
    </div>
  )
}
