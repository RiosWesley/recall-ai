import { useState, useRef, useEffect } from 'react'
import { Send, BrainCircuit, BookOpen, ChevronDown, ChevronUp } from 'lucide-react'
import type { Page } from '../App'

interface ChatPageProps {
  navigate: (page: Page) => void
  chatId: string | null
}

interface Message {
  id: string
  role: 'user' | 'ai'
  content: string
  sources?: string[]
  isStreaming?: boolean
}

const MOCK_SOURCES = [
  'Maria — Família · 14 mar 2024 · 19:15',
  'Maria — Família · 15 mar 2024 · 09:33',
]

const INITIAL_MESSAGES: Message[] = [
  {
    id: 'm0',
    role: 'ai',
    content: 'Olá! Conectado ao corpus de conversas importadas. Faça uma pergunta sobre suas mensagens.',
  },
]

export default function ChatPage({ chatId }: ChatPageProps) {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES)
  const [input, setInput] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const [showSources, setShowSources] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || isThinking) return

    const userMsg: Message = { id: `u${Date.now()}`, role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setIsThinking(true)

    // Simulate RAG + streaming
    await sleep(800)

    const aiMsgId = `a${Date.now()}`
    const fullResponse = `Encontrei referências sobre isso nas suas conversas com Maria. Ela enviou uma receita de bolo de cenoura no dia 14 de março de 2024, mencionando que o segredo é usar cenoura bem fresca e não bater demais na batedeira. No dia seguinte, você confirmou que anotou a receita e pretendia tentar fazer no final de semana.`

    // Streaming effect
    setMessages(prev => [...prev, {
      id: aiMsgId,
      role: 'ai',
      content: '',
      sources: MOCK_SOURCES,
      isStreaming: true,
    }])
    setIsThinking(false)

    for (let i = 0; i <= fullResponse.length; i++) {
      await sleep(18)
      setMessages(prev => prev.map(m =>
        m.id === aiMsgId ? { ...m, content: fullResponse.slice(0, i) } : m
      ))
    }

    setMessages(prev => prev.map(m =>
      m.id === aiMsgId ? { ...m, isStreaming: false } : m
    ))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px'
    }
  }, [input])

  return (
    <div className="chat-view">
      {/* Chat Header */}
      <div style={{
        padding: '12px 24px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface)',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
      }}>
        <BrainCircuit size={15} style={{ color: 'var(--accent-emerald)' }} />
        <div>
          <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
            RAG Conversation
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)' }}>
            Gemma 3 270M · MiniLM-L6-v2 · CPU
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
          <span className="badge badge--emerald">
            <span className="status-dot status-dot--ready" style={{ width: '4px', height: '4px' }} />
            Modelo pronto
          </span>
          <span className="badge badge--muted">Top-K: 5</span>
          <span className="badge badge--muted">α: 0.7</span>
        </div>
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.map(msg => (
          <div key={msg.id} className={`bubble bubble--${msg.role} animate-fade-in-up`}>
            <div className="bubble__sender">
              {msg.role === 'user' ? 'Você' : 'Recall.ai'}
            </div>
            <div className="bubble__body selectable">
              {msg.content}
              {msg.isStreaming && <span className="cursor" />}
            </div>

            {/* Sources */}
            {msg.sources && msg.sources.length > 0 && !msg.isStreaming && (
              <div className="citations">
                <button
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                  onClick={() => setShowSources(showSources === msg.id ? null : msg.id)}
                >
                  <span className="citation-label">
                    <BookOpen size={9} style={{ display: 'inline', marginRight: '3px' }} />
                    {msg.sources.length} fonte{msg.sources.length > 1 ? 's' : ''}
                  </span>
                  {showSources === msg.id
                    ? <ChevronUp size={9} style={{ color: 'var(--text-muted)' }} />
                    : <ChevronDown size={9} style={{ color: 'var(--text-muted)' }} />
                  }
                </button>

                {showSources === msg.id && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', animation: 'fadeInUp 0.2s ease' }}>
                    {msg.sources.map((s, i) => (
                      <div key={i} className="citation-chip">
                        <span style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '9px',
                          color: 'var(--accent-emerald)',
                          background: 'var(--accent-emerald-subtle)',
                          padding: '0 4px',
                          borderRadius: '2px',
                        }}>
                          [{i + 1}]
                        </span>
                        {s}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {isThinking && (
          <div className="bubble bubble--ai animate-fade-in">
            <div className="bubble__sender">Recall.ai</div>
            <div className="bubble__body" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="spinner" />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>
                Buscando contexto relevante...
              </span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input Area */}
      <div className="chat-input-area">
        <div className="chat-input-wrap">
          <textarea
            ref={textareaRef}
            className="chat-input selectable"
            placeholder="Pergunte sobre suas conversas... (Enter para enviar)"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
          />
          <button
            className="btn btn--icon"
            onClick={handleSend}
            disabled={!input.trim() || isThinking}
            style={{
              background: input.trim() && !isThinking ? 'var(--accent-emerald)' : 'var(--bg-overlay)',
              border: 'none',
              transition: 'background 0.2s ease',
            }}
          >
            <Send size={13} style={{ color: input.trim() && !isThinking ? '#000' : 'var(--text-muted)' }} />
          </button>
        </div>
        <div style={{
          marginTop: '8px',
          fontFamily: 'var(--font-mono)',
          fontSize: '10px',
          color: 'var(--text-disabled)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <span>Enter para enviar · Shift+Enter para nova linha</span>
          <span style={{ marginLeft: 'auto' }}>RAG · Streaming · 100% local</span>
        </div>
      </div>
    </div>
  )
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
