import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import {
  Camera,
  Computer,
  FolderOpen,
  Language,
  ShieldTick,
} from 'reicon-react'
import jotkeepMark from '../assets/brand/jotkeep-mark.svg'
import brandFieldPoster from './assets/onboarding/jotkeep-brand-field.png'
import { useI18n } from './i18n'
import {
  defaultSettings,
  loadSettings,
  saveSettings,
  type AppSettings,
} from './settings'
import './onboarding.css'

export const onboardingStorageKey = 'note-down.onboarding.v1'

const totalSteps = 3
const profileStepIndex = 1
const essentialStepIndex = 2
const profileStorageKey = 'note-down.profile.v1'
const emptyOnboardingProfile: NoteDownUserProfile = {
  username: '',
  links: [],
}
const loadOnboardingProfile = () => {
  try {
    const saved = JSON.parse(window.localStorage.getItem(profileStorageKey) || 'null')
    return saved?.username ? saved as NoteDownUserProfile : emptyOnboardingProfile
  } catch {
    return emptyOnboardingProfile
  }
}
const onboardingAppearance = {
  '--onboarding-font': defaultSettings.uiFont,
  '--onboarding-ink': defaultSettings.foregroundColor,
  '--onboarding-paper': defaultSettings.backgroundColor,
  '--onboarding-accent': defaultSettings.accentColor,
} as CSSProperties

