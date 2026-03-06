/**
 * Copyright (C) 2025 Xiaomi Corporation
 * This software may be used and distributed according to the terms of the Xiaomi Miloco License Agreement.
 */

import React, { useEffect, useRef, useState } from 'react'

/**
 * Detect video codec from the first few bytes of a NAL-unit stream.
 *
 * @param {Uint8Array} data
 * @returns {'h264' | 'h265' | 'unknown'}
 */
const detectCodec = (data) => {
  let i = 0
  while (i < data.length - 6) {
    if (
      data[i] === 0x00 && data[i + 1] === 0x00 &&
      ((data[i + 2] === 0x00 && data[i + 3] === 0x01) || data[i + 2] === 0x01)
    ) {
      const nalStart = data[i + 2] === 0x01 ? i + 3 : i + 4
      const h264Type = data[nalStart] & 0x1f
      const h265Type = (data[nalStart] >> 1) & 0x3f
      if ([5, 7, 8].includes(h264Type)) return 'h264'
      if ([32, 33, 34, 19, 20].includes(h265Type)) return 'h265'
    }
    i++
  }
  return 'unknown'
}

/**
 * Determine if a NAL-unit buffer contains a keyframe.
 *
 * @param {Uint8Array} data
 * @param {string} codec  - WebCodecs codec string (e.g. 'avc1.42E01E')
 * @returns {boolean}
 */
const isKeyFrame = (data, codec) => {
  if (codec.startsWith('avc1') || codec.startsWith('h264')) {
    let i = 0
    while (i < data.length - 4) {
      if (
        data[i] === 0x00 && data[i + 1] === 0x00 &&
        ((data[i + 2] === 0x00 && data[i + 3] === 0x01) || data[i + 2] === 0x01)
      ) {
        const nalUnitType = data[i + 2] === 0x01 ? data[i + 3] & 0x1f : data[i + 4] & 0x1f
        return nalUnitType === 5
      }
      i++
    }
    return false
  }
  if (codec.startsWith('hvc1') || codec.startsWith('hev1') || codec.startsWith('h265')) {
    let i = 0
    while (i < data.length - 6) {
      if (
        data[i] === 0x00 && data[i + 1] === 0x00 &&
        ((data[i + 2] === 0x00 && data[i + 3] === 0x01) || data[i + 2] === 0x01)
      ) {
        const nalStart = data[i + 2] === 0x01 ? i + 3 : i + 4
        const nalUnitType = (data[nalStart] >> 1) & 0x3f
        if ([16, 17, 18, 19, 20].includes(nalUnitType)) return true
      }
      i++
    }
    return false
  }
  return true
}

const styles = {
  wrapper: {
    position: 'relative',
    width: '100%',
    height: '100%',
    background: '#000',
  },
  canvas: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
  },
  overlayMessage: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'white',
    gap: 8,
    fontSize: 13,
    background: 'rgba(0,0,0,0.55)',
    zIndex: 2,
  },
  spinner: {
    width: 32,
    height: 32,
    border: '3px solid rgba(255,255,255,0.3)',
    borderTopColor: 'white',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  reconnectBtn: {
    marginTop: 8,
    padding: '6px 16px',
    background: '#1677ff',
    color: 'white',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
  },
}

/**
 * VideoPlayer – renders a camera live stream via WebCodecs + WebSocket.
 *
 * Connects to `/api/ws/stream?camera_id=...&channel=...` and decodes
 * the incoming H.264 / H.265 AnnexB stream onto a canvas element.
 *
 * @param {Object} props
 * @param {string}   props.cameraId  - Camera device ID.
 * @param {number}   [props.channel=0] - Camera channel.
 * @param {Function} [props.onStop]  - Called when the user stops the stream.
 */
