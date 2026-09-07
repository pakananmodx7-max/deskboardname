import { AppRouter } from '@/app/router'
import { ToastProvider } from '@/components/ui/toast'
import { DemoClassroomProvider } from '@/demo/demo-context'

function App() {
  return (
    <DemoClassroomProvider>
      <ToastProvider>
        <AppRouter />
      </ToastProvider>
    </DemoClassroomProvider>
  )
}

export default App
