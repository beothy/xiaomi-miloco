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
}

/**
 * Login page – opens Xiaomi Home OAuth2 flow in a popup window.
 *
 * @param {Object} props
 * @param {Function} props.onLogin - Called when login succeeds.
 */
const Login = ({ onLogin }) => {
  const [loading, setLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [error, setError] = useState(false)
  const popupRef = useRef(null)

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
    setStatusMsg('Fetching login URL...')
    setError(false)
    try {
      const res = await axios.get('/api/auth/login_url')
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
          if (loading) {
            setLoading(false)
            setStatusMsg('Popup closed. Please try again.')
            setError(true)
          }
        }
      }, 500)
    } catch (err) {
      setLoading(false)
      setStatusMsg(`Error: ${err.response?.data?.detail || err.message}`)
      setError(true)
    }
  }, [loading])

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>📷</div>
        <h1 style={styles.title}>Xiaomi Camera</h1>
        <p style={styles.subtitle}>
          Sign in with your Xiaomi Home account to view your cameras.
        </p>
        <button
          style={{ ...styles.button, ...(loading ? styles.buttonDisabled : {}) }}
          onClick={handleLogin}
          disabled={loading}
        >
          {loading ? 'Waiting for authorization...' : 'Login with Xiaomi Home'}
        </button>
        <p style={{ ...styles.status, ...(error ? styles.errorText : {}) }}>
          {statusMsg}
        </p>
      </div>
    </div>
  )
}

export default Login
