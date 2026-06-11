import { useState, useCallback } from 'react'
import Dashboard from './mawavia-dashboard'
import Login from './login'
import { isAuthed, signOut } from './auth'

export default function App() {
  const [authed, setAuthed] = useState(() => isAuthed())
  // Used for both the manual sign-out button and an expired/invalid session.
  const handleLogout = useCallback(() => { signOut(); setAuthed(false); }, [])

  if (!authed) return <Login onSuccess={() => setAuthed(true)} />
  return <Dashboard onLogout={handleLogout} />
}
