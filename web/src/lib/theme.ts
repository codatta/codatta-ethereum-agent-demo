/**
 * Design System — Notion-inspired
 * Source: DESIGN.md
 */
export const THEME = {
  // Surfaces
  canvas: "#ffffff",
  warmWhite: "#f6f5f4",
  surface: "#ffffff",

  // Text (warm, not pure black)
  textPrimary: "rgba(0,0,0,0.95)",
  textSecondary: "#615d59",
  textMuted: "#a39e98",
  warmDark: "#31302e",

  // Accent
  blue: "#0075de",
  blueHover: "#005bab",
  blueFocus: "#097fe8",
  badgeBlueBg: "#f2f9ff",
  badgeBlueText: "#097fe8",

  // Semantic
  success: "#1aae39",
  teal: "#2a9d99",
  danger: "#dd5b00",
  pink: "#ff64c8",

  // Borders & Shadows
  border: "1px solid rgba(0,0,0,0.1)",
  shadowCard: "rgba(0,0,0,0.04) 0px 4px 18px, rgba(0,0,0,0.027) 0px 2.025px 7.85px, rgba(0,0,0,0.02) 0px 0.8px 2.93px, rgba(0,0,0,0.01) 0px 0.175px 1.04px",
  shadowDeep: "rgba(0,0,0,0.01) 0px 1px 3px, rgba(0,0,0,0.02) 0px 3px 7px, rgba(0,0,0,0.02) 0px 7px 15px, rgba(0,0,0,0.04) 0px 14px 28px, rgba(0,0,0,0.05) 0px 23px 52px",

  // Radii
  radiusButton: 4,
  radiusInput: 4,
  radiusCard: 12,
  radiusCardLarge: 16,
  radiusPill: 9999,

  // Font
  fontFamily: '"Inter", -apple-system, system-ui, "Segoe UI", Helvetica, Arial, sans-serif',
} as const

// Reusable style objects
export const styles = {
  card: {
    background: THEME.surface,
    borderRadius: THEME.radiusCard,
    border: THEME.border,
    boxShadow: THEME.shadowCard,
    padding: 20,
  } as React.CSSProperties,

  cardHover: {
    background: THEME.surface,
    borderRadius: THEME.radiusCard,
    border: THEME.border,
    boxShadow: THEME.shadowCard,
    padding: 20,
    cursor: "pointer",
    transition: "box-shadow 0.2s",
  } as React.CSSProperties,

  section: {
    background: THEME.surface,
    borderRadius: THEME.radiusCard,
    border: THEME.border,
    boxShadow: THEME.shadowCard,
    padding: 20,
    marginTop: 16,
  } as React.CSSProperties,

  btnPrimary: {
    padding: "8px 16px",
    borderRadius: THEME.radiusButton,
    border: "1px solid transparent",
    background: THEME.blue,
    color: "#ffffff",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    transition: "background 0.15s",
  } as React.CSSProperties,

  btnSecondary: {
    padding: "8px 16px",
    borderRadius: THEME.radiusButton,
    border: "1px solid transparent",
    background: "rgba(0,0,0,0.05)",
    color: THEME.textPrimary,
    fontSize: 15,
    fontWeight: 500,
    cursor: "pointer",
  } as React.CSSProperties,

  btnDanger: {
    padding: "8px 16px",
    borderRadius: THEME.radiusButton,
    border: "1px solid transparent",
    background: "rgba(221,91,0,0.08)",
    color: THEME.danger,
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
  } as React.CSSProperties,

  btnSuccess: {
    padding: "8px 16px",
    borderRadius: THEME.radiusButton,
    border: "1px solid transparent",
    background: "rgba(26,174,57,0.08)",
    color: THEME.success,
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
  } as React.CSSProperties,

  input: {
    width: "100%",
    padding: "6px 10px",
    borderRadius: THEME.radiusInput,
    border: "1px solid #dddddd",
    fontSize: 14,
    boxSizing: "border-box" as const,
    fontFamily: THEME.fontFamily,
    color: "rgba(0,0,0,0.9)",
  } as React.CSSProperties,

  badge: (color: string) => ({
    padding: "4px 8px",
    borderRadius: THEME.radiusPill,
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.125px",
    color,
    background: `${color}12`,
  }) as React.CSSProperties,

  badgeBlue: {
    padding: "4px 8px",
    borderRadius: THEME.radiusPill,
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.125px",
    color: THEME.badgeBlueText,
    background: THEME.badgeBlueBg,
  } as React.CSSProperties,

  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
  } as React.CSSProperties,

  th: {
    textAlign: "left" as const,
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 500,
    color: THEME.textMuted,
    borderBottom: THEME.border,
  } as React.CSSProperties,

  td: {
    padding: "8px 12px",
    fontSize: 14,
    borderBottom: "1px solid rgba(0,0,0,0.05)",
    color: THEME.textPrimary,
  } as React.CSSProperties,

  mono: {
    fontFamily: "monospace",
    fontSize: 13,
  } as React.CSSProperties,

  code: {
    display: "block",
    padding: "14px 16px",
    background: THEME.warmDark,
    color: "#d4d4d4",
    borderRadius: THEME.radiusCard,
    fontSize: 13,
    lineHeight: 1.5,
    overflow: "auto",
    margin: "8px 0",
    fontFamily: "monospace",
  } as React.CSSProperties,
}
