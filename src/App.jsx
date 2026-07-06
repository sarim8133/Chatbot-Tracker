import { useState, useCallback } from 'react'
import Dashboard from './mawavia-dashboard'
import Login, { ResetPassword } from './login'
import { isAuthed, signOut, consumeRecoveryHash } from './auth'

export default function App() {
  // If arriving from a password-reset email, the recovery session is in the URL hash.
  const [recovery, setRecovery] = useState(() => consumeRecoveryHash())
  const [authed, setAuthed] = useState(() => isAuthed())
  // Used for both the manual sign-out button and an expired/invalid session.
  const handleLogout = useCallback(() => { signOut(); setAuthed(false); }, [])

  if (recovery) return <ResetPassword onDone={() => { setRecovery(false); setAuthed(true); }} />
  if (!authed) return <Login onSuccess={() => setAuthed(true)} />
  return <Dashboard onLogout={handleLogout} />
}
