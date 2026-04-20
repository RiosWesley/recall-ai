import { nanoid } from 'nanoid'
import type { PendingMention } from '../../shared/types'

export class PendingMentionsManager {
  private static instance: PendingMentionsManager
  private queue: PendingMention[] = []

  private constructor() {}

  public static getInstance(): PendingMentionsManager {
    if (!PendingMentionsManager.instance) {
      PendingMentionsManager.instance = new PendingMentionsManager()
    }
    return PendingMentionsManager.instance
  }

  public addMention(sessionId: string, alias: string, context: string | null): PendingMention {
    const mention: PendingMention = {
      id: nanoid(),
      sessionId,
      alias,
      context,
      timestamp: Date.now()
    }
    this.queue.push(mention)
    return mention
  }

  public getPending(): PendingMention[] {
    return [...this.queue]
  }

  public getMentionById(id: string): PendingMention | undefined {
    return this.queue.find(m => m.id === id)
  }

  public removeMention(id: string): void {
    this.queue = this.queue.filter(m => m.id !== id)
  }

  /**
   * If there are clones (same alias) of an approved/resolved mention, we can auto-resolve them too.
   * This method extracts all clones from the queue so they can be processed by the caller.
   */
  public extractClones(alias: string): PendingMention[] {
    const cleanAlias = alias.trim().toLowerCase()
    const clones = this.queue.filter(m => m.alias.trim().toLowerCase() === cleanAlias)
    // Remove them from the queue
    this.queue = this.queue.filter(m => m.alias.trim().toLowerCase() !== cleanAlias)
    return clones
  }

  public clear(): void {
    this.queue = []
  }
}
