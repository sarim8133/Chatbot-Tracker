// Login gate — Control Room aesthetic (ink + one signal accent, blueprint grid).
// Authenticates against Supabase Auth via auth.js; on success the parent swaps to
// the dashboard. No credential lives here — it's verified server-side by Supabase.

import { useState } from 'react';
import { Lock, LogIn, AlertTriangle, RefreshCw, Eye, EyeOff, Mail, ArrowLeft, CheckCircle2, KeyRound, ShieldCheck, LogOut } from 'lucide-react';
import { signIn, requestPasswordReset, changePassword, recordAupAcceptance } from './auth';

const ACCENT    = 'var(--accent)';
const ACCENT_DK = 'var(--accent-dark)';

const field = "w-full px-3.5 py-3 text-[14px] text-zinc-900 bg-surface border border-zinc-300 rounded-lg outline-none transition-colors focus:border-zinc-900 focus:ring-2 focus:ring-accent/20 placeholder-zinc-400";

// Shared card shell so the sign-in, forgot, and reset screens all match.
function Shell({ children }) {
  return (
    <div className="relative min-h-screen flex items-center justify-center px-5 text-zinc-900">
      <div className="fixed inset-0 -z-10 pointer-events-none" aria-hidden="true" style={{ background: 'var(--paper)' }} />
      <div className="w-full max-w-[440px]">
        <div className="bg-surface border border-zinc-100 rounded-xl overflow-hidden shadow-[0_2px_8px_-2px_rgba(30,41,59,0.1),0_12px_32px_-8px_rgba(30,41,59,0.18)]">
          <div className="h-[3px] w-full" style={{ background: 'var(--blue)' }} />
          <div className="p-9">
            <div className="flex items-center gap-2.5 mb-7">
              <img src="/logo.png" alt="Hi-Tech" className="h-9 w-auto" />
              <div className="leading-none">
                <p className="text-[15px] font-semibold tracking-tight" style={{ color: 'var(--blue)' }}>Hi-Tech</p>
                <p className="text-[11px] text-zinc-400 mt-0.5">Sales Intelligence</p>
              </div>
            </div>
            {children}
          </div>
        </div>
        <p className="text-[12px] text-zinc-400 text-center mt-5">
          Hi-Tech Machinery · Authorized access only
        </p>
      </div>
    </div>
  );
}

