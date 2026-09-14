import { Component, useEffect, useRef, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react'
import type { InstanceStatus, NavigateOptions, WidgetHandle } from '../context'
import type { PlatformError } from '../errors'
import { usePlatform } from './context'

export interface MfeWidgetProps<Props = unknown> {
  id: string
  contract: number
  props: Props
  on?: Record<string, (payload: never) => void>
  fallback?: 'skeleton' | 'hidden' | ((error: PlatformError) => void)
  className?: string
  /** Rendered while loading when `fallback` is `'skeleton'`. */
  skeleton?: ReactNode
  /** Rendered when the widget fails. */
  onFailed?: ReactNode
}

/** §29.1: `<MfeWidget id contract props on fallback />`. Props changes call `update`; `on` handlers are read live. */
export function MfeWidget<Props>({ id, contract, props, on, fallback, className, skeleton, onFailed }: MfeWidgetProps<Props>) {
  const platform = usePlatform()
  const element = useRef<HTMLDivElement>(null)
  const handleRef = useRef<WidgetHandle<Props> | undefined>(undefined)
  const onRef = useRef(on)
  onRef.current = on
  const [status, setStatus] = useState<InstanceStatus>('loading')
  const [error, setError] = useState<PlatformError | undefined>()
  const initialProps = useRef(props)

  useEffect(() => {
    const el = element.current
    if (!el) return
    const controller = new AbortController()
    let handle: WidgetHandle<Props> | undefined
    const forwarded = new Proxy({} as Record<string, (p: never) => void>, {
      get: (_t, event: string) => (payload: never) => onRef.current?.[event]?.(payload),
      has: (_t, event: string) => !!onRef.current?.[event],
    })
    platform.widgets
      .mount<Props>({ id, contract, element: el, props: initialProps.current, on: forwarded, signal: controller.signal, fallback })
      .then(h => {
        if (controller.signal.aborted) return h.unmount()
        handle = h
        handleRef.current = h
        setStatus(h.status.get())
        h.status.subscribe(s => {
          setStatus(s)
          if (s === 'failed') setError(h.error)
        }, { signal: controller.signal })
      })
      .catch((e: PlatformError) => {
        setStatus('failed')
        setError(e)
        if (typeof fallback === 'function') fallback(e)
      })
    return () => {
      controller.abort()
      handle?.unmount()
      handleRef.current = undefined
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, id, contract])

  useEffect(() => {
    if (props !== initialProps.current) handleRef.current?.update(props)
  }, [props])

  const hidden = fallback === 'hidden' && status !== 'ready'
  return (
    <>
      {status === 'loading' && fallback === 'skeleton' ? (skeleton ?? <div className="mfe-widget-skeleton" aria-busy="true" />) : null}
      {status === 'failed' ? (onFailed ?? <div role="alert" className="mfe-widget-failed">{error?.message ?? 'Widget failed'}</div>) : null}
      <div ref={element} className={className} data-mfe-widget={id} hidden={hidden || status === 'failed'} />
    </>
  )
}

export interface PlatformLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>, Pick<NavigateOptions, 'to' | 'params' | 'search' | 'replace'> {
  children?: ReactNode
}

/** §25: renders the right href and navigates through the platform. */
export function PlatformLink({ to, params, search, replace, onClick, children, ...rest }: PlatformLinkProps) {
  const platform = usePlatform()
  const href = platform.navigation.href({ to, params, search })
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    void platform.navigation.navigate({ to, params, search, replace })
  }
  return (
    <a href={href} onClick={handleClick} {...rest}>
      {children}
    </a>
  )
}

interface ErrorBoundaryProps {
  onError(error: unknown, info?: { fatal?: boolean }): void
  fallback?: ReactNode
  children: ReactNode
}

/** §15: errors inside MFE code reach `ctx.reportError`; render errors are fatal for the subtree. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override componentDidCatch(error: unknown) {
    this.props.onError(error, { fatal: true })
  }
  override render() {
    if (this.state.failed) return this.props.fallback ?? null
    return this.props.children
  }
}
