import { t } from '@/i18n'
import { useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { useLibraryState, useServerEvents } from '@/api/hooks'
import { useUi } from '@/store'
import { OfflineBanner } from './OfflineBanner'
import { Sidebar } from './Sidebar'
import { Toolbar } from './Toolbar'
import { Timeline } from '@/features/library/Timeline'
import { Viewer } from '@/features/viewer/Viewer'
import { Welcome } from '@/features/onboarding/Welcome'
import { Settings } from '@/features/settings/Settings'
import { Toasts } from '@/components/Toasts'
import { UpdateNotice } from '@/features/settings/Updates'
import { ConfirmHost } from '@/components/Confirm'
import { PromptHost } from '@/components/Prompt'
import { SmartAlbumEditor } from '@/features/albums/SmartAlbumEditor'
import { ExportDialog } from '@/features/export/ExportDialog'
import { CleanupPage } from '@/features/cleanup/CleanupPage'
import { PeoplePage } from '@/features/people/PeoplePage'
import { PlacesPage } from '@/features/places/PlacesPage'
import { MemoriesPage } from '@/features/memories/MemoriesPage'
import { MemoryBook } from '@/features/memories/MemoryBook'
import { RetroDialog } from '@/features/retro/RetroDialog'
import { ShareDialog } from '@/features/share/ShareDialog'
import { Editor } from '@/features/editor/Editor'
import { VideoEditor } from '@/features/editor/VideoEditor'

function useTheme(): void {
  const theme = useUi((s) => s.theme)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches)
      document.documentElement.classList.toggle('dark', dark)
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
}

const printTarget = /^memory:(\d+)$/.exec(new URLSearchParams(location.search).get('print') ?? '')

export function App() {
  useTheme()
  if (printTarget) return <MemoryBook id={Number(printTarget[1])} printMode />
  return <MainApp />
}

function MainApp() {
  const { jobs, scanning } = useServerEvents()
  const { data, isLoading, error } = useLibraryState()
  const viewerOpen = useUi((s) => s.viewerIndex !== null)
  const page = useUi((s) => s.page)
  const memoryId = useUi((s) => s.memoryId)

  if (error) {
    return (
      <div className="grid h-full place-items-center p-8 text-center text-[13px] text-muted">
        <div>
          <p className="font-semibold text-fg">{t('Impossible de joindre la photothèque.')}</p>
          <p className="mt-1">{(error as Error).message}</p>
        </div>
      </div>
    )
  }
  if (isLoading || !data) {
    return (
      <div className="drag grid h-full place-items-center">
        <Loader2 className="size-6 animate-spin text-faint" />
      </div>
    )
  }
  if (data.sources.length === 0) return <Welcome />

  return (
    <div className="flex h-full">
      <Sidebar jobs={jobs} scanning={scanning} />
      <main className="relative min-w-0 flex-1">
        {page === 'cleanup' ? (
          <CleanupPage />
        ) : page === 'people' ? (
          <PeoplePage />
        ) : page === 'places' ? (
          <PlacesPage />
        ) : page === 'memories' ? (
          <MemoriesPage />
        ) : (
          <>
            <Toolbar />
            <Timeline />
            <OfflineBanner />
          </>
        )}
      </main>
      {memoryId !== null && <MemoryBook id={memoryId} />}
      {viewerOpen && <Viewer />}
      <Settings />
      <Toasts />
      <UpdateNotice />
      <ConfirmHost />
      <PromptHost />
      <SmartAlbumEditor />
      <ExportDialog />
      <Editor />
      <RetroDialog />
      <ShareDialog />
      <VideoEditor />
    </div>
  )
}
