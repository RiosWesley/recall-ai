import type { ProfileFact } from '../../../shared/types'
import { TermStats, TOPIC_LABELS } from './StatsGenerator'

export function buildProfileFacts(
  contactName: string,
  contactId: string,
  termStats: TermStats[],
  topicCounts: Map<string, number>,
  totalChunks: number
): Omit<ProfileFact, 'id'>[] {
  const facts: Omit<ProfileFact, 'id'>[] = []

  // 1. Facts from frequent terms
  const topTerms = termStats.slice(0, 20) // Only top 20
  
  for (const term of topTerms) {
    // Who uses it the most?
    const topSender = Object.entries(term.countBySender)
      .sort((a, b) => b[1] - a[1])[0]

    const firstSeenDate = new Date(term.firstSeen * 1000).toLocaleDateString('pt-BR')
    const lastSeenDate = new Date(term.lastSeen * 1000).toLocaleDateString('pt-BR')

    facts.push({
      contact_id: contactId,
      text: `O assunto ou termo "${term.term}" é mencionado frequentemente na conversa com ${contactName}. Apareceu ${term.totalCount} vezes. ${topSender[0]} é quem mais fala sobre "${term.term}" (${topSender[1]} vezes). Período de citação: ${firstSeenDate} a ${lastSeenDate}. Exemplo na conversa: ${term.sampleMessages[0]}`,
      evidence: term.totalCount,
      category: 'frequent_term'
    })
  }

  // 2. Facts from topic probes
  for (const [topic, count] of topicCounts.entries()) {
    if (count < 2) continue // ignore sparse/accidental ones
    
    const pct = ((count / totalChunks) * 100).toFixed(0)
    const label = TOPIC_LABELS[topic]

    facts.push({
      contact_id: contactId,
      text: `${contactName} e o usuário conversam ativamente sobre ${label}. Este assunto apareceu em aproximadamente ${pct}% das conversas (${count} de ${totalChunks} agrupamentos).`,
      evidence: count,
      category: 'topic'
    })
  }

  // 3. Co-occurrences
  const coOccurrences = findCoOccurrences(termStats)
  for (const co of coOccurrences.slice(0, 5)) { // Max 5 co-occurrence rules
    facts.push({
      contact_id: contactId,
      text: `"${co.termA}" e "${co.termB}" são assuntos que aparecem juntos frequentemente na conversa com ${contactName}. Isso ocorreu ${co.count} vezes diferentes em períodos similares.`,
      evidence: co.count,
      category: 'co_occurrence'
    })
  }

  return facts
}

// A simple heuristic to compute if two n-grams share a lot of the same temporal space or messages
function findCoOccurrences(termStats: TermStats[]) {
  const pairs: { termA: string; termB: string; count: number }[] = []
  
  const candidateTerms = termStats.slice(0, 15)
  for (let i = 0; i < candidateTerms.length; i++) {
    for (let j = i + 1; j < candidateTerms.length; j++) {
      const a = candidateTerms[i]
      const b = candidateTerms[j]
      
      // Simple Overlap via sample messages check is poor but we can check if they share words or first/last seen
      let overlapCount = 0
      for (const msgA of a.sampleMessages) {
        for (const msgB of b.sampleMessages) {
           if (msgA === msgB) overlapCount++
        }
      }

      // If they overlap strongly and aren't substrings of each other
      if (overlapCount > 0 && !a.term.includes(b.term) && !b.term.includes(a.term)) {
         pairs.push({ termA: a.term, termB: b.term, count: overlapCount })
      }
    }
  }

  return pairs.sort((a, b) => b.count - a.count)
}
