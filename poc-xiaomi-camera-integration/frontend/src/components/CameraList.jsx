/**
 * Copyright (C) 2025 Xiaomi Corporation
 * This software may be used and distributed according to the terms of the Xiaomi Miloco License Agreement.
 */

import React, { useState } from 'react'
import VideoPlayer from './VideoPlayer.jsx'

const STATUS_LABELS = {
  1: { label: 'Disconnected', color: '#8c8c8c' },
  2: { label: 'Connecting', color: '#faad14' },
  3: { label: 'Reconnecting', color: '#fa8c16' },
  4: { label: 'Connected', color: '#52c41a' },
  5: { label: 'Error', color: '#ff4d4f' },
}

const styles = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
    gap: 20,
  },
  card: {
    background: 'white',
    borderRadius: 12,
    boxShadow: '0 2px 8px rgba(0,0,0,.07)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  cardHeader: {
    padding: '14px 16px 10px',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  cameraName: {
    fontSize: 15,
    fontWeight: 600,
    color: '#1a1a2e',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  badge: {
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 10,
    color: 'white',
    flexShrink: 0,
  },
  meta: {
    padding: '0 16px 10px',
    fontSize: 12,
    color: '#888',
    display: 'flex',
    gap: 12,
    flexWrap: 'wrap',
  },
  videoWrapper: {
    position: 'relative',
    background: '#000',
    aspectRatio: '16/9',
    overflow: 'hidden',
  },
  placeholder: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#555',
    gap: 8,
    fontSize: 14,
  },
  placeholderIcon: {
    fontSize: 36,
    opacity: 0.5,
  },
  cardFooter: {
    padding: '10px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  controlsRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTop: '1px solid #f0f0f0',
    paddingTop: 10,
  },
  channelInfo: {
    fontSize: 12,
    color: '#aaa',
  },
  buttonGroup: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  playBtn: {
    padding: '6px 20px',
    borderRadius: 6,
    border: 'none',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background 0.2s',
  },
  ptzGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 32px)',
    gap: 3,
    alignItems: 'center',
    justifyItems: 'center',
  },
  ptzButton: {
    width: 32,
    height: 32,
    borderRadius: 4,
    border: 'none',
    background: '#1677ff',
    color: 'white',
    cursor: 'pointer',
    fontSize: 13,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background 0.2s',
    userSelect: 'none',
  },
  emptyState: {
    textAlign: 'center',
    padding: '64px 0',
    color: '#aaa',
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  skeleton: {
    background: '#f5f5f5',
    borderRadius: 12,
    height: 240,
    animation: 'pulse 1.5s ease-in-out infinite',
  },
  loadingGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
    gap: 20,
  },
}

/**
 * CameraCard – shows info and optional video player for a single camera.
 */
