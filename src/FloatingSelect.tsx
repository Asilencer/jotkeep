import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'reicon-react'

export type FloatingSelectOption = {
  value: string
  label: string
  leading?: ReactNode
}

type FloatingSelectProps = {
  label: string
  value: string
  options: FloatingSelectOption[]
  disabled?: boolean
  className?: string
  minMenuWidth?: number
  onChange: (value: string) => void
}

export default function FloatingSelect({
  label,
  value,
  options,
  disabled,
  className = '',
  minMenuWidth = 160,
  onChange,
}: FloatingSelectProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0, width: minMenuWidth })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()
  const selected = options.find((option) => option.value === value) ?? options[0]

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const width = Math.min(
      Math.max(rect.width, minMenuWidth),
      Math.max(120, window.innerWidth - 16),
    )
    const estimatedHeight = Math.min(options.length * 32 + 8, 248)
    const below = window.innerHeight - rect.bottom - 8
    const placeAbove = below < Math.min(estimatedHeight, 160) && rect.top > below
    const top = placeAbove
      ? Math.max(8, rect.top - estimatedHeight - 6)
      : Math.min(window.innerHeight - estimatedHeight - 8, rect.bottom + 6)
    const left = Math.min(
      Math.max(8, rect.left),
      Math.max(8, window.innerWidth - width - 8),
    )
    setPosition({ left, top: Math.max(8, top), width })
  }, [minMenuWidth, options.length])

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
    requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLElement>('[aria-selected="true"]')
        ?.focus({ preventScroll: true })
    })
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', updatePosition)
    document.addEventListener('scroll', updatePosition, true)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', updatePosition)
      document.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, updatePosition])

  return (
    <>
      <button
        ref={triggerRef}
        className={`floating-select${className ? ` ${className}` : ''}`}
        type="button"
        contentEditable={false}
        aria-label={label}
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="floating-select-current">
          {selected?.leading}
          <span>{selected?.label ?? ''}</span>
        </span>
        <ChevronDown size={13} strokeWidth={1.9} aria-hidden />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          id={listboxId}
          className="floating-select-menu"
          role="listbox"
          aria-label={label}
          style={{ left: position.left, top: position.top, width: position.width }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === value}
              key={option.value}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
                triggerRef.current?.focus()
              }}
              onKeyDown={(event) => {
                const items = Array.from(
                  menuRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [],
                )
                const index = items.indexOf(event.currentTarget)
                const direction = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
                if (!direction || items.length === 0) return
                event.preventDefault()
                items[(index + direction + items.length) % items.length]?.focus()
              }}
            >
              <span>
                {option.leading}
                <span>{option.label}</span>
              </span>
              {option.value === value && <Check size={14} strokeWidth={2} aria-hidden />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