function ErrorNote({ children }) {
  return (
    <p role="alert" className="flex items-start gap-1.5 text-[13px] leading-snug rounded-lg px-3 py-2"
      style={{ color: ACCENT_DK, background: `color-mix(in srgb, ${ACCENT} 5%, transparent)`, border: `1px solid color-mix(in srgb, ${ACCENT} 20%, transparent)` }}>
      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export default function Login({ onSuccess }) {
  const [mode, setMode] = useState('signin');   // 'signin' | 'forgot'
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [show, setShow] = useState(false);
  const [err,  setErr]  = useState('');
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState('');      // email a reset link was sent to

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr('');
    try {
      await signIn(user, pass);
      onSuccess();
    } catch (ex) {
      setErr(ex?.message || 'Sign in failed');
      setBusy(false);
    }
  };

  const sendReset = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr('');
    try {
      const email = await requestPasswordReset(user);
      setSentTo(email);
    } catch (ex) {
      setErr(ex?.message || "Couldn't send reset email");
    } finally {
      setBusy(false);
    }
  };

  const goForgot = () => { setMode('forgot'); setErr(''); setSentTo(''); };
  const goSignin = () => { setMode('signin'); setErr(''); setSentTo(''); };

  // ── Forgot-password view ──────────────────────────────────────────────────
  if (mode === 'forgot') {
    return (
      <Shell>
        {sentTo ? (
          <>
            <div className="flex items-center gap-2">
              <CheckCircle2 size={17} style={{ color: 'var(--pos)' }} />
              <h1 className="text-[22px] font-extrabold tracking-[-0.02em] text-zinc-900">Check your email</h1>
            </div>
            <p className="text-[13px] text-zinc-500 mt-2 mb-6 leading-relaxed">
              If an account exists, a password-reset link is on its way to <span className="font-medium text-zinc-700">{sentTo}</span>.
              Open it on this device to set a new password. The link expires in about an hour.
            </p>
            <button onClick={goSignin}
              className="w-full flex items-center justify-center gap-2 min-h-[46px] rounded-lg bg-zinc-900 text-on-ink text-[14px] font-semibold tracking-tight transition-colors hover:bg-accent outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-zinc-900">
              <ArrowLeft size={14} /> Back to sign in
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <KeyRound size={15} className="text-zinc-400" />
              <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-zinc-900">Reset password</h1>
            </div>
            <p className="text-[13px] text-zinc-500 mt-1 mb-6">Enter your email or phone number — we'll email you a reset link.</p>
            <form onSubmit={sendReset} className="space-y-3.5">
              <div>
                <label htmlFor="reset-id" className="text-[12px] font-medium text-zinc-600 mb-1.5 block">Email / Phone Number</label>
                <input id="reset-id" type="text" autoComplete="username" autoFocus
                  value={user} onChange={e => setUser(e.target.value)}
                  placeholder="you@email.com or 923001234567" className={field} />
              </div>
              {err && <ErrorNote>{err}</ErrorNote>}
              <button type="submit" disabled={busy || !user}
                className="w-full flex items-center justify-center gap-2 min-h-[46px] rounded-lg bg-zinc-900 text-on-ink text-[14px] font-semibold tracking-tight transition-colors hover:bg-accent outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-zinc-900 disabled:opacity-60 disabled:cursor-not-allowed">
                {busy ? <><RefreshCw size={14} className="animate-spin" /> Sending…</> : <><Mail size={14} /> Send reset link</>}
              </button>
              <button type="button" onClick={goSignin}
                className="w-full flex items-center justify-center gap-1.5 text-[13px] text-zinc-500 hover:text-zinc-900 transition-colors py-1">
                <ArrowLeft size={13} /> Back to sign in
              </button>
            </form>
          </>
        )}
      </Shell>
    );
  }

  // ── Sign-in view ──────────────────────────────────────────────────────────
  return (
    <Shell>
      <div className="flex items-center gap-2">
        <Lock size={15} className="text-zinc-400" />
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-zinc-900">Sign in</h1>
      </div>
      <p className="text-[13px] text-zinc-500 mt-1 mb-6">For authorized Hi-Tech personnel only.</p>

      <form onSubmit={submit} className="space-y-3.5">
        <div>
          <label htmlFor="login-id" className="text-[12px] font-medium text-zinc-600 mb-1.5 block">Email / Phone Number</label>
          <input id="login-id" type="text" autoComplete="username" autoFocus
            value={user} onChange={e => setUser(e.target.value)}
            placeholder="you@email.com or 923001234567" className={field} />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="login-pass" className="text-[12px] font-medium text-zinc-600">Password</label>
            <button type="button" onClick={goForgot}
              className="text-[12px] font-medium text-zinc-500 hover:text-accent transition-colors outline-none focus-visible:underline">
              Forgot password?
            </button>
          </div>
          <div className="relative">
            <input id="login-pass" type={show ? 'text' : 'password'} autoComplete="current-password"
              value={pass} onChange={e => setPass(e.target.value)}
              placeholder="••••••••" className={`${field} pr-11`} />
            <button type="button" onClick={() => setShow(s => !s)}
              aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}
              className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-7 h-7 rounded-lg text-zinc-400 hover:text-zinc-700 outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        {err && <ErrorNote>{err}</ErrorNote>}

        <button type="submit" disabled={busy || !user || !pass}
          className="w-full flex items-center justify-center gap-2 min-h-[46px] rounded-lg bg-zinc-900 text-on-ink text-[14px] font-semibold tracking-tight transition-colors hover:bg-accent outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-zinc-900 disabled:opacity-60 disabled:cursor-not-allowed">
          {busy
            ? <><RefreshCw size={14} className="animate-spin" /> Signing in…</>
            : <><LogIn size={14} /> Sign in</>}
        </button>
      </form>

      <p className="flex items-start gap-1.5 text-[11.5px] leading-snug text-zinc-400 mt-6 pt-4 border-t border-zinc-100">
        <ShieldCheck size={13} className="mt-0.5 shrink-0 text-zinc-400" />
        <span>This is a private Hi-Tech system. Access is restricted to authorized staff; logins, views, exports and uploads are logged and may be audited.</span>
      </p>
    </Shell>
  );
}

