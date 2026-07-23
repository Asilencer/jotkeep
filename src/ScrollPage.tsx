import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'

type MinimapMarker = {
  id: string
  label: string
}

type MinimapState = {
  activeId: string
  markers: MinimapMarker[]
}

type MinimapTooltipState = {
  label: string
  top: number
}

function ScrollSpyMinimap({ scrollRef }: { scrollRef: RefObject<HTMLDivElement | null> }) {
  const [state, setState] = useState<MinimapState>({ activeId: '', markers: [] })
  const [scrubbing, setScrubbing] = useState(false)
  const [tooltip, setTooltip] = useState<MinimapTooltipState | null>(null)
  const frameRef = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)
  const minimapRef = useRef<HTMLElement>(null)
  const scrubbedRef = useRef(false)
  const scrubIdRef = useRef<string | null>(null)

  const measure = useCallback(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const anchors = [...scroller.querySelectorAll<HTMLElement>('[data-minimap-anchor]')]
    if (anchors.length === 0) {
      setState((current) => (current.markers.length ? { activeId: '', markers: [] } : current))
      return
    }

    const scrollerBox = scroller.getBoundingClientRect()
    const referenceLine = scroller.scrollTop + 16
    let activeId = anchors[0]?.dataset.minimapAnchor ?? ''
    const markers = anchors.map((anchor, index) => {
      const box = anchor.getBoundingClientRect()
      const anchorTop = box.top - scrollerBox.top + scroller.scrollTop
      const id = anchor.dataset.minimapAnchor || `anchor-${index}`
      if (anchorTop <= referenceLine) activeId = id
      return {
        id,
        label: anchor.dataset.minimapLabel || `第 ${index + 1} 节`,
      }
    })
    if (
      scroller.scrollHeight > scroller.clientHeight + 2 &&
      scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2
    ) {
      activeId = anchors[anchors.length - 1]?.dataset.minimapAnchor ?? activeId
    }
    setState({ activeId, markers })
  }, [scrollRef])

  const scheduleMeasure = useCallback(() => {
    window.cancelAnimationFrame(frameRef.current)
    frameRef.current = window.requestAnimationFrame(measure)
  }, [measure])

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const resizeObserver = new ResizeObserver(scheduleMeasure)
    const mutationObserver = new MutationObserver(scheduleMeasure)
    resizeObserver.observe(scroller)
    mutationObserver.observe(scroller, { childList: true, subtree: true, characterData: true })
    scroller.addEventListener('scroll', scheduleMeasure, { passive: true })
    window.addEventListener('resize', scheduleMeasure)
    scheduleMeasure()
    return () => {
      window.cancelAnimationFrame(frameRef.current)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      scroller.removeEventListener('scroll', scheduleMeasure)
      window.removeEventListener('resize', scheduleMeasure)
    }
  }, [scheduleMeasure, scrollRef])

  useEffect(() => {
    const list = listRef.current
    const active = list?.querySelector<HTMLElement>(
      `[data-minimap-id="${CSS.escape(state.activeId)}"]`,
    )
    if (!list || !active) return
    if (active.offsetTop < list.scrollTop) list.scrollTop = active.offsetTop
    if (active.offsetTop + active.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = active.offsetTop + active.offsetHeight - list.clientHeight
    }
  }, [state.activeId])

  const jumpTo = (id: string, behavior?: ScrollBehavior) => {
    const scroller = scrollRef.current
    const anchor = scroller?.querySelector<HTMLElement>(`[data-minimap-anchor="${id}"]`)
    if (!scroller || !anchor) return
    setState((current) =>
      current.activeId === id ? current : { ...current, activeId: id },
    )
    const scrollerBox = scroller.getBoundingClientRect()
    const anchorTop = anchor.getBoundingClientRect().top - scrollerBox.top + scroller.scrollTop
    scroller.scrollTo({
      top: Math.max(0, anchorTop - 16),
      behavior:
        behavior ?? (document.documentElement.dataset.reduceMotion === 'on' ? 'auto' : 'smooth'),
    })
  }

  const findPointerMarker = (event: ReactPointerEvent<HTMLElement>) => {
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-minimap-id]')
    return target && listRef.current?.contains(target) ? target.dataset.minimapId : undefined
  }

  const finishScrubbing = (event: ReactPointerEvent<HTMLElement>) => {
    scrubIdRef.current = null
    setScrubbing(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const showTooltip = (label: string, target: HTMLElement) => {
    const minimap = minimapRef.current
    if (!minimap) return
    const rowBox = target.getBoundingClientRect()
    const minimapBox = minimap.getBoundingClientRect()
    setTooltip({
      label,
      top: rowBox.top - minimapBox.top + rowBox.height / 2,
    })
  }

  if (state.markers.length === 0) return null

  return (
    <nav
      ref={minimapRef}
      className={`content-minimap${scrubbing ? ' is-scrubbing' : ''}`}
      aria-label="正文位置"
    >
      <div
        className="content-minimap-list"
        ref={listRef}
        onScroll={() => setTooltip(null)}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          const id = findPointerMarker(event)
          if (!id) return
          event.preventDefault()
          scrubIdRef.current = id
          scrubbedRef.current = false
          setScrubbing(true)
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (!scrubIdRef.current || event.buttons % 2 === 0) return
          const id = findPointerMarker(event)
          if (!id || id === scrubIdRef.current) return
          scrubIdRef.current = id
          scrubbedRef.current = true
          jumpTo(id, 'auto')
        }}
        onPointerUp={finishScrubbing}
        onPointerCancel={(event) => {
          scrubbedRef.current = false
          finishScrubbing(event)
        }}
      >
        {state.markers.map((marker) => {
          const active = marker.id === state.activeId
          return (
            <button
              className={`content-minimap-row${active ? ' is-active' : ''}`}
              type="button"
              key={marker.id}
              data-minimap-id={marker.id}
              aria-current={active ? 'location' : undefined}
              aria-label={`前往：${marker.label}`}
              onPointerEnter={(event) => showTooltip(marker.label, event.currentTarget)}
              onPointerLeave={() => setTooltip(null)}
              onFocus={(event) => showTooltip(marker.label, event.currentTarget)}
              onBlur={() => setTooltip(null)}
              onClick={() => {
                if (scrubbedRef.current) {
                  scrubbedRef.current = false
                  return
                }
                jumpTo(marker.id)
              }}
            >
              <span className="content-minimap-marker" aria-hidden />
            </button>
          )
        })}
      </div>
      {tooltip && !scrubbing && (
        <span
          className="content-minimap-tooltip is-visible"
          style={{ top: tooltip.top }}
          aria-hidden
        >
          {tooltip.label}
        </span>
      )}
    </nav>
  )
}

export default function ScrollPage({
  className,
  fullHeight = false,
  children,
}: {
  className: string
  fullHeight?: boolean
  children: ReactNode
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  return (
    <div className={`scroll-page-shell${fullHeight ? ' is-full-height' : ''}`}>
      <div className={`page-scroll ${className}`} ref={scrollRef}>
        {children}
      </div>
      <ScrollSpyMinimap scrollRef={scrollRef} />
    </div>
  )
}
