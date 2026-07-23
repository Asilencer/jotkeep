import { Component, type ErrorInfo, type ReactNode } from 'react'
import { translate as t } from './i18n'

type ErrorBoundaryState = {
  error: Error | null
}

export default class ErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Renderer failed', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="renderer-error" role="alert">
        <div className="renderer-error-card">
          <span aria-hidden>!</span>
          <strong>{t('应用遇到问题')}</strong>
          <p>{t('你的本地内容没有被删除。重新载入后可以继续使用。')}</p>
          <button type="button" onClick={() => window.location.reload()}>
            {t('重新载入')}
          </button>
        </div>
      </main>
    )
  }
}
