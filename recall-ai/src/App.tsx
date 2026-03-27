import { useState } from 'react'
import TitleBar from './components/layout/TitleBar'
import Sidebar from './components/layout/Sidebar'
import HomePage from './pages/Home'
import ImportPage from './pages/Import'
import SearchPage from './pages/Search'
import ChatPage from './pages/Chat'
import SettingsPage from './pages/Settings'

export type Page = 'home' | 'import' | 'search' | 'chat' | 'settings'

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>('home')
  const [activeChatId, setActiveChatId] = useState<string | null>(null)

  const navigate = (page: Page, chatId?: string) => {
    setCurrentPage(page)
    if (chatId) setActiveChatId(chatId)
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'home': return <HomePage navigate={navigate} />
      case 'import': return <ImportPage navigate={navigate} />
      case 'search': return <SearchPage navigate={navigate} activeChatId={activeChatId} />
      case 'chat': return <ChatPage navigate={navigate} chatId={activeChatId} />
      case 'settings': return <SettingsPage />
      default: return <HomePage navigate={navigate} />
    }
  }

  return (
    <div className="app-shell">
      <TitleBar currentPage={currentPage} />
      <Sidebar currentPage={currentPage} navigate={navigate} />
      <main className="main-content">
        {renderPage()}
      </main>
    </div>
  )
}
