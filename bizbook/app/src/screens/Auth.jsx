import { useState } from 'react'
import { supabase } from '../supabase'

export default function Auth() {
  const [mode, setMode] = useState('staff')
  const [f, setF] = useState({ code: '', username: '', pin: '', email: '', password: '' })
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  async function submit(e) {
    e.preventDefault(); setMsg(''); setBusy(true)
    let r
    if (mode === 'staff') {
      const email = `${f.username.trim().toLowerCase()}@${f.code.trim().toLowerCase()}.bizbook.app`
      r = await supabase.auth.signInWithPassword({ email, password: f.pin })
      if (r.error) r.error.message = 'Wrong company code, username or PIN.'
    } else if (mode === 'owner') {
      r = await supabase.auth.signInWithPassword({ email: f.email.trim(), password: f.password })
    } else {
      r = await supabase.auth.signUp({ email: f.email.trim(), password: f.password })
      if (!r.error && !r.data.session) setMsg('Check your email to confirm your account, then log in as owner.')
    }
    if (r.error) setMsg(r.error.message)
    setBusy(false)
  }

  return (
    <div className="wrap">
      <h1>BizBook</h1>
      <p className="m">Run every business you own from one place.</p>
      <div className="seg">
        {[['staff', 'Staff login'], ['owner', 'Owner login'], ['signup', 'Create account']].map(([k, l]) => (
          <button key={k} className={mode === k ? 'on' : ''} onClick={() => { setMode(k); setMsg('') }}>{l}</button>
        ))}
      </div>
      <form className="card" onSubmit={submit}>
        {mode === 'staff' ? (<>
          <input placeholder="Company code" value={f.code} onChange={set('code')} autoCapitalize="none" required />
          <input placeholder="Username" value={f.username} onChange={set('username')} autoCapitalize="none" required />
          <input placeholder="6-digit PIN" type="password" inputMode="numeric" value={f.pin} onChange={set('pin')} required />
        </>) : (<>
          <input placeholder="Email" type="email" value={f.email} onChange={set('email')} required />
          <input placeholder="Password (6+ characters)" type="password" value={f.password} onChange={set('password')} minLength={6} required />
        </>)}
        <button className="full" disabled={busy}>{mode === 'signup' ? 'Create account' : 'Log in'}</button>
        {msg && <div className="err">{msg}</div>}
      </form>
      {mode === 'signup' && <p className="m">Free for 14 days. No card needed.</p>}
    </div>
  )
}