// First-login gate: a short Acceptable-Use acknowledgment the user must accept before
// reaching the dashboard. Shown once per user per device (see aupAccepted in auth.js).
// This isn't the access control — Supabase Auth + RLS are — it's the policy boundary
// that makes "authorized use only" enforceable and on the record.
export function AupGate({ onAccept, onDecline }) {
  const rules = [
    'Use the dashboard only for legitimate Hi-Tech business.',
    'Keep your account private — never share your login or password.',
    "Don't try to bypass access controls or reach data outside your role.",
    'Your activity (logins, views, exports, uploads) is logged and may be audited.',
    'Report any bug, security flaw or suspected data leak to the administrator.',
  ];
  const accept = () => { recordAupAcceptance(); onAccept(); };
  return (
    <Shell>
      <div className="flex items-center gap-2">
        <ShieldCheck size={16} style={{ color: 'var(--blue)' }} />
        <h1 className="text-[22px] font-extrabold tracking-[-0.02em] text-zinc-900">Acceptable use</h1>
      </div>
      <p className="text-[13px] text-zinc-500 mt-1 mb-5">
        Before you continue, please review how this internal system may be used.
      </p>

      <ul className="space-y-2.5 mb-6">
        {rules.map((r, i) => (
          <li key={i} className="flex items-start gap-2 text-[13px] leading-snug text-zinc-700">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--pos)' }} />
            <span>{r}</span>
          </li>
        ))}
      </ul>

      <button onClick={accept}
        className="w-full flex items-center justify-center gap-2 min-h-[46px] rounded-lg bg-zinc-900 text-on-ink text-[14px] font-semibold tracking-tight transition-colors hover:bg-accent outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-zinc-900">
        <CheckCircle2 size={14} /> I agree — continue
      </button>
      <button type="button" onClick={onDecline}
        className="w-full flex items-center justify-center gap-1.5 text-[13px] text-zinc-500 hover:text-zinc-900 transition-colors py-1 mt-2">
        <LogOut size={13} /> Decline &amp; sign out
      </button>
    </Shell>
  );
}

// Shown when the app is opened from a password-reset email (recovery session in the
// URL hash, already persisted by consumeRecoveryHash). Sets a new password, then
// hands control back so the (now signed-in) user lands on the dashboard.
export function ResetPassword({ onDone, kind = 'recovery' }) {
  const invite = kind === 'invite';
  const [pw, setPw]   = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (pw.length < 8) { setErr('Password must be at least 8 characters.'); return; }
    if (pw !== pw2) { setErr('Passwords don’t match.'); return; }
    setBusy(true); setErr('');
    try {
      await changePassword(pw);
      onDone();
    } catch (ex) {
      setErr(ex?.message || "Couldn't set password. The reset link may have expired — request a new one.");
      setBusy(false);
    }
  };

  return (
    <Shell>
      <div className="flex items-center gap-2">
        <KeyRound size={15} className="text-zinc-400" />
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-zinc-900">{invite ? 'Welcome to Hi-Tech' : 'Set new password'}</h1>
      </div>
      <p className="text-[13px] text-zinc-500 mt-1 mb-6">
        {invite ? 'Set a password to finish setting up your account.' : 'Choose a new password for your account.'}
      </p>

      <form onSubmit={submit} className="space-y-3.5">
        <div>
          <label htmlFor="np" className="text-[12px] font-medium text-zinc-600 mb-1.5 block">New password</label>
          <div className="relative">
            <input id="np" type={show ? 'text' : 'password'} autoComplete="new-password" autoFocus
              value={pw} onChange={e => setPw(e.target.value)}
              placeholder="At least 8 characters" className={`${field} pr-11`} />
            <button type="button" onClick={() => setShow(s => !s)}
              aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}
              className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-7 h-7 rounded-lg text-zinc-400 hover:text-zinc-700 outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>
        <div>
          <label htmlFor="np2" className="text-[12px] font-medium text-zinc-600 mb-1.5 block">Confirm new password</label>
          <input id="np2" type={show ? 'text' : 'password'} autoComplete="new-password"
            value={pw2} onChange={e => setPw2(e.target.value)}
            placeholder="Re-enter password" className={field} />
        </div>

        {err && <ErrorNote>{err}</ErrorNote>}

        <button type="submit" disabled={busy || !pw || !pw2}
          className="w-full flex items-center justify-center gap-2 min-h-[46px] rounded-lg bg-zinc-900 text-on-ink text-[14px] font-semibold tracking-tight transition-colors hover:bg-accent outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-zinc-900 disabled:opacity-60 disabled:cursor-not-allowed">
          {busy ? <><RefreshCw size={14} className="animate-spin" /> Saving…</> : <><CheckCircle2 size={14} /> Set password & sign in</>}
        </button>
      </form>
    </Shell>
  );
}
