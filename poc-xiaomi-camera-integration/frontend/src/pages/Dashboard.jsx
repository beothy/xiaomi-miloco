/**
 * Copyright (C) 2025 Xiaomi Corporation
 * This software may be used and distributed according to the terms of the Xiaomi Miloco License Agreement.
 */

import React, { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import CameraList from '../components/CameraList.jsx'

const styles = {
  page: {
    minHeight: '100vh',
    background: '#f0f2f5',
  },
  header: {
    background: 'white',
    boxShadow: '0 1px 4px rgba(0,0,0,.08)',
    padding: '0 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 60,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  logo: {
    fontSize: 28,
  },
  appName: {
    fontSize: 18,
    fontWeight: 700,
    color: '#1a1a2e',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  },
  userInfo: {
    fontSize: 14,
    color: '#555',
  },
  logoutBtn: {
    padding: '6px 16px',
    background: 'transparent',
    border: '1px solid #d9d9d9',
    borderRadius: 6,
    fontSize: 14,
    color: '#555',
    cursor: 'pointer',
  },
  content: {
    maxWidth: 1200,
    margin: '0 auto',
    padding: '24px 16px',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 600,
    color: '#1a1a2e',
    marginBottom: 16,
  },
  refreshBtn: {
    padding: '6px 16px',
    background: '#1677ff',
    color: 'white',
    border: 'none',
    borderRadius: 6,
    fontSize: 14,
    marginLeft: 12,
    cursor: 'pointer',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    marginBottom: 20,
  },
  errorBox: {
    background: '#fff2f0',
    border: '1px solid #ffccc7',
    borderRadius: 8,
    padding: '12px 16px',
    color: '#ff4d4f',
    marginBottom: 16,
    fontSize: 14,
  },
}

/**
 * Dashboard page – shows discovered cameras and allows viewing streams.
 *
 * @param {Object} props
 * @param {Function} props.onLogout - Called when user logs out.
 */
const Dashboard = ({ onLogout }) => {
  const [user, setUser] = useState(null)
  const [cameras, setCameras] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [statusRes, camerasRes] = await Promise.all([
        axios.get('/api/auth/status'),
        axios.get('/api/cameras'),
      ])
      if (statusRes.data.authenticated) {
        setUser(statusRes.data.user)
      }
      setCameras(camerasRes.data.cameras || [])
    } catch (err) {
      const msg = err.response?.data?.detail || err.message
      setError(`Failed to load data: ${msg}`)
      if (err.response?.status === 401) {
        onLogout()
      }
    } finally {
      setLoading(false)
    }
  }, [onLogout])

  useEffect(() => {
    loadData()
  }, [loadData])

  return (
    <div style={styles.page}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.logo}>📷</span>
          <span style={styles.appName}>Xiaomi Camera PoC</span>
        </div>
        <div style={styles.headerRight}>
          {user && (
            <span style={styles.userInfo}>
              👤 {user.nickname || user.uid}
            </span>
          )}
          <button style={styles.logoutBtn} onClick={onLogout}>
            Logout
          </button>
        </div>
      </header>

      {/* Main content */}
      <main style={styles.content}>
        <div style={styles.titleRow}>
          <h2 style={styles.sectionTitle}>
            My Cameras
            {!loading && <span style={{ fontSize: 14, fontWeight: 400, color: '#888', marginLeft: 8 }}>
              ({cameras.length} found)
            </span>}
          </h2>
          <button style={styles.refreshBtn} onClick={loadData} disabled={loading}>
            {loading ? 'Refreshing...' : '↻ Refresh'}
          </button>
        </div>

        {error && <div style={styles.errorBox}>{error}</div>}

        <CameraList cameras={cameras} loading={loading} />
      </main>
    </div>
  )
}

export default Dashboard
