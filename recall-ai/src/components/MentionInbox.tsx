import { useState, useEffect } from 'react'
import { Inbox, X, Check, Link2, UserPlus, Trash2 } from 'lucide-react'
import type { PendingMention, Person, MentionResolutionAction } from '../shared/types'

interface MentionInboxProps {
  people: Person[]
  onResolved: () => void
}

export function MentionInbox({ people, onResolved }: MentionInboxProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [mentions, setMentions] = useState<PendingMention[]>([])
  const [selectedAction, setSelectedAction] = useState<{ [id: string]: MentionResolutionAction }>({})
  const [selectedPersonId, setSelectedPersonId] = useState<{ [id: string]: string }>({})
  const [isProcessing, setIsProcessing] = useState<{ [id: string]: boolean }>({})
  const [expandedContext, setExpandedContext] = useState<{ mentionId: string, messages: import('../shared/types').Message[] } | null>(null)
  const [isLoadingContext, setIsLoadingContext] = useState(false)

  const loadMentions = async () => {
    try {
      const pending = await window.api.getPendingMentions()
      setMentions(pending)
    } catch (err) {
      console.error('Failed to load pending mentions', err)
    }
  }

  useEffect(() => {
    loadMentions()

    const unsub = window.api.onMentionDetected((mention) => {
      setMentions((prev) => [...prev, mention])
    })

    return () => {
      unsub()
    }
  }, [])

  const handleResolve = async (mentionId: string) => {
    const action = selectedAction[mentionId]
    if (!action) return

    const personId = selectedPersonId[mentionId]
    if (action === 'link_existing' && !personId) return

    setIsProcessing((prev) => ({ ...prev, [mentionId]: true }))
    try {
      await window.api.resolveMention(mentionId, action, personId)
      await loadMentions() // Reload to reflect resolved clones as well
      onResolved() // Notify parent (PeoplePage) to reload the graph
    } catch (err) {
      console.error('Failed to resolve mention:', err)
      alert('Erro ao processar menção')
    } finally {
      setIsProcessing((prev) => ({ ...prev, [mentionId]: false }))
    }
  }

  const handleShowContext = async (mention: import('../shared/types').PendingMention) => {
    setIsLoadingContext(true)
    try {
      const messages = await window.api.getMentionContext(mention.sessionId, mention.context || '')
      setExpandedContext({ mentionId: mention.id, messages })
    } catch (err) {
      console.error('Failed to load context:', err)
    } finally {
      setIsLoadingContext(false)
    }
  }

  return (
    <>
      {/* Floating Button Trigger */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '24px',
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          zIndex: 100,
          color: mentions.length > 0 ? 'var(--accent-emerald)' : 'var(--text-muted)'
        }}
      >
        <Inbox size={16} />
        <span style={{ fontSize: '13px', fontWeight: '500' }}>
          Inbox ({mentions.length})
        </span>
      </button>

      {/* Inbox Panel */}
      {isOpen && (
        <div style={{
          position: 'absolute',
          top: '60px',
          right: '20px',
          width: '380px',
          maxHeight: 'calc(100vh - 100px)',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '12px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 100,
          overflow: 'hidden'
        }}>
          {/* Header */}
          <div style={{
            padding: '16px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--bg-elevated)'
          }}>
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: '600', margin: 0, color: 'var(--text-primary)' }}>
                Menções Pendentes
              </h3>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                A IA detectou essas pessoas, nos diga quem são.
              </p>
            </div>
            <button onClick={() => setIsOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
              <X size={16} />
            </button>
          </div>

          {/* List */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {mentions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>
                <Check size={32} style={{ opacity: 0.5, marginBottom: '8px' }} />
                <div style={{ fontSize: '13px' }}>Tudo limpo! Nenhuma menção pendente.</div>
              </div>
            ) : (
              mentions.map((m) => (
                <div key={m.id} style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  padding: '12px'
                }}>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '4px' }}>
                    Identificado: <span style={{ color: 'var(--accent-emerald)' }}>{m.alias}</span>
                  </div>
                  {m.context && (
                    <div 
                      onClick={() => handleShowContext(m)}
                      title="Clique para ver mensagens vizinhas"
                      style={{ 
                        fontSize: '11px', color: 'var(--text-secondary)', fontStyle: 'italic', 
                        marginBottom: '12px', background: 'var(--bg-surface)', padding: '8px', 
                        borderRadius: '4px', cursor: 'pointer', border: '1px dashed var(--border-subtle)',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = 'var(--accent-emerald)'
                        e.currentTarget.style.background = 'var(--bg-elevated)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'var(--border-subtle)'
                        e.currentTarget.style.background = 'var(--bg-surface)'
                      }}
                    >
                      "{m.context}"
                      <div style={{ fontSize: '9px', marginTop: '4px', opacity: 0.6, textAlign: 'right' }}>
                        ver contexto completo 💬
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    <button
                      onClick={() => setSelectedAction({ ...selectedAction, [m.id]: 'create_new' })}
                      style={{
                        flex: 1, padding: '6px', fontSize: '11px', cursor: 'pointer',
                        background: selectedAction[m.id] === 'create_new' ? 'var(--accent-emerald)' : 'transparent',
                        color: selectedAction[m.id] === 'create_new' ? 'black' : 'var(--text-secondary)',
                        border: `1px solid ${selectedAction[m.id] === 'create_new' ? 'var(--accent-emerald)' : 'var(--border-subtle)'}`,
                        borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
                      }}
                    >
                      <UserPlus size={12} /> Novo
                    </button>
                    <button
                      onClick={() => setSelectedAction({ ...selectedAction, [m.id]: 'link_existing' })}
                      style={{
                        flex: 1, padding: '6px', fontSize: '11px', cursor: 'pointer',
                        background: selectedAction[m.id] === 'link_existing' ? 'var(--accent-emerald)' : 'transparent',
                        color: selectedAction[m.id] === 'link_existing' ? 'black' : 'var(--text-secondary)',
                        border: `1px solid ${selectedAction[m.id] === 'link_existing' ? 'var(--accent-emerald)' : 'var(--border-subtle)'}`,
                        borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
                      }}
                    >
                      <Link2 size={12} /> Vincular
                    </button>
                    <button
                      onClick={() => setSelectedAction({ ...selectedAction, [m.id]: 'ignore' })}
                      style={{
                        padding: '6px', fontSize: '11px', cursor: 'pointer',
                        background: selectedAction[m.id] === 'ignore' ? 'var(--accent-red)' : 'transparent',
                        color: selectedAction[m.id] === 'ignore' ? 'white' : 'var(--text-secondary)',
                        border: `1px solid ${selectedAction[m.id] === 'ignore' ? 'var(--accent-red)' : 'var(--border-subtle)'}`,
                        borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}
                      title="Ignorar falso positivo"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>

                  {/* Contextual form */}
                  {selectedAction[m.id] === 'link_existing' && (
                    <select
                      value={selectedPersonId[m.id] || ''}
                      onChange={(e) => setSelectedPersonId({ ...selectedPersonId, [m.id]: e.target.value })}
                      style={{ width: '100%', padding: '6px', fontSize: '11px', background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-focus)', borderRadius: '4px', marginBottom: '8px' }}
                    >
                      <option value="" disabled>Selecione uma pessoa...</option>
                      {people.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  )}

                  {selectedAction[m.id] && (
                    <button
                      onClick={() => handleResolve(m.id)}
                      disabled={isProcessing[m.id] || (selectedAction[m.id] === 'link_existing' && !selectedPersonId[m.id])}
                      style={{
                        width: '100%', padding: '6px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer',
                        background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-focus)', borderRadius: '4px'
                      }}
                    >
                      {isProcessing[m.id] ? 'Processando...' : 'Confirmar'}
                    </button>
                  )}

                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Expanded Context Modal */}
      {expandedContext && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px'
        }} onClick={() => setExpandedContext(null)}>
          <div style={{
            width: '100%',
            maxWidth: '500px',
            background: 'var(--bg-surface)',
            borderRadius: '12px',
            border: '1px solid var(--border-subtle)',
            boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: '80vh',
            overflow: 'hidden'
          }} onClick={e => e.stopPropagation()}>
            {/* Modal Header */}
            <div style={{ padding: '16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-elevated)' }}>
              <div style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--accent-emerald)' }}>Contexto da Conversa</div>
              <button onClick={() => setExpandedContext(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            {/* Messages List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {expandedContext.messages.map((msg, i) => {
                const isPivot = mentions.find(m => m.id === expandedContext.mentionId)?.context?.includes(msg.content)
                return (
                  <div key={msg.id} style={{
                    padding: '8px 12px',
                    borderRadius: '8px',
                    background: isPivot ? 'rgba(34, 197, 94, 0.1)' : 'var(--bg-elevated)',
                    border: `1px solid ${isPivot ? 'var(--accent-emerald)' : 'var(--border-subtle)'}`,
                    alignSelf: 'stretch'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-primary)' }}>{msg.sender}</span>
                      <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                        {new Date(msg.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                      {msg.content}
                    </div>
                  </div>
                )
              })}
            </div>
            
            <div style={{ padding: '12px', textAlign: 'center', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', fontSize: '11px', color: 'var(--text-muted)' }}>
              Clique fora para fechar
            </div>
          </div>
        </div>
      )}

      {isLoadingContext && (
        <div style={{ position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)', background: 'var(--accent-emerald)', color: 'black', padding: '8px 16px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold', zIndex: 2000, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
          Buscando contexto...
        </div>
      )}
    </>
  )
}
