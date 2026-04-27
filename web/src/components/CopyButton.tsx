import { useState, type CSSProperties } from 'react'
import { THEME } from '../lib/theme'

interface CopyButtonProps {
  text: string
  title?: string
  /** Render variant — subtle for light backgrounds, onDark for code blocks. */
  variant?: 'subtle' | 'onDark'
  style?: CSSProperties
  className?: string
}

/**
 * Unified copy-to-clipboard icon button. Shows a brief check on success.
 * Replaces the various inline `Copy` / `copy` text buttons scattered across pages.
 */
export function CopyButton({ text, title = 'Copy', variant = 'subtle', style, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const onClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    e.preventDefault()
    navigator.clipboard.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const color =
    copied ? THEME.success
    : variant === 'onDark' ? 'rgba(255,255,255,0.65)'
    : THEME.textMuted
  const hoverColor = copied ? THEME.success : THEME.blue

  return (
    <button
      type="button"
      onClick={onClick}
      title={copied ? 'Copied' : title}
      aria-label={copied ? 'Copied' : title}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 22,
        height: 22,
        padding: 0,
        border: 'none',
        background: 'transparent',
        color,
        cursor: 'pointer',
        borderRadius: 4,
        flexShrink: 0,
        transition: 'color 0.15s',
        ...style,
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = hoverColor }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = color }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  )
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
