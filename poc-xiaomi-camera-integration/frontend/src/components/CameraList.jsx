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
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTop: '1px solid #f0f0f0',
  },
  channelInfo: {
    fontSize: 12,
    color: '#aaa',
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
        <span style={styles.channelInfo}>
          {camera.channel_count > 1
            ? `Channel ${channel + 1} / ${camera.channel_count}`
            : `${camera.channel_count} channel`}
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
