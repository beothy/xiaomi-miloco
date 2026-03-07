/**
 * Copyright (C) 2025 Xiaomi Corporation
 * This software may be used and distributed according to the terms of the Xiaomi Miloco License Agreement.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import axios from 'axios'

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  },
  card: {
    background: 'white',
    borderRadius: 16,
    padding: '48px 56px',
    boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
    textAlign: 'center',
    maxWidth: 420,
    width: '100%',
  },
  logo: {
    fontSize: 48,
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    color: '#1a1a2e',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    marginBottom: 32,
  },
  button: {
    width: '100%',
    padding: '14px 0',
    background: '#ff6900',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 0.2s',
  },
  buttonDisabled: {
    background: '#ccc',
    cursor: 'not-allowed',
  },
  status: {
    marginTop: 20,
    fontSize: 13,
    color: '#888',
    minHeight: 20,
  },
  errorText: {
    color: '#ff4d4f',
  },
  helper: {
    marginTop: 16,
    textAlign: 'left',
    fontSize: 13,
    color: '#555',
    lineHeight: 1.4,
  },
  input: {
    width: '100%',
    marginTop: 10,
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #ddd',
    fontSize: 13,
    boxSizing: 'border-box',
  },
  regionSelector: {
    marginTop: 20,
    textAlign: 'left',
  },
  regionLabel: {
    display: 'block',
    fontSize: 14,
    fontWeight: 500,
    color: '#1a1a2e',
    marginBottom: 8,
  },
  regionSelect: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #ddd',
    fontSize: 13,
    boxSizing: 'border-box',
    cursor: 'pointer',
  },
  secondaryButton: {
    width: '100%',
    marginTop: 10,
    padding: '10px 0',
    background: '#1a1a2e',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  ghostButton: {
    width: '100%',
    marginTop: 10,
    padding: '10px 0',
    background: 'white',
    color: '#1a1a2e',
    border: '1px solid #1a1a2e',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
}

/**
 * Login page – opens Xiaomi Home OAuth2 flow in a popup window.
 *
 * @param {Object} props
 * @param {Function} props.onLogin - Called when login succeeds.
 */
