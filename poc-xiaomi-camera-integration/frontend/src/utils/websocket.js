/**
 * Copyright (C) 2025 Xiaomi Corporation
 * This software may be used and distributed according to the terms of the Xiaomi Miloco License Agreement.
 *
 * WebSocket utility for managing camera video stream connections.
 *
 * Usage:
 *   import { createVideoWebSocket } from './websocket.js'
 *
 *   const ws = createVideoWebSocket({
 *     cameraId: 'abc123',
 *     channel: 0,
 *     onFrame: (data) => { ... },
 *     onOpen: () => { ... },
 *     onClose: (evt) => { ... },
 *     onError: (err) => { ... },
 *   })
 *
 *   // Later:
 *   ws.close()
 */

/**
 * Create a managed WebSocket connection for a camera video stream.
 *
 * @param {Object}   options
 * @param {string}   options.cameraId  - Camera device ID.
 * @param {number}   [options.channel=0] - Camera channel number.
 * @param {Function} options.onFrame   - Called with Uint8Array frame data.
 * @param {Function} [options.onOpen]  - Called when WebSocket opens.
 * @param {Function} [options.onClose] - Called when WebSocket closes.
 * @param {Function} [options.onError] - Called when an error occurs.
 * @returns {{ close: Function }} Object with a `close()` method.
 */
export const createVideoWebSocket = ({
  cameraId,
  channel = 0,
  onFrame,
  onOpen,
  onClose,
  onError,
}) => {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const wsUrl = `${wsProtocol}://${window.location.host}/api/ws/stream`
    + `?camera_id=${encodeURIComponent(cameraId)}`
    + `&channel=${encodeURIComponent(channel)}`

  const ws = new WebSocket(wsUrl)
  ws.binaryType = 'arraybuffer'

  ws.onopen = () => {
    onOpen && onOpen()
  }

  ws.onmessage = (evt) => {
    if (evt.data instanceof ArrayBuffer) {
      onFrame && onFrame(new Uint8Array(evt.data))
    }
  }

  ws.onerror = (err) => {
    onError && onError(err)
  }

  ws.onclose = (evt) => {
    onClose && onClose(evt)
  }

  return {
    /** Close the WebSocket connection. */
    close: (reason = 'close_by_user') => {
      try {
        ws.close(1000, reason)
      } catch (_) { /* ignore */ }
    },
  }
}

export default createVideoWebSocket
