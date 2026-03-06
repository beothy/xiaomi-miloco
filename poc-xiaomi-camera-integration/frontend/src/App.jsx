/**
 * Copyright (C) 2025 Xiaomi Corporation
 * This software may be used and distributed according to the terms of the Xiaomi Miloco License Agreement.
 */

import React, { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import axios from 'axios'

/**
 * Root App component.
 * Checks authentication state and routes accordingly.
 */
const App = () => {
  const [authenticated, setAuthenticated] = useState(null) // null = loading

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await axios.get('/api/auth/status')
        setAuthenticated(res.data.authenticated === true)
      } catch {
        setAuthenticated(false)
      }
    }
    checkAuth()
  }, [])

  if (authenticated === null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <p style={{ color: '#888' }}>Loading...</p>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            authenticated
              ? <Navigate to="/dashboard" replace />
              : <Login onLogin={() => setAuthenticated(true)} />
          }
        />
        <Route
          path="/dashboard"
          element={
            authenticated
              ? <Dashboard onLogout={() => setAuthenticated(false)} />
              : <Navigate to="/login" replace />
          }
        />
        <Route path="*" element={<Navigate to={authenticated ? '/dashboard' : '/login'} replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