const VideoPlayer = ({ cameraId, channel = 0, onStop }) => {
  const canvasRef = useRef(null)
  const wsRef = useRef(null)
  const decoderRef = useRef(null)
  const autoCodecRef = useRef(null)
  const waitForKeyFrameRef = useRef(true)

  const [phase, setPhase] = useState('connecting') // connecting | playing | error
  const [errorMsg, setErrorMsg] = useState('')

  const cleanup = () => {
    if (wsRef.current) {
      try { wsRef.current.close(1000, 'close_by_user') } catch (_) { /* ignore */ }
      wsRef.current = null
    }
    if (decoderRef.current) {
      try { decoderRef.current.close() } catch (_) { /* ignore */ }
      decoderRef.current = null
    }
  }

  const startStream = () => {
    cleanup()
    autoCodecRef.current = null
    waitForKeyFrameRef.current = true
    setPhase('connecting')
    setErrorMsg('')

    // Requires WebCodecs (Chrome 94+, Edge 94+) and HTTPS or localhost
    if (
      typeof window === 'undefined' ||
      !('VideoDecoder' in window) ||
      !('VideoFrame' in window)
    ) {
      setPhase('error')
      setErrorMsg('WebCodecs not supported. Please use Chrome 94+ over HTTPS or localhost.')
      return
    }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const wsUrl = `${wsProtocol}://${window.location.host}/api/ws/stream?camera_id=${encodeURIComponent(cameraId)}&channel=${encodeURIComponent(channel)}`

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    let firstFrame = true

    decoderRef.current = new window.VideoDecoder({
      output: (frame) => {
        createImageBitmap(frame).then((bitmap) => {
          canvas.width = frame.codedWidth
          canvas.height = frame.codedHeight
          ctx.drawImage(bitmap, 0, 0)
          frame.close()
          bitmap.close && bitmap.close()
          if (firstFrame) {
            setPhase('playing')
            firstFrame = false
          }
        })
      },
      error: (err) => {
        setPhase('error')
        setErrorMsg(`Decode error: ${err.message || err}`)
      },
    })
    decoderRef.current.configure({
      codec: 'avc1.42E01E',
      hardwareAcceleration: 'prefer-hardware',
    })

    wsRef.current = new window.WebSocket(wsUrl)
    wsRef.current.binaryType = 'arraybuffer'

    wsRef.current.onerror = () => {
      setPhase('error')
      setErrorMsg('WebSocket connection failed.')
    }
    wsRef.current.onclose = (evt) => {
      if (evt.reason !== 'close_by_user') {
        setPhase('error')
        setErrorMsg('Connection closed by server.')
      }
    }
    wsRef.current.onmessage = (evt) => {
      if (!(evt.data instanceof ArrayBuffer)) return
      const uint8 = new Uint8Array(evt.data)

      // Auto-detect codec from first frame if not determined yet
      if (!autoCodecRef.current) {
        const detected = detectCodec(uint8)
        if (detected !== 'unknown') {
          const codecStr = detected === 'h264' ? 'avc1.42E01E' : 'hvc1.1.6.L93.B0'
          autoCodecRef.current = codecStr
          try {
            decoderRef.current.configure({
              codec: codecStr,
              hardwareAcceleration: 'prefer-hardware',
            })
          } catch (_) { /* keep current config */ }
        }
      }

      const useCodec = autoCodecRef.current || 'avc1.42E01E'
      const isKey = isKeyFrame(uint8, useCodec)

      // Drop frames until we receive a keyframe
      if (waitForKeyFrameRef.current) {
        if (!isKey) return
        waitForKeyFrameRef.current = false
      }

      try {
        decoderRef.current.decode(
          new window.EncodedVideoChunk({
            type: isKey ? 'key' : 'delta',
            timestamp: performance.now() * 1000,
            data: uint8,
          })
        )
      } catch (_) { /* decoder may be closing */ }
    }
  }

  useEffect(() => {
    startStream()
    return cleanup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId, channel])

  return (
    <div style={styles.wrapper}>
      <canvas ref={canvasRef} style={styles.canvas} />

      {phase === 'connecting' && (
        <div style={styles.overlayMessage}>
          <div style={styles.spinner} />
          <span>Connecting to camera...</span>
        </div>
      )}

      {phase === 'error' && (
        <div style={styles.overlayMessage}>
          <span>⚠️ {errorMsg || 'Stream error'}</span>
          <button style={styles.reconnectBtn} onClick={startStream}>
            Reconnect
          </button>
          {onStop && (
            <button
              style={{ ...styles.reconnectBtn, background: '#8c8c8c', marginTop: 4 }}
              onClick={onStop}
            >
              Close
            </button>
          )}
        </div>
      )}

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

export default VideoPlayer
