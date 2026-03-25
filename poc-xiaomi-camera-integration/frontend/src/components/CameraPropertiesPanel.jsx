import React, { useState, useEffect, useRef } from 'react'

// Well-known camera control property names that appear at the top of the panel.
const CURATED = new Set([
  'guard-mode', 'on', 'camera-status', 'indicator-light',
  'recording-mode', 'motion-detection', 'night-shot', 'image-rollover',
  'time-watermark', 'wdr-mode', 'glimmer-full-color', 'motion-tracking',
  'local-storage', 'hdr-mode', 'human-tracking', 'ai-frame',
])

const POLL_INTERVAL_MS = 30_000

const styles = {
  panel: {
    borderTop: '1px solid #f0f0f0',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 16px',
    cursor: 'pointer',
    userSelect: 'none',
    fontSize: 13,
    color: '#555',
  },
  headerTitle: {
    fontWeight: 600,
    color: '#333',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  refreshBtn: {
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 4,
    border: '1px solid #d9d9d9',
    background: 'white',
    cursor: 'pointer',
    color: '#555',
  },
  body: {
    padding: '0 16px 12px',
  },
  error: {
    color: '#ff4d4f',
    fontSize: 12,
    padding: '4px 0',
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 600,
    color: '#aaa',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    margin: '10px 0 4px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '5px 0',
    borderBottom: '1px solid #fafafa',
    fontSize: 13,
    minHeight: 32,
  },
  propLabel: {
    color: '#444',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    marginRight: 8,
  },
  propControl: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  badge: {
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 10,
    background: '#f5f5f5',
    color: '#555',
    border: '1px solid #e8e8e8',
  },
  toggleOn: {
    padding: '3px 10px',
    borderRadius: 12,
    border: 'none',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    background: '#52c41a',
    color: 'white',
    minWidth: 44,
  },
  toggleOff: {
    padding: '3px 10px',
    borderRadius: 12,
    border: 'none',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    background: '#d9d9d9',
    color: '#555',
    minWidth: 44,
  },
  select: {
    fontSize: 12,
    padding: '2px 6px',
    borderRadius: 4,
    border: '1px solid #d9d9d9',
    maxWidth: 150,
  },
  showAllBtn: {
    marginTop: 8,
    fontSize: 12,
    color: '#1677ff',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
  },
  spinner: {
    display: 'inline-block',
    width: 12,
    height: 12,
    border: '2px solid #f0f0f0',
    borderTop: '2px solid #1677ff',
    borderRadius: '50%',
    animation: 'spin 0.6s linear infinite',
  },
}

/** Renders a single property row with a read-only badge or a write control. */
const PropertyRow = ({ siid, piid, prop, value, saving, onWrite }) => {
  const key = `${siid}.${piid}`
  const isSaving = saving.has(key)
  const isUnavailable = value === undefined

  const renderControl = () => {
    if (isSaving) return <span style={styles.spinner} />
    if (isUnavailable) return <span style={{ ...styles.badge, color: '#bbb' }}>—</span>

    // Boolean toggle
    if (prop.format === 'bool') {
      if (!prop.writable) {
        return <span style={styles.badge}>{value ? 'On' : 'Off'}</span>
      }
      return (
        <button
          style={value ? styles.toggleOn : styles.toggleOff}
          onClick={() => onWrite(siid, piid, !value)}
        >
          {value ? 'On' : 'Off'}
        </button>
      )
    }

    // Enum — value_list present
    if (prop.value_list?.length) {
      const label = prop.value_list.find(i => i.value === value)?.label ?? String(value)
      if (!prop.writable) {
        return <span style={styles.badge}>{label}</span>
      }
      return (
        <select
          style={styles.select}
          value={value}
          onChange={e => {
            // Coerce to the original type of the matching value_list entry
            const raw = e.target.value
            const entry = prop.value_list.find(i => String(i.value) === raw)
            onWrite(siid, piid, entry ? entry.value : raw)
          }}
        >
          {prop.value_list.map(item => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>
      )
    }

    // Numeric — always read-only (avoid risky raw writes)
    if (prop.value_range) {
      const display = prop.unit ? `${value} ${prop.unit}` : String(value)
      return <span style={styles.badge}>{display}</span>
    }

    // String / fallback — read-only
    return <span style={{ ...styles.badge, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(value)}</span>
  }

  return (
    <div style={styles.row}>
      <span style={styles.propLabel} title={prop.description_trans}>
        {prop.description_trans || prop.name}
      </span>
      <span style={styles.propControl}>{renderControl()}</span>
    </div>
  )
}

/**
 * CameraPropertiesPanel — accordion that shows MIoT properties for a camera.
 * Fetches the device spec once on first expand, then polls values every 30 s.
 */
const CameraPropertiesPanel = ({ did }) => {
  const [expanded, setExpanded] = useState(false)
  const [services, setServices] = useState(null)   // Array from GET /spec
  const [values, setValues] = useState({})          // "siid.piid" -> value
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const [saving, setSaving] = useState(new Set())

  const pollRef = useRef(null)
  const specFetched = useRef(false)

  // ── value fetch ──────────────────────────────────────────────────────────

  const fetchValues = async (svcs) => {
    const src = svcs || services
    if (!src) return
    const readable = []
    for (const svc of src) {
      for (const prop of svc.properties) {
        if (prop.readable) readable.push({ siid: svc.siid, piid: prop.piid })
      }
    }
    if (!readable.length) return
    try {
      const res = await fetch(`/api/devices/${did}/props/values`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(readable),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setValues(prev => {
        const next = { ...prev }
        for (const item of data) {
          if (item.code === 0) next[`${item.siid}.${item.piid}`] = item.value
        }
        return next
      })
    } catch (e) {
      console.warn('Failed to fetch property values:', e)
    }
  }

  // ── spec + initial values fetch ──────────────────────────────────────────

  const fetchSpec = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/devices/${did}/spec`)
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${await res.text()}`)
      const data = await res.json()
      specFetched.current = true
      setServices(data.services)
      await fetchValues(data.services)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // ── expand / collapse lifecycle ──────────────────────────────────────────

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    if (!expanded) return

    if (!specFetched.current) {
      fetchSpec()
    } else {
      fetchValues()
    }
    pollRef.current = setInterval(() => fetchValues(), POLL_INTERVAL_MS)
    return () => clearInterval(pollRef.current)
  }, [expanded]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── write handler ────────────────────────────────────────────────────────

  const handleWrite = async (siid, piid, value) => {
    const key = `${siid}.${piid}`
    setSaving(prev => new Set(prev).add(key))
    try {
      const res = await fetch(`/api/devices/${did}/prop/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siid, piid, value }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.success) {
        setValues(prev => ({ ...prev, [key]: value }))
      }
    } catch (e) {
      console.warn('Failed to set property:', e)
    } finally {
      setSaving(prev => { const s = new Set(prev); s.delete(key); return s })
    }
  }

  // ── render helpers ───────────────────────────────────────────────────────

  /** Flat list of {svc, prop} for all curated properties across all services */
  const curatedItems = () => {
    if (!services) return []
    const result = []
    for (const svc of services) {
      for (const prop of svc.properties) {
        if (CURATED.has(prop.name)) result.push({ svc, prop })
      }
    }
    return result
  }

  const renderRows = (items) =>
    items.map(({ svc, prop }) => (
      <PropertyRow
        key={`${svc.siid}.${prop.piid}`}
        siid={svc.siid}
        piid={prop.piid}
        prop={prop}
        value={values[`${svc.siid}.${prop.piid}`]}
        saving={saving}
        onWrite={handleWrite}
      />
    ))

  const renderAllGrouped = () =>
    services.map(svc => {
      if (!svc.properties.length) return null
      return (
        <div key={svc.siid}>
          <div style={styles.sectionTitle}>{svc.description_trans || svc.name}</div>
          {svc.properties.map(prop => (
            <PropertyRow
              key={`${svc.siid}.${prop.piid}`}
              siid={svc.siid}
              piid={prop.piid}
              prop={prop}
              value={values[`${svc.siid}.${prop.piid}`]}
              saving={saving}
              onWrite={handleWrite}
            />
          ))}
        </div>
      )
    })

  // ── render ───────────────────────────────────────────────────────────────

  return (
    <div style={styles.panel}>
      {/* Accordion header */}
      <div style={styles.header} onClick={() => setExpanded(e => !e)}>
        <span style={styles.headerTitle}>
          {expanded ? '▾' : '▸'} Camera Properties
        </span>
        {expanded && (
          <span style={styles.headerRight} onClick={e => e.stopPropagation()}>
            <button
              style={styles.refreshBtn}
              onClick={() => (specFetched.current ? fetchValues() : fetchSpec())}
              disabled={loading}
            >
              {loading ? '…' : '↻ Refresh'}
            </button>
          </span>
        )}
      </div>

      {/* Accordion body */}
      {expanded && (
        <div style={styles.body}>
          {loading && !services && (
            <div style={{ color: '#aaa', fontSize: 12 }}>Loading spec…</div>
          )}
          {error && <div style={styles.error}>⚠ {error}</div>}

          {services && !showAll && (
            <>
              {renderRows(curatedItems())}
              <button style={styles.showAllBtn} onClick={() => setShowAll(true)}>
                ▾ Show all properties
              </button>
            </>
          )}

          {services && showAll && (
            <>
              {renderAllGrouped()}
              <button style={styles.showAllBtn} onClick={() => setShowAll(false)}>
                ▴ Show less
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default CameraPropertiesPanel