const Login = ({ onLogin }) => {
  const [loading, setLoading] = useState(false)
  const [manualLoading, setManualLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [error, setError] = useState(false)
  const [manualRedirectUrl, setManualRedirectUrl] = useState('')
  const [showManualHelper, setShowManualHelper] = useState(false)
  const [region, setRegion] = useState('cn') // Add region selection state
  const popupRef = useRef(null)

  // Supported regions
  const regions = [
    { code: 'cn', name: '🇨🇳 China' },
    { code: 'de', name: '🇩🇪 Europe' },
    { code: 'us', name: '🇺🇸 United States' },
    { code: 'ru', name: '🇷🇺 Russia' },
    { code: 'tw', name: '🇹🇼 Taiwan' },
    { code: 'sg', name: '🇸🇬 Singapore' },
    { code: 'in', name: '🇮🇳 India' },
    { code: 'i2', name: '🌍 International' },
  ]

  const exchangeCodeState = useCallback(
    async (code, state) => {
      await axios.post('/api/auth/exchange', { code, state, region })
      setStatusMsg('Login successful! Redirecting...')
      setError(false)
      setShowManualHelper(false)
      onLogin()
    },
    [onLogin, region],
  )

  const parseCodeStateFromUrl = useCallback((rawUrl) => {
    if (!rawUrl) {
      return null
    }
    try {
      const parsed = new URL(rawUrl.trim())
      const code = parsed.searchParams.get('code')
      const state = parsed.searchParams.get('state')
      if (!code || !state) {
        return null
      }
      return { code, state }
    } catch {
      return null
    }
  }, [])

  const tryCompleteFromClipboard = useCallback(async () => {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      return false
    }
    try {
      const clipText = await navigator.clipboard.readText()
      const parsed = parseCodeStateFromUrl(clipText)
      if (!parsed) {
        return false
      }
      setManualLoading(true)
      setStatusMsg('Detected redirect URL in clipboard. Completing login...')
      setError(false)
      await exchangeCodeState(parsed.code, parsed.state)
      return true
    } catch {
      return false
    } finally {
      setManualLoading(false)
    }
  }, [exchangeCodeState, parseCodeStateFromUrl])

  // Listen for postMessage from the OAuth callback popup
  useEffect(() => {
    const handleMessage = (event) => {
      if (event.data?.type === 'XIAOMI_LOGIN_SUCCESS') {
        setLoading(false)
        setStatusMsg('Login successful! Redirecting...')
        setError(false)
        onLogin()
      } else if (event.data?.type === 'XIAOMI_LOGIN_FAILED') {
        setLoading(false)
        setStatusMsg(`Login failed: ${event.data.error || 'Unknown error'}`)
        setError(true)
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [onLogin])

  const handleLogin = useCallback(async () => {
    setLoading(true)
    setShowManualHelper(false)
    setStatusMsg('Fetching login URL...')
    setError(false)
    try {
      const res = await axios.get('/api/auth/login_url', { params: { region } })
      const { login_url } = res.data
      if (!login_url) {
        throw new Error('No login URL returned from server')
      }
      // Open OAuth2 authorization page in a popup
      const popup = window.open(
        login_url,
        'xiaomi_login',
        'width=500,height=700,menubar=no,toolbar=no,location=yes,status=no',
      )
      popupRef.current = popup
      setStatusMsg('Waiting for Xiaomi Home authorization...')

      // Poll for popup close without postMessage (e.g. user closed it)
      const timer = setInterval(() => {
        if (!popup || popup.closed) {
          clearInterval(timer)
          const completeAfterClose = async () => {
            setLoading(false)
            const autoDone = await tryCompleteFromClipboard()
            if (autoDone) {
              return
            }
            setStatusMsg('Popup closed. Paste the full redirected URL below to finish login.')
            setError(true)
            setShowManualHelper(true)
          }
          completeAfterClose()
        }
      }, 500)
    } catch (err) {
      setLoading(false)
      setStatusMsg(`Error: ${err.response?.data?.detail || err.message}`)
      setError(true)
    }
  }, [region])

  const handleManualExchange = useCallback(async () => {
    const parsed = parseCodeStateFromUrl(manualRedirectUrl)
    if (!manualRedirectUrl.trim()) {
      setStatusMsg('Paste the full redirected URL from the popup first.')
      setError(true)
      return
    }
    if (!parsed) {
      setStatusMsg('The URL does not contain code/state. Make sure it is the final redirected URL.')
      setError(true)
      return
    }

    setManualLoading(true)
    setStatusMsg('Exchanging authorization code...')
    setError(false)
    try {
      await exchangeCodeState(parsed.code, parsed.state)
    } catch (err) {
      setStatusMsg(`Exchange failed: ${err.response?.data?.detail || err.message}`)
      setError(true)
    } finally {
      setManualLoading(false)
    }
  }, [manualRedirectUrl, parseCodeStateFromUrl, exchangeCodeState])

  const handleClipboardExchange = useCallback(async () => {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      setStatusMsg('Clipboard API is not available in this browser.')
      setError(true)
      return
    }

    setManualLoading(true)
    setStatusMsg('Reading redirect URL from clipboard...')
    setError(false)
    try {
      const clipText = await navigator.clipboard.readText()
      const parsed = parseCodeStateFromUrl(clipText)
      if (!parsed) {
        setStatusMsg('Clipboard does not contain a valid redirected URL with code/state.')
        setError(true)
        return
      }
      await exchangeCodeState(parsed.code, parsed.state)
    } catch (err) {
      setStatusMsg(`Clipboard read failed: ${err.message}`)
      setError(true)
    } finally {
      setManualLoading(false)
    }
  }, [parseCodeStateFromUrl, exchangeCodeState])

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>📷</div>
        <h1 style={styles.title}>Xiaomi Camera</h1>
        <p style={styles.subtitle}>
          Sign in with your Xiaomi Home account to view your cameras.
        </p>
        <div style={styles.regionSelector}>
          <label style={styles.regionLabel}>Select Region</label>
          <select
            style={styles.regionSelect}
            value={region}
            onChange={(event) => setRegion(event.target.value)}
            disabled={loading || manualLoading}
          >
            {regions.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <button
          style={{ ...styles.button, ...(loading ? styles.buttonDisabled : {}), marginTop: 16 }}
          onClick={handleLogin}
          disabled={loading}
        >
          {loading ? 'Waiting for authorization...' : 'Login with Xiaomi Home'}
        </button>
        <p style={{ ...styles.status, ...(error ? styles.errorText : {}) }}>
          {statusMsg}
        </p>
        {showManualHelper && (
          <div style={styles.helper}>
            Xiaomi redirects to <code>https://127.0.0.1/?code=...&amp;state=...</code>.
            If that page fails to open, copy the full URL from the popup address bar and paste it below.
            <input
              style={styles.input}
              type="text"
              placeholder="https://127.0.0.1/?code=...&state=..."
              value={manualRedirectUrl}
              onChange={(event) => setManualRedirectUrl(event.target.value)}
            />
            <button
              style={{
                ...styles.ghostButton,
                ...(manualLoading ? styles.buttonDisabled : {}),
              }}
              onClick={handleClipboardExchange}
              disabled={manualLoading}
            >
              {manualLoading ? 'Reading Clipboard...' : 'Use URL from Clipboard'}
            </button>
            <button
              style={{
                ...styles.secondaryButton,
                ...(manualLoading ? styles.buttonDisabled : {}),
              }}
              onClick={handleManualExchange}
              disabled={manualLoading}
            >
              {manualLoading ? 'Exchanging...' : 'Complete Login from Redirect URL'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default Login
