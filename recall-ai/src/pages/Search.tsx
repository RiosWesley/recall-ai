import { useState, useRef, useEffect } from 'react'
import { Search, Filter, Calendar, User, SlidersHorizontal, X, MessageSquare } from 'lucide-react'
import type { Page } from '../App'
import type { SearchResult, Chat } from '../shared/types'

interface SearchPageProps {
  navigate: (page: Page, chatId?: string) => void
  activeChatId: string | null
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)
    return () => clearTimeout(handler)
  }, [value, delay])
  return debouncedValue
}

function highlightText(content: string, query: string) {
  if (!query.trim()) return content
  
  // Safe regex escaping
  const terms = query.split(/\s+/).filter(Boolean).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (terms.length === 0) return content

  const regex = new RegExp(`(${terms.join('|')})`, 'gi')
  return content.replace(regex, '<mark>$1</mark>')
}

export default function SearchPage({ navigate }: SearchPageProps) {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query, 400)
  
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [searchTime, setSearchTime] = useState(0)
  
  const [showFilters, setShowFilters] = useState(false)
  const [isHybrid, setIsHybrid] = useState(true)
  const [chats, setChats] = useState<Chat[]>([])
  const [selectedChatId, setSelectedChatId] = useState<string | undefined>(undefined)

  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.api.getChats().then(setChats)
    inputRef.current?.focus()
  }, [])

  // Keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Auto-search effect
  useEffect(() => {
    async function doSearch() {
      if (!debouncedQuery.trim()) {
        setResults([])
        setHasSearched(false)
        setIsSearching(false)
        return
      }
      
      setIsSearching(true)
      const start = performance.now()
      
      try {
        const res = await window.api.search(debouncedQuery, { 
          hybrid: isHybrid, 
          chatId: selectedChatId 
        })
        setResults(res)
        setHasSearched(true)
      } catch (err) {
        console.error(err)
        setResults([])
      } finally {
        const end = performance.now()
        setSearchTime(Math.round(end - start))
        setIsSearching(false)
      }
    }
    
    doSearch()
  }, [debouncedQuery, isHybrid, selectedChatId])

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 0 }}>
      {/* Search Header */}
      <div style={{
        padding: '24px 32px 16px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface)',
      }}>
        <div className="page-header" style={{ marginBottom: '16px' }}>
          <div className="page-header__eyebrow">Busca Semântica + Híbrida</div>
          <h1 className="page-header__title" style={{ fontSize: '18px' }}>O que você quer encontrar?</h1>
        </div>

        {/* Search Input */}
        <div className="search-container" style={{ maxWidth: '100%' }}>
          <Search className="search-input__icon" />
          <input
            ref={inputRef}
            className="search-input selectable"
            type="text"
            placeholder="Ex: receita de bolo que a Maria mandou..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {!query && <span className="search-input__kbd">⌘K</span>}
          {query && (
            <button
              style={{
                position: 'absolute',
                right: '44px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
              }}
              onClick={() => { setQuery(''); setResults([]); setHasSearched(false) }}
            >
              <X size={14} />
            </button>
          )}
          <div
            style={{
              position: 'absolute',
              right: '8px',
              top: '50%',
              transform: 'translateY(-50%)',
              background: isSearching ? 'var(--bg-elevated)' : 'var(--accent-emerald)',
              border: 'none',
              borderRadius: '4px',
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {isSearching
              ? <span className="spinner" style={{ width: '12px', height: '12px' }} />
              : <Search size={12} style={{ color: '#000' }} />
            }
          </div>
        </div>

        {/* Filter row */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginTop: '10px',
        }}>
          <button
            className={`btn btn--ghost ${showFilters ? 'active' : ''}`}
            onClick={() => setShowFilters(v => !v)}
            style={{ fontSize: '11px', padding: '5px 10px', gap: '6px' }}
          >
            <SlidersHorizontal size={12} />
            Filtros
          </button>

          {hasSearched && (
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              color: 'var(--text-muted)',
              marginLeft: 'auto',
            }}>
              {results.length} resultado{results.length !== 1 ? 's' : ''} · ~{searchTime}ms
            </span>
          )}
        </div>

        {/* Filters expanded */}
        {showFilters && (
          <div style={{
            display: 'flex',
            gap: '8px',
            marginTop: '10px',
            padding: '12px',
            background: 'var(--bg-elevated)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-default)',
            animation: 'fadeInUp 0.2s ease',
            flexWrap: 'wrap',
          }}>
            <FilterTag 
              icon={<Filter size={10} />} 
              label={isHybrid ? "Modo: Híbrido" : "Modo: Semântico"} 
              active={true}
              onClick={() => setIsHybrid(!isHybrid)}
            />
            
            <div style={{ width: '1px', background: 'var(--border-subtle)', margin: '0 4px' }} />
            
            <FilterTag 
              icon={<MessageSquare size={10} />} 
              label="Todos os Chats" 
              active={selectedChatId === undefined}
              onClick={() => setSelectedChatId(undefined)}
            />
            {chats.map(chat => (
              <FilterTag 
                key={chat.id}
                icon={<MessageSquare size={10} />} 
                label={chat.name} 
                active={selectedChatId === chat.id}
                onClick={() => setSelectedChatId(chat.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 32px' }}>
        {isSearching ? (
          <SearchingSkeleton />
        ) : hasSearched && results.length === 0 ? (
          <div className="empty-state">
            <Search className="empty-state__icon" />
            <div className="empty-state__title">Nenhum resultado encontrado</div>
            <div className="empty-state__desc">
              Tente outras palavras ou importe mais conversas para ampliar a base de busca.
            </div>
          </div>
        ) : hasSearched ? (
          <div className="stack">
            {results.map((result, i) => (
              <div
                key={result.id}
                className="result-card animate-fade-in-up selectable"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="result-card__header">
                  <span className="result-card__chat">{result.chatName}</span>
                  <span className="result-card__score" style={{ 
                    color: result.score > 0.8 ? 'var(--accent-emerald)' : 'var(--text-muted)' 
                  }}>
                    {(result.score * 100).toFixed(0)}% match
                  </span>
                </div>
                <div
                  className="result-card__content"
                  dangerouslySetInnerHTML={{ __html: highlightText(result.content, debouncedQuery) }}
                />
                <div className="result-card__footer">
                  <span className="result-card__tag">
                    <User size={10} />
                    {result.sender}
                  </span>
                  <span className="result-card__tag">
                    <Calendar size={10} />
                    {result.date}
                  </span>
                  <button
                    className="btn btn--ghost"
                    style={{ marginLeft: 'auto', fontSize: '10px', padding: '3px 8px' }}
                    onClick={() => navigate('chat', result.chatId)}
                  >
                    Perguntar à IA →
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <Search className="empty-state__icon" />
            <div className="empty-state__title">Busca semântica de conversas</div>
            <div className="empty-state__desc">
              Digite qualquer contexto que você lembre — o modelo entende o significado, não apenas palavras exatas.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function FilterTag({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active?: boolean; onClick?: () => void }) {
  return (
    <div 
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        fontFamily: 'var(--font-mono)',
        fontSize: '10px',
        padding: '4px 10px',
        borderRadius: '3px',
        border: `1px solid ${active ? 'rgba(0,217,126,0.3)' : 'var(--border-default)'}`,
        background: active ? 'var(--accent-emerald-subtle)' : 'var(--bg-surface)',
        color: active ? 'var(--accent-emerald)' : 'var(--text-muted)',
        cursor: 'pointer',
        transition: 'all 0.1s ease',
      }}>
      {icon}
      {label}
    </div>
  )
}

function SearchingSkeleton() {
  return (
    <div className="stack">
      {[0, 1, 2].map(i => (
        <div
          key={i}
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 16px',
            opacity: 1 - i * 0.25,
          }}
        >
          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
            <div style={{ height: '8px', width: '80px', background: 'var(--border-strong)', borderRadius: '3px', animation: 'pulse 1.5s ease infinite' }} />
            <div style={{ marginLeft: 'auto', height: '8px', width: '50px', background: 'var(--border-strong)', borderRadius: '3px', animation: 'pulse 1.5s ease 0.3s infinite' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ height: '8px', width: '100%', background: 'var(--border-default)', borderRadius: '3px', animation: 'pulse 1.5s ease 0.1s infinite' }} />
            <div style={{ height: '8px', width: '85%', background: 'var(--border-default)', borderRadius: '3px', animation: 'pulse 1.5s ease 0.2s infinite' }} />
            <div style={{ height: '8px', width: '60%', background: 'var(--border-default)', borderRadius: '3px', animation: 'pulse 1.5s ease 0.3s infinite' }} />
          </div>
        </div>
      ))}
    </div>
  )
}
