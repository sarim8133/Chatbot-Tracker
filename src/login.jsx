// Login gate — Control Room aesthetic (ink + one signal accent, blueprint grid).
// Authenticates against Supabase Auth via auth.js; on success the parent swaps to
// the dashboard. No credential lives here — it's verified server-side by Supabase.

import { useState } from 'react';
import { Lock, LogIn, AlertTriangle, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { signIn } from './auth';

const ACCENT    = '#F5471D';
const ACCENT_DK = '#D63A12';

export default function Login({ onSuccess }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [show, setShow] = useState(false);
  const [err,  setErr]  = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr('');
    try {
      await signIn(user, pass);
      onSuccess();                 // unmounts this view → dashboard mounts
    } catch (ex) {
      setErr(ex?.message || 'Sign in failed');
      setBusy(false);
    }
  };

  const field = "w-full px-3.5 py-3 text-[14px] text-zinc-900 bg-white border border-zinc-300 rounded-lg outline-none transition-colors focus:border-zinc-900 focus:ring-2 focus:ring-accent/20 placeholder-zinc-400";

  return (
    <div className="relative min-h-screen flex items-center justify-center px-5 text-zinc-900">
      {/* Clean slate surface — matches the dashboard background */}
      <div className="fixed inset-0 -z-10 pointer-events-none" aria-hidden="true"
        style={{background:'#F1F5F9'}}/>

      <div className="w-full max-w-[440px]">
        <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden shadow-[0_2px_8px_-2px_rgba(30,41,59,0.1),0_12px_32px_-8px_rgba(30,41,59,0.18)]">
          {/* signal strip */}
          <div className="h-[3px] w-full" style={{background:'#2258B8'}}/>
          <div className="p-9">
            {/* Wordmark */}
            <div className="flex items-center gap-2.5 mb-7">
              <img src="/logo.png" alt="Hi-Tech" className="h-9 w-auto"/>
              <div className="leading-none">
                <p className="text-[15px] font-semibold tracking-tight" style={{color:'#2258B8'}}>Hi-Tech</p>
                <p className="text-[11px] text-zinc-400 mt-0.5">Sales Intelligence</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Lock size={15} className="text-zinc-400"/>
              <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-zinc-900">Sign in</h1>
            </div>
            <p className="text-[13px] text-zinc-500 mt-1 mb-6">Restricted — authorized staff only.</p>

            <form onSubmit={submit} className="space-y-3.5">
              <div>
                <label htmlFor="login-id" className="text-[12px] font-medium text-zinc-600 mb-1.5 block">ID / Email</label>
                <input id="login-id" type="text" autoComplete="username" autoFocus
                  value={user} onChange={e=>setUser(e.target.value)}
                  placeholder="Username" className={field}/>
              </div>
              <div>
                <label htmlFor="login-pass" className="text-[12px] font-medium text-zinc-600 mb-1.5 block">Password</label>
                <div className="relative">
                  <input id="login-pass" type={show ? 'text' : 'password'} autoComplete="current-password"
                    value={pass} onChange={e=>setPass(e.target.value)}
                    placeholder="••••••••" className={`${field} pr-11`}/>
                  <button type="button" onClick={()=>setShow(s=>!s)}
                    aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}
                    className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-7 h-7 rounded-lg text-zinc-400 hover:text-zinc-700 outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                    {show ? <EyeOff size={15}/> : <Eye size={15}/>}
                  </button>
                </div>
              </div>

              {err && (
                <p role="alert" className="flex items-start gap-1.5 text-[13px] leading-snug rounded-lg px-3 py-2"
                  style={{color:ACCENT_DK, background:`${ACCENT}0D`, border:`1px solid ${ACCENT}33`}}>
                  <AlertTriangle size={13} className="mt-0.5 shrink-0"/>
                  <span>{err}</span>
                </p>
              )}

              <button type="submit" disabled={busy || !user || !pass}
                className="w-full flex items-center justify-center gap-2 min-h-[46px] rounded-lg bg-zinc-900 text-white text-[14px] font-semibold tracking-tight transition-colors hover:bg-accent outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-zinc-900 disabled:opacity-60 disabled:cursor-not-allowed">
                {busy
                  ? <><RefreshCw size={14} className="animate-spin"/> Signing in…</>
                  : <><LogIn size={14}/> Sign in</>}
              </button>
            </form>
          </div>
        </div>

        <p className="text-[12px] text-zinc-400 text-center mt-5">
          Hi-Tech Machinery · Authorized access only
        </p>
      </div>
    </div>
  );
}
