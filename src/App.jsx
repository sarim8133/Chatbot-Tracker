import { useState, useCallback, useEffect } from 'react'
import Dashboard from './mawavia-dashboard'
import Login, { ResetPassword, AupGate } from './login'
import { isAuthed, signOut, consumeRecoveryHash, aupAccepted, checkAupAccepted } from './auth'

export default function App() {
  // If arriving from a password-reset email, the recovery session is in the URL hash.
  const [recovery, setRecovery] = useState(() => consumeRecoveryHash())
  const [authed, setAuthed] = useState(() => isAuthed())
  // First-login Acceptable-Use acknowledgment. Cross-device: the authoritative source
  // is app_users.aup_accepted_at (checkAupAccepted), with the local cache as a fast path.
  //   true  = accepted   false = must show gate   null = still checking the server
  // Seed true synchronously if the local cache already has it, so repeat visits on this
  // device never flash a loading screen; otherwise null until the async check resolves.
  const [aupOk, setAupOk] = useState(() => (isAuthed() && aupAccepted()) ? true : null)
  // Used for both the manual sign-out button and an expired/invalid session.
  const handleLogout = useCallback(() => { signOut(); setAuthed(false); setAupOk(null) }, [])
  const afterAuth = () => { setAuthed(true) }   // the effect below resolves aupOk

  // Whenever we become authenticated (and don't already know acceptance), confirm it
  // against the server so accepting on ANY device counts on all of them.
  useEffect(() => {
    if (!authed) return
    let alive = true
    setAupOk(prev => prev === true ? true : null)
    checkAupAccepted().then(ok => { if (alive) setAupOk(ok) })
    return () => { alive = false }
  }, [authed])

  if (recovery) return <ResetPassword onDone={() => { setRecovery(false); afterAuth() }} />
  if (!authed) return <Login onSuccess={afterAuth} />
  if (aupOk === null) return <div className="min-h-screen" style={{ background: '#F1F5F9' }} />
  if (!aupOk) return <AupGate onAccept={() => setAupOk(true)} onDecline={handleLogout} />
  return <Dashboard onLogout={handleLogout} />
}
