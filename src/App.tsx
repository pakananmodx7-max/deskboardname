import { AppRouter } from '@/app/router'
import { ToastProvider } from '@/components/ui/toast'
import { DemoClassroomProvider } from '@/demo/demo-context'
import { OfflineBanner } from '@/features/pwa/offline-banner'
import { PwaUpdatePrompt } from '@/features/pwa/pwa-update-prompt'

function App() {
  return (
    <DemoClassroomProvider>
      <ToastProvider>
        <AppRouter />
        <OfflineBanner />
        <PwaUpdatePrompt />
      </ToastProvider>
    </DemoClassroomProvider>
  )
}

export default App
