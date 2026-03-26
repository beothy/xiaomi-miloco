import React, { useState, useEffect } from 'react'
import VideoPlayer from './VideoPlayer.jsx'
import CameraPropertiesPanel from './CameraPropertiesPanel.jsx'

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
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  cameraName: {
    fontSize: 15,
    fontWeight: 600,
    color: '#1a1a2e',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  onlineStatus: {
    fontSize: 11,
    fontWeight: 600,
    flexShrink: 0,
  },
  toggleTrack: {
    width: 44,
    height: 24,
    borderRadius: 12,
    border: 'none',
    cursor: 'pointer',
    position: 'relative',
    transition: 'background 0.25s',
    padding: 0,
    flexShrink: 0,
  },
  toggleKnob: {
    position: 'absolute',
    top: 2,
    width: 20,
    height: 20,
    borderRadius: '50%',
    background: 'white',
    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
    transition: 'left 0.25s',
    pointerEvents: 'none',
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
    background: '#111',
    aspectRatio: '16/9',
    overflow: 'hidden',
  },
  playOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playCircle: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.12)',
    border: '2px solid rgba(255,255,255,0.6)',
    color: 'white',
    fontSize: 26,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background 0.2s, transform 0.15s',
  },
  videoCornerBtn: {
    position: 'absolute',
    zIndex: 10,
    background: 'rgba(0,0,0,0.45)',
    color: 'white',
    border: 'none',
    borderRadius: 4,
    width: 28,
    height: 28,
    fontSize: 14,
    lineHeight: '28px',
    textAlign: 'center',
    cursor: 'pointer',
    padding: 0,
    opacity: 0.75,
  },
  cardFooter: {
    padding: '10px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
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
  const [channel] = useState(0)
  const [isEnabled, setIsEnabled] = useState(null) // null while loading
  const [onProperty, setOnProperty] = useState(null) // { siid, piid }
  const [togglingPower, setTogglingPower] = useState(false)
  const [ptzLoading, setPtzLoading] = useState(false)
  const [metaExpanded, setMetaExpanded] = useState(false)

  // Fetch and sync the actual 'on' property state on mount
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const specRes = await fetch(`/api/devices/${camera.did}/spec`)
        if (!specRes.ok || cancelled) { setIsEnabled(true); return }
        const spec = await specRes.json()
        let onProp = null
        for (const svc of spec.services || []) {
          for (const prop of svc.properties || []) {
            if (prop.name === 'on') { onProp = { siid: svc.siid, piid: prop.piid }; break }
          }
          if (onProp) break
        }
        if (!onProp) { setIsEnabled(true); return }
        if (!cancelled) setOnProperty(onProp)
        const valRes = await fetch(`/api/devices/${camera.did}/props/values`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([onProp]),
        })
        if (!valRes.ok || cancelled) { setIsEnabled(true); return }
        const vals = await valRes.json()
        const entry = vals.find(v => v.siid === onProp.siid && v.piid === onProp.piid)
        if (!cancelled) setIsEnabled(entry && entry.code === 0 ? entry.value : true)
      } catch {
        if (!cancelled) setIsEnabled(true)
      }
    })()
    return () => { cancelled = true }
  }, [camera.did])

  const handleTogglePower = async () => {
    if (!onProperty || togglingPower) return
    const newValue = !isEnabled
    setTogglingPower(true)
    try {
      const res = await fetch(`/api/devices/${camera.did}/prop/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siid: onProperty.siid, piid: onProperty.piid, value: newValue }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.success) setIsEnabled(newValue)
      }
    } catch (e) {
      console.error('Power toggle failed:', e)
    } finally {
      setTogglingPower(false)
    }
  }

  const handlePTZAction = async (direction) => {
    setPtzLoading(true)
    try {
      await fetch(`/api/devices/${camera.did}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siid: 5, aiid: 1, in_: [{ piid: 1, value: direction }] }),
      })
    } catch (e) {
      console.error('PTZ error:', e)
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
        <div style={styles.headerLeft}>
          <span style={styles.cameraName} title={camera.name}>{camera.name}</span>
          <span style={{ ...styles.onlineStatus, color: isOnline ? '#52c41a' : '#ff4d4f' }}>
            ● {isOnline ? 'Online' : 'Offline'}
          </span>
        </div>
        {/* iOS-style power toggle */}
        <button
          style={{
            ...styles.toggleTrack,
            background: isEnabled ? '#52c41a' : '#bfbfbf',
            opacity: togglingPower || isEnabled === null ? 0.55 : 1,
          }}
          onClick={handleTogglePower}
          disabled={togglingPower || isEnabled === null || !onProperty}
          title={isEnabled ? 'Turn camera off' : 'Turn camera on'}
          aria-label={isEnabled ? 'Turn camera off' : 'Turn camera on'}
        >
          <div style={{ ...styles.toggleKnob, left: isEnabled ? 22 : 2 }} />
        </button>
      </div>

      {/* Meta info */}
      <div style={styles.meta}>
        <span>📍 {camera.room_name || camera.home_name || '—'}</span>
        <span>📡 {camera.model}</span>
        <span style={{ color: statusInfo.color }}>● {statusInfo.label}</span>
        {camera.fw_version && <span>🔧 FW {camera.fw_version}</span>}
        {camera.rssi != null && <span>📶 {camera.rssi} dBm</span>}
        {camera.ssid && <span>WiFi: {camera.ssid}</span>}
        <span
          style={{ color: '#1677ff', cursor: 'pointer', fontSize: 11 }}
          onClick={() => setMetaExpanded(e => !e)}
        >
          {metaExpanded ? '▴ less' : '▾ more'}
        </span>
      </div>

      {/* Collapsible extra metadata */}
      {metaExpanded && (
        <div style={{ ...styles.meta, paddingTop: 0, borderTop: '1px dashed #f0f0f0', marginTop: -4 }}>
          <span title="Device ID">🆔 {camera.did}</span>
          {camera.home_name && camera.room_name && <span>🏠 {camera.home_name}</span>}
          <span>🌐 IP: {camera.local_ip || '—'}</span>
          <span style={{ color: camera.lan_status ? '#52c41a' : '#aaa' }}>
            🔗 LAN: {camera.lan_status ? 'connected' : 'offline'}
          </span>
          {camera.mcu_version && <span>🔩 MCU {camera.mcu_version}</span>}
          {camera.platform && <span>💻 {camera.platform}</span>}
          <span>📹 {camera.channel_count} ch</span>
        </div>
      )}

      {/* Video area */}
      <div style={styles.videoWrapper}>
        {playing ? (
          <>
            <VideoPlayer
              cameraId={camera.did}
              channel={channel}
              onStop={() => setPlaying(false)}
            />
            {/* Stop button — bottom-left corner */}
            <button
              style={{ ...styles.videoCornerBtn, bottom: 8, left: 8 }}
              onClick={() => setPlaying(false)}
              title="Stop stream"
            >
              ■
            </button>
          </>
        ) : (
          <div
            style={{ ...styles.playOverlay, cursor: isOnline ? 'pointer' : 'default' }}
            onClick={() => isOnline && setPlaying(true)}
          >
            <div style={{ ...styles.playCircle, opacity: isOnline ? 1 : 0.3 }}>
              ▶
            </div>
            {!isOnline && (
              <span style={{ color: '#666', fontSize: 12, marginTop: 10 }}>Camera offline</span>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={styles.cardFooter}>
        {/* PTZ Controls */}
        <div>
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


      {/* Properties accordion */}
      <CameraPropertiesPanel did={camera.did} />
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
