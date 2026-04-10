/**
 * XNY Design System tokens
 * Source: xny-rules-doc.md
 */
export const THEME = {
  // Surfaces
  canvas: "#F5F5F5",
  surface: "#FFFFFF",

  // Text
  textPrimary: "#070707",
  textSecondary: "#6B7280",
  textMuted: "#9CA3AF",

  // Accents
  accentOrange: "#FFA800",
  accentOrangeLight: "rgba(255,168,0,0.10)",
  accentBlue: "#3474FE",
  accentBlueLight: "rgba(52,116,254,0.08)",

  // Actions
  btnPrimary: "#070707",
  btnPrimaryHover: "#1A1A1A",
  danger: "#EF4444",
  success: "#22C55E",

  // Elevation
  shadowCard: "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)",
  shadowCardHover: "0 4px 12px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)",

  // Radii
  radiusCard: 16,
  radiusButton: 12,
  radiusInput: 12,

  // Font
  fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
} as const

// Reusable style objects
export const styles = {
  card: {
    background: THEME.surface,
    borderRadius: THEME.radiusCard,
    boxShadow: THEME.shadowCard,
    padding: 20,
  } as React.CSSProperties,

  cardHover: {
    background: THEME.surface,
    borderRadius: THEME.radiusCard,
    boxShadow: THEME.shadowCardHover,
    padding: 20,
    cursor: "pointer",
    transition: "box-shadow 0.2s",
  } as React.CSSProperties,

  btnPrimary: {
    padding: "10px 24px",
    borderRadius: THEME.radiusButton,
    border: "none",
    background: THEME.btnPrimary,
    color: THEME.surface,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  } as React.CSSProperties,

  btnSecondary: {
    padding: "8px 16px",
    borderRadius: THEME.radiusButton,
    border: "none",
    background: THEME.canvas,
    color: THEME.textPrimary,
    fontSize: 13,
    cursor: "pointer",
  } as React.CSSProperties,

  btnDanger: {
    padding: "8px 16px",
    borderRadius: THEME.radiusButton,
    border: "none",
    background: "rgba(239,68,68,0.08)",
    color: THEME.danger,
    fontSize: 12,
    cursor: "pointer",
  } as React.CSSProperties,

  btnSuccess: {
    padding: "8px 16px",
    borderRadius: THEME.radiusButton,
    border: "none",
    background: "rgba(34,197,94,0.08)",
    color: THEME.success,
    fontSize: 12,
    cursor: "pointer",
  } as React.CSSProperties,

  input: {
    width: "100%",
    padding: "10px 14px",
    borderRadius: THEME.radiusInput,
    border: "1px solid #E5E7EB",
    fontSize: 14,
    boxSizing: "border-box" as const,
    fontFamily: THEME.fontFamily,
  } as React.CSSProperties,

  badge: (color: string) => ({
    padding: "3px 10px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 500,
    color,
    background: `${color}15`,
  }) as React.CSSProperties,

  section: {
    background: THEME.surface,
    borderRadius: THEME.radiusCard,
    boxShadow: THEME.shadowCard,
    padding: 20,
    marginTop: 16,
  } as React.CSSProperties,

  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
  } as React.CSSProperties,

  th: {
    textAlign: "left" as const,
    padding: "8px 12px",
    fontSize: 12,
    color: THEME.textMuted,
    borderBottom: "1px solid #F3F4F6",
    fontWeight: 500,
  } as React.CSSProperties,

  td: {
    padding: "8px 12px",
    fontSize: 14,
    borderBottom: "1px solid #F9FAFB",
    color: THEME.textPrimary,
  } as React.CSSProperties,

  mono: {
    fontFamily: "monospace",
    fontSize: 12,
  } as React.CSSProperties,

  code: {
    display: "block",
    padding: "12px 16px",
    background: "#1E1E1E",
    color: "#D4D4D4",
    borderRadius: 12,
    fontSize: 12,
    lineHeight: 1.5,
    overflow: "auto",
    margin: "8px 0",
    fontFamily: "monospace",
  } as React.CSSProperties,
}