const motionIsReduced = () => {
  const setting = document.documentElement.dataset.reduceMotion
  return (
    setting === 'on' ||
    (setting !== 'off' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  )
}

function BrandBackdrop({ subdued }: { subdued: boolean }) {
  return (
    <div
      className={`onboarding-brand-backdrop${subdued ? ' is-subdued' : ''}`}
      aria-hidden
    >
      <img
        className="onboarding-brand-image"
        src={brandFieldPoster}
        alt=""
        decoding="async"
        fetchPriority="high"
      />
      <div className="onboarding-brand-veil" />
    </div>
  )
}

function BrandLockup() {
  return (
    <span className="onboarding-brand-lockup" aria-label="Jotkeep">
      <img src={jotkeepMark} alt="" />
      <span>Jotkeep</span>
    </span>
  )
}

function StepProgress({ current }: { current: number }) {
  const { t } = useI18n()
  const progressSteps = totalSteps - 1

  return (
    <div
      className="onboarding-progress"
      aria-label={t('第 {current} 步，共 {total} 步', {
        current: current + 1,
        total: progressSteps,
      })}
    >
      {Array.from({ length: progressSteps }, (_, index) => (
        <span
          className={index === current ? 'is-active' : ''}
          key={index}
          aria-hidden
        />
      ))}
    </div>
  )
}

function WelcomeStep({
  headingRef,
  onNext,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>
  onNext: () => void
}) {
  const { t } = useI18n()

  return (
    <div className="onboarding-welcome">
      <div className="onboarding-welcome-copy">
        <span className="onboarding-hero-logo" aria-hidden>
          <img src={jotkeepMark} alt="" />
          <i />
        </span>
        <p className="onboarding-kicker">JOT · KEEP · OWN</p>
        <h1 ref={headingRef} tabIndex={-1}>
          Jotkeep
        </h1>
        <p className="onboarding-slogan">{t('所记，皆归于你。')}</p>
        <p className="onboarding-lede">
          {t('一个安静、本地优先的 Markdown 写作空间。内容留在你的 Mac，也始终归你。')}
        </p>
        <button className="onboarding-primary-button is-hero" type="button" onClick={onNext}>
          <span>{t('开始设置 Jotkeep')}</span>
        </button>
      </div>
    </div>
  )
}

type OnboardingSettingKey = 'language' | 'libraryPath' | 'backupEnabled'
type SettingsUpdate = <Key extends OnboardingSettingKey>(
  key: Key,
  value: AppSettings[Key],
) => void

function SetupChoice({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={`onboarding-setup-choice${active ? ' is-active' : ''}`}
      type="button"
      aria-pressed={active}
      onClick={onClick}
    >
      <span>{icon}</span>
      <b>{label}</b>
    </button>
  )
}

function SetupSwitch({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      className={`onboarding-setup-switch${checked ? ' is-active' : ''}`}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}

function EssentialSetupStep({
  chooseLibraryDirectory,
  headingRef,
  notice,
  settings,
  updateSetting,
}: {
  chooseLibraryDirectory: () => void
  headingRef: RefObject<HTMLHeadingElement | null>
  notice: string
  settings: AppSettings
  updateSetting: SettingsUpdate
}) {
  const { t } = useI18n()

  return (
    <div className="onboarding-config-step">
      <section className="onboarding-setup-panel is-essential">
        <header className="onboarding-setup-panel-header">
          <h1 ref={headingRef} tabIndex={-1}>
            {t('核心设置')}
          </h1>
        </header>

        <div className="onboarding-essential-flow">
          <div className="onboarding-language-picker">
            <span className="onboarding-control-label">
              <Language size={15} strokeWidth={1.8} />
              {t('应用语言')}
            </span>
            <div className="onboarding-language-options">
              <SetupChoice
                active={settings.language === 'system'}
                icon={<Computer size={15} />}
                label={t('跟随系统')}
                onClick={() => updateSetting('language', 'system')}
              />
              <SetupChoice
                active={settings.language === 'zh-CN'}
                icon={<span lang="zh-CN">中</span>}
                label={t('简体中文')}
                onClick={() => updateSetting('language', 'zh-CN')}
              />
              <SetupChoice
                active={settings.language === 'en-US'}
                icon={<span lang="en-US">A</span>}
                label="English"
                onClick={() => updateSetting('language', 'en-US')}
              />
            </div>
          </div>

          <button
            className="onboarding-library-choice"
            type="button"
            onClick={chooseLibraryDirectory}
          >
            <FolderOpen size={22} strokeWidth={1.7} />
            <span>
              <small>{t('本地资料库')}</small>
              <b title={settings.libraryPath}>{settings.libraryPath}</b>
            </span>
            <em>
              {t('选择')}
            </em>
          </button>

          <div className="onboarding-backup-choice">
            <ShieldTick size={18} strokeWidth={1.8} />
            <b>{t('自动备份')}</b>
            <SetupSwitch
              checked={settings.backupEnabled}
              label={t('自动备份')}
              onChange={(checked) => updateSetting('backupEnabled', checked)}
            />
          </div>
        </div>

        {notice && (
          <p className="onboarding-setup-notice" role="status">
            {t(notice)}
          </p>
        )}
      </section>
    </div>
  )
}

function ProfileSetupStep({
  chooseAvatar,
  headingRef,
  notice,
  profile,
  updateUsername,
}: {
  chooseAvatar: () => void
  headingRef: RefObject<HTMLHeadingElement | null>
  notice: string
  profile: NoteDownUserProfile
  updateUsername: (username: string) => void
}) {
  const { t } = useI18n()

  return (
    <div className="onboarding-config-step">
      <section className="onboarding-setup-panel is-profile">
        <h1 className="onboarding-visually-hidden" ref={headingRef} tabIndex={-1}>
          {t('个人资料')}
        </h1>

        <div className="onboarding-profile-editor">
          <button
            className="onboarding-avatar-button"
            type="button"
            aria-label={t('选择头像')}
            onClick={chooseAvatar}
          >
            <span className={profile.avatarURL ? '' : 'is-default'}>
              {profile.avatarURL ? (
                <img src={profile.avatarURL} alt="" />
              ) : (
                <img
                  className="onboarding-default-avatar-mark"
                  src={jotkeepMark}
                  alt=""
                />
              )}
            </span>
            <i>
              <Camera size={14} strokeWidth={1.9} />
            </i>
          </button>

          <label className="onboarding-username-field">
            <span className="onboarding-visually-hidden">{t('用户名')}</span>
            <input
              type="text"
              value={profile.username}
              maxLength={48}
              placeholder={t('输入你的名字')}
              aria-label={t('用户名')}
              onChange={(event) => updateUsername(event.target.value)}
            />
          </label>
        </div>

        {notice && (
          <p className="onboarding-setup-notice" role="status">
            {t(notice)}
          </p>
        )}
      </section>
    </div>
  )
}

export default function Onboarding({
  onComplete,
}: {
  onComplete: () => void
}) {
  const { t } = useI18n()
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward')
  const [settings, setSettings] = useState(loadSettings)
  const [notice, setNotice] = useState('')
  const [profile, setProfile] = useState<NoteDownUserProfile>(loadOnboardingProfile)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const shellRef = useRef<HTMLElement>(null)

  const goTo = useCallback((nextStep: number) => {
    setDirection(nextStep > step ? 'forward' : 'backward')
    setStep(nextStep)
  }, [step])

  useEffect(() => {
    window.requestAnimationFrame(() => headingRef.current?.focus())
  }, [step])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 2600)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const profileIsReady = (
        step !== profileStepIndex
        || Boolean(profile.username.trim())
      )
      if (event.key === 'ArrowRight' && step < totalSteps - 1 && profileIsReady) {
        event.preventDefault()
        goTo(step + 1)
      }
      if (event.key === 'ArrowLeft' && step > 0) {
        event.preventDefault()
        goTo(step - 1)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [goTo, profile.username, step])

  useEffect(() => {
    let animationFrame = 0
    let pointerX = 0
    let pointerY = 0
    const handlePointerMove = (event: globalThis.PointerEvent) => {
      const shell = shellRef.current
      if (!shell || motionIsReduced() || animationFrame) return
      pointerX = event.clientX
      pointerY = event.clientY
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0
        shell.style.setProperty(
          '--pointer-x',
          (pointerX / window.innerWidth - 0.5).toFixed(3),
        )
        shell.style.setProperty(
          '--pointer-y',
          (pointerY / window.innerHeight - 0.5).toFixed(3),
        )
      })
    }
    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    return () => {
      window.cancelAnimationFrame(animationFrame)
      window.removeEventListener('pointermove', handlePointerMove)
    }
  }, [])

  const updateSetting: SettingsUpdate = (key, value) => {
    const next = { ...loadSettings(), [key]: value }
    saveSettings(next)
    setSettings(next)
  }

  const chooseLibraryDirectory = async () => {
    if (!window.noteDown?.chooseDirectory) {
      setNotice('请在桌面应用中选择本地资料库。')
      return
    }
    try {
      const path = await window.noteDown.chooseDirectory()
      if (path) updateSetting('libraryPath', path)
    } catch {
      setNotice('无法选择资料库，请重试。')
    }
  }

  const chooseProfileAvatar = async () => {
    if (!window.noteDown?.chooseProfileAvatar) {
      setNotice('头像选择需要在 Mac App 中使用。')
      return
    }
    try {
      const avatar = await window.noteDown.chooseProfileAvatar({
        libraryPath: settings.libraryPath,
      })
      if (avatar) setProfile((current) => ({ ...current, ...avatar }))
    } catch {
      setNotice('头像保存失败，请选择 20 MB 以内的图片。')
    }
  }

  const finishOnboarding = () => {
    const username = profile.username.trim()
    if (!username) {
      setNotice('请输入用户名。')
      return
    }

    window.localStorage.setItem(profileStorageKey, JSON.stringify({
      ...profile,
      username,
      links: profile.links,
    }))
    onComplete()
  }

  const setupStep = step === profileStepIndex ? (
    <ProfileSetupStep
      chooseAvatar={() => void chooseProfileAvatar()}
      headingRef={headingRef}
      notice={notice}
      profile={profile}
      updateUsername={(username) => setProfile((current) => ({ ...current, username }))}
    />
  ) : step === essentialStepIndex ? (
    <EssentialSetupStep
      chooseLibraryDirectory={() => void chooseLibraryDirectory()}
      headingRef={headingRef}
      notice={notice}
      settings={settings}
      updateSetting={updateSetting}
    />
  ) : null

  return (
    <section
      className="onboarding-shell"
      data-step={step}
      ref={shellRef}
      role="dialog"
      style={onboardingAppearance}
      aria-modal="true"
      aria-label={t('首次使用引导')}
    >
      <BrandBackdrop subdued={step > 0} />
      <header className="onboarding-topbar">
        <BrandLockup />
        {step > 0 && <StepProgress current={step - 1} />}
        {step > 0 && (
          <button
            className="onboarding-skip"
            type="button"
            onClick={onComplete}
          >
            {t('稍后设置')}
          </button>
        )}
      </header>

      <main
        className="onboarding-stage"
        data-direction={direction}
        key={`${step}-${direction}`}
      >
        {step === 0 ? (
          <WelcomeStep
            headingRef={headingRef}
            onNext={() => goTo(profileStepIndex)}
          />
        ) : (
          setupStep
        )}
      </main>

      {step > 0 && (
        <footer className="onboarding-controls">
          <button
            className="onboarding-primary-button"
            type="button"
            disabled={
              (
                step === profileStepIndex
                && !profile.username.trim()
              )
              || (
                step === essentialStepIndex
                && !profile.username.trim()
              )
            }
            onClick={() => {
              if (step === totalSteps - 1) finishOnboarding()
              else goTo(step + 1)
            }}
          >
            <span>
              {step === totalSteps - 1
                ? t('完成并进入 Jotkeep')
                : t('继续')}
            </span>
          </button>
          <button
            className="onboarding-back-button"
            type="button"
            onClick={() => goTo(step - 1)}
          >
            <span>{t('上一步')}</span>
          </button>
        </footer>
      )}
    </section>
  )
}
