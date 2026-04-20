import { ipcMain } from 'electron'
import { DatabaseService } from '../db/database'
import { PersonRepository } from '../db/repositories/PersonRepository'
import { PendingMentionsManager } from '../services/PendingMentionsManager'
import type { MentionResolutionAction } from '../../shared/types'

const COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', 
  '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899'
]

function getRandomColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)]
}

export function registerPeopleHandlers() {
  const inbox = PendingMentionsManager.getInstance()

  ipcMain.handle('mentions:get_pending', async () => {
    return inbox.getPending()
  })

  ipcMain.handle('mentions:resolve', async (_event, mentionId: string, action: MentionResolutionAction, personId?: string) => {
    const mention = inbox.getMentionById(mentionId)
    if (!mention) {
      throw new Error(`Mention ${mentionId} not found in pending inbox.`)
    }

    const db = DatabaseService.getInstance()
    const repo = new PersonRepository(db)

    // Pull out all identical aliases from the queue so we don't ask the user twice for the exact same name
    const clones = inbox.extractClones(mention.alias)
    
    // Include the original mention in the list to process
    const allToProcess = [mention, ...clones.filter(c => c.id !== mention.id)]

    try {
      if (action === 'create_new') {
        const newPersonId = repo.createPersonWithAlias(mention.alias, mention.alias, getRandomColor())
        // Link all clones to this new person
        for (const item of allToProcess) {
          repo.linkMention(item.sessionId, newPersonId, item.context)
        }
      } 
      else if (action === 'link_existing') {
        if (!personId) throw new Error('personId required for link_existing')
        
        // Ensure the alias is mapped to this existing person for future auto-resolution
        // We'll run a quick insert to person_aliases here
        db.prepare(`INSERT OR IGNORE INTO person_aliases (person_id, alias) VALUES (?, ?)`).run(personId, mention.alias)
        
        for (const item of allToProcess) {
          repo.linkMention(item.sessionId, personId, item.context)
        }
      }
      else if (action === 'ignore') {
        // Do nothing, just let them be removed from the inbox
      }

      // If success, they are already removed from the inbox via extractClones
      // but just to be sure we remove the original one if it slipped
      inbox.removeMention(mentionId)
    } catch (error) {
      console.error('[PeopleHandlers] Failed to resolve mention:', error)
      throw error
    }
  })
}
