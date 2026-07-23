import { lazy, StrictMode, Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import ErrorBoundary from './ErrorBoundary'
import { I18nProvider, resolveLocale, setCurrentLocale } from './i18n'
import Onboarding, { onboardingStorageKey } from './Onboarding'
import {
  applyAppearance,
  loadSettings,
  saveSettings,
  settingsStorageKey,
} from './settings'
import './styles.css'

const App = lazy(() => import('./App'))
const SettingsApp = lazy(() => import('./SettingsApp'))

const initialSettings = loadSettings()
const initialOnboardingOpen = (
  window.location.hash === '#onboarding'
  || window.localStorage.getItem(onboardingStorageKey) !== 'complete'
)
setCurrentLocale(resolveLocale(initialSettings.language))
applyAppearance(initialSettings)

function Root() {
  const [settingsOpen, setSettingsOpen] = useState(window.location.hash === '#settings')
  const [settings, setSettings] = useState(initialSettings)
  const [libraryReady, setLibraryReady] = useState(
    !window.noteDown || initialOnboardingOpen,
  )
  const [libraryMigrationError, setLibraryMigrationError] = useState<Error | null>(null)
  const [onboardingOpen, setOnboardingOpen] = useState(initialOnboardingOpen)
  const locale = resolveLocale(settings.language)

  useEffect(() => {
    if (!window.noteDown || onboardingOpen) {
      setLibraryReady(true)
      setLibraryMigrationError(null)
      return
    }
    let cancelled = false
    const currentSettings = loadSettings()
    setLibraryReady(false)
    setLibraryMigrationError(null)
    void window.noteDown
      .migrateSourceOverlappingLibrary({
        libraryPath: currentSettings.libraryPath,
        attachmentsPath: currentSettings.attachmentsPath,
      })
      .then((migration) => {
        if (cancelled) return
        if (migration && migration.libraryPath !== currentSettings.libraryPath) {
          const nextSettings = { ...currentSettings, libraryPath: migration.libraryPath }
          saveSettings(nextSettings)
          setSettings(nextSettings)
        }
        setLibraryReady(true)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLibraryMigrationError(
            error instanceof Error ? error : new Error('Library migration failed'),
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [onboardingOpen])

  useEffect(() => {
    setCurrentLocale(locale)
    window.noteDown?.setLocale(locale)
  }, [locale])

  useEffect(() => {
    const bridge = window.noteDown
    if (!bridge || !onboardingOpen) return
    return bridge.onBeforeClose(() => bridge.completeClose(true))
  }, [onboardingOpen])

  useEffect(() => {
    const handleHashChange = () => {
      setSettingsOpen(window.location.hash === '#settings')
      if (window.location.hash === '#onboarding') setOnboardingOpen(true)
    }
    const applySettings = () => {
      const nextSettings = loadSettings()
      setCurrentLocale(resolveLocale(nextSettings.language))
      applyAppearance(nextSettings)
      setSettings(nextSettings)
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key === settingsStorageKey) applySettings()
    }
    window.addEventListener('hashchange', handleHashChange)
    window.addEventListener('storage', handleStorage)
    window.addEventListener('note-down:settings-changed', applySettings)
    return () => {
      window.removeEventListener('hashchange', handleHashChange)
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('note-down:settings-changed', applySettings)
    }
  }, [])

  const completeOnboarding = () => {
    window.localStorage.setItem(onboardingStorageKey, 'complete')
    if (window.location.hash === '#onboarding') {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    }
    setOnboardingOpen(false)
  }

  if (libraryMigrationError) throw libraryMigrationError

  return (
    <I18nProvider locale={locale}>
      {!libraryReady ? (
        <div className="settings-loading" aria-busy="true" />
      ) : onboardingOpen ? (
        <Onboarding onComplete={completeOnboarding} />
      ) : (
        <>
          <div className="app-root-layer" hidden={settingsOpen}>
            <Suspense fallback={null}>
              <App key={settings.libraryPath} />
            </Suspense>
          </div>
          {settingsOpen && (
            <Suspense fallback={<div className="settings-loading" />}>
              <SettingsApp />
            </Suspense>
          )}
        </>
      )}
    </I18nProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
)