const CameraCard = ({ camera }) => {
  const [playing, setPlaying] = useState(false)
  const [channel, setChannel] = useState(0)
  const [isEnabled, setIsEnabled] = useState(true)
  const [togglingPower, setTogglingPower] = useState(false)
  const [ptzLoading, setPtzLoading] = useState(false)

  const handleTogglePower = async () => {
    setTogglingPower(true)
    try {
      // Try guard mode (siid=2, piid=1) - common for camera on/off
      const newValue = !isEnabled
      const response = await fetch(
        `/api/devices/${camera.did}/prop/set`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            siid: 2,
            piid: 1,
            value: newValue,
          }),
        }
      )
      
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setIsEnabled(newValue)
          console.log(`Camera ${camera.name} turned ${newValue ? 'on' : 'off'}`)
        } else {
          alert(`Failed to toggle: ${JSON.stringify(data.result)}`)
        }
      } else {
        alert(`Error: ${response.status} ${response.statusText}`)
      }
    } catch (error) {
      console.error('Failed to toggle camera power:', error)
      alert(`Error toggling camera: ${error.message}`)
    } finally {
      setTogglingPower(false)
    }
  }

  const handlePTZAction = async (direction) => {
    setPtzLoading(true)
    try {
      // Common PTZ action: siid=5, aiid=1 for pan/tilt
      // direction: 0=left, 1=right, 2=up, 3=down
      const response = await fetch(
        `/api/devices/${camera.did}/action`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            siid: 5,
            aiid: 1,
            in_: [{ piid: 1, value: direction }],
          }),
        }
      )

      if (!response.ok) {
        console.warn(`PTZ action failed: ${response.status}`)
      }
    } catch (error) {
      console.error(`PTZ action error: ${error.message}`)
    } finally {
      setPtzLoading(false)
    }
  }
  
  const statusInfo = STATUS_LABELS[camera.camera_status] || { label: 'Unknown', color: '#8c8c8c' }
  const isOnline = camera.online

  return (
    <div style={styles.card}>
      {/* Header */}
      <div style={styles.cardHeader}>
        <span style={styles.cameraName} title={camera.name}>{camera.name}</span>
        <span
          style={{
            ...styles.badge,
            background: isOnline ? '#52c41a' : '#ff4d4f',
          }}
        >
          {isOnline ? 'Online' : 'Offline'}
        </span>
      </div>

      {/* Meta info */}
      <div style={styles.meta}>
        <span>📍 {camera.room_name || camera.home_name || '—'}</span>
        <span>📡 {camera.model}</span>
        {camera.local_ip && <span>🌐 {camera.local_ip}</span>}
        <span style={{ color: statusInfo.color }}>● {statusInfo.label}</span>
      </div>

      {/* Video area */}
      <div style={styles.videoWrapper}>
        {playing ? (
          <VideoPlayer
            cameraId={camera.did}
            channel={channel}
            onStop={() => setPlaying(false)}
          />
        ) : (
          <div style={styles.placeholder}>
            <span style={styles.placeholderIcon}>🎥</span>
            <span>{isOnline ? 'Click Play to start stream' : 'Camera offline'}</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={styles.cardFooter}>
        <div style={styles.controlsRow}>
          <span style={styles.channelInfo}>
            {camera.channel_count > 1
              ? `Channel ${channel + 1} / ${camera.channel_count}`
              : `${camera.channel_count} channel`}
          </span>
          <div style={styles.buttonGroup}>
            {camera.channel_count > 1 && !playing && (
              <select
                value={channel}
                onChange={(e) => setChannel(Number(e.target.value))}
                style={{ fontSize: 12, padding: '2px 6px', borderRadius: 4, border: '1px solid #d9d9d9' }}
              >
                {Array.from({ length: camera.channel_count }, (_, i) => (
                  <option key={i} value={i}>Channel {i + 1}</option>
                ))}
              </select>
            )}
            <button
              style={{
                ...styles.playBtn,
                background: isEnabled ? '#52c41a' : '#ff4d4f',
                color: 'white',
                opacity: togglingPower ? 0.6 : 1,
              }}
              onClick={handleTogglePower}
              disabled={togglingPower}
              title={isEnabled ? 'Turn camera off' : 'Turn camera on'}
            >
              {togglingPower ? '...' : (isEnabled ? '🟢 On' : '⭕ Off')}
            </button>
            <button
              style={{
                ...styles.playBtn,
                background: playing ? '#ff4d4f' : (isOnline ? '#1677ff' : '#d9d9d9'),
                color: 'white',
              }}
              onClick={() => setPlaying(!playing)}
              disabled={!isOnline && !playing}
            >
              {playing ? '■ Stop' : '▶ Play'}
            </button>
          </div>
        </div>

        {/* PTZ Controls */}
        <div style={{ paddingTop: 8, borderTop: '1px solid #f0f0f0' }}>
          <div style={{ fontSize: 11, color: '#aaa', marginBottom: 6 }}>Move Camera</div>
          <div style={styles.ptzGrid}>
            {/* Empty spacer */}
            <div />
            {/* Up */}
            <button
              style={styles.ptzButton}
              onMouseEnter={(e) => (e.target.style.background = '#0958d9')}
              onMouseLeave={(e) => (e.target.style.background = '#1677ff')}
              onClick={() => handlePTZAction(2)}
              disabled={ptzLoading}
              title="Tilt Up"
            >
              ⬆️
            </button>
            {/* Empty spacer */}
            <div />

            {/* Left */}
            <button
              style={styles.ptzButton}
              onMouseEnter={(e) => (e.target.style.background = '#0958d9')}
              onMouseLeave={(e) => (e.target.style.background = '#1677ff')}
              onClick={() => handlePTZAction(0)}
              disabled={ptzLoading}
              title="Pan Left"
            >
              ⬅️
            </button>
            {/* Center - Reset */}
            <button
              style={{ ...styles.ptzButton, background: '#595959' }}
              onMouseEnter={(e) => (e.target.style.background = '#434343')}
              onMouseLeave={(e) => (e.target.style.background = '#595959')}
              onClick={() => handlePTZAction(4)}
              disabled={ptzLoading}
              title="Reset Position"
            >
              ⊕
            </button>
            {/* Right */}
            <button
              style={styles.ptzButton}
              onMouseEnter={(e) => (e.target.style.background = '#0958d9')}
              onMouseLeave={(e) => (e.target.style.background = '#1677ff')}
              onClick={() => handlePTZAction(1)}
              disabled={ptzLoading}
              title="Pan Right"
            >
              ➡️
            </button>

            {/* Empty spacer */}
            <div />
            {/* Down */}
            <button
              style={styles.ptzButton}
              onMouseEnter={(e) => (e.target.style.background = '#0958d9')}
              onMouseLeave={(e) => (e.target.style.background = '#1677ff')}
              onClick={() => handlePTZAction(3)}
              disabled={ptzLoading}
              title="Tilt Down"
            >
              ⬇️
            </button>
            {/* Empty spacer */}
            <div />
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * CameraList – renders a grid of CameraCards with loading/empty states.
 *
 * @param {Object} props
 * @param {Array} props.cameras - List of camera info objects.
 * @param {boolean} props.loading - Whether cameras are being loaded.
 */
const CameraList = ({ cameras, loading }) => {
  if (loading) {
    return (
      <div style={styles.loadingGrid}>
        {[1, 2, 3].map((i) => (
          <div key={i} style={styles.skeleton} />
        ))}
      </div>
    )
  }

  if (!cameras.length) {
    return (
      <div style={styles.emptyState}>
        <div style={styles.emptyIcon}>📷</div>
        <p style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>No cameras found</p>
        <p style={{ margin: '8px 0 0', fontSize: 13 }}>
          Make sure your Xiaomi cameras are added to Xiaomi Home.
        </p>
      </div>
    )
  }

  return (
    <div style={styles.grid}>
      {cameras.map((camera) => (
        <CameraCard key={camera.did} camera={camera} />
      ))}
    </div>
  )
}

export default CameraList
