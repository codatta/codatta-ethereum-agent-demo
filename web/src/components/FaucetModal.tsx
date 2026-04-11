import { useState } from 'react'
import { useAccount } from 'wagmi'
import { THEME, styles } from '../lib/theme'
import { ENV } from '../config/env'

export function FaucetModal({ onClose }: { onClose: () => void }) {
  const { address } = useAccount()
  const [inputAddr, setInputAddr] = useState(address || '')
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<{ txHash?: string; amount?: string; error?: string } | null>(null)

  async function handleClaim() {
    if (!inputAddr) return
    setStatus('sending')
    setResult(null)
    try {
      const res = await fetch(`${ENV.INVITE_SERVICE_URL}/faucet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: inputAddr }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setResult(data)
      setStatus('done')
    } catch (err: any) {
      setResult({ error: err.message })
      setStatus('error')
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={onClose}>
      <div style={{ background: THEME.surface, borderRadius: THEME.radiusCardLarge, border: THEME.border, boxShadow: THEME.shadowDeep, width: 420, padding: 24 }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, letterSpacing: -0.5 }}>Faucet</h3>
        <p style={{ margin: '0 0 16px', fontSize: 14, color: THEME.textSecondary }}>
          Get test ETH for contract interactions.
        </p>

        <label>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4, color: THEME.textSecondary }}>Wallet Address</span>
          <input
            value={inputAddr}
            onChange={e => setInputAddr(e.target.value)}
            placeholder="0x..."
            style={{ ...styles.input, fontFamily: 'monospace', fontSize: 13 }}
            disabled={status === 'sending'}
          />
        </label>

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button
            onClick={handleClaim}
            disabled={!inputAddr || status === 'sending'}
            style={{ ...styles.btnPrimary, flex: 1, opacity: !inputAddr || status === 'sending' ? 0.5 : 1 }}
          >
            {status === 'sending' ? 'Sending...' : 'Claim 1 ETH'}
          </button>
          <button onClick={onClose} style={styles.btnSecondary}>
            Close
          </button>
        </div>

        {status === 'done' && result && (
          <div style={{ marginTop: 12, padding: 12, background: 'rgba(26,174,57,0.06)', borderRadius: 8, fontSize: 13 }}>
            <p style={{ margin: 0, color: THEME.success, fontWeight: 600 }}>Sent {result.amount}</p>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: THEME.textMuted, fontFamily: 'monospace', wordBreak: 'break-all' }}>
              tx: {result.txHash}
            </p>
          </div>
        )}

        {status === 'error' && result && (
          <div style={{ marginTop: 12, padding: 12, background: 'rgba(221,91,0,0.06)', borderRadius: 8, fontSize: 13 }}>
            <p style={{ margin: 0, color: THEME.danger }}>{result.error}</p>
          </div>
        )}
      </div>
    </div>
  )
}
