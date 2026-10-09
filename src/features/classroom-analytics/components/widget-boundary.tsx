import { Component, type ErrorInfo, type ReactNode } from 'react'

import { SectionError } from './analytics-card'

interface WidgetBoundaryProps {
  /** Thai name of the widget, shown in the fallback. */
  title: string
  children: ReactNode
}

interface WidgetBoundaryState {
  failed: boolean
}

/**
 * Error boundary around one dashboard widget: a rendering bug in one card
 * shows a contained message with "ลองใหม่" instead of blanking the whole
 * dashboard. Data-loading errors are handled by each widget's own
 * resource (SectionBody); this only catches unexpected render errors.
 */
export class WidgetBoundary extends Component<WidgetBoundaryProps, WidgetBoundaryState> {
  state: WidgetBoundaryState = { failed: false }

  static getDerivedStateFromError(): WidgetBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[dashboard] ${this.props.title} failed to render`, error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <section aria-label={this.props.title} className="flex min-h-40 flex-col rounded-2xl border border-border bg-card p-4 shadow-soft sm:p-5">
        <SectionError message={`แสดงส่วน “${this.props.title}” ไม่สำเร็จ`} onRetry={() => this.setState({ failed: false })} />
      </section>
    )
  }
}
