import { useState } from 'react'
import { supabase } from '../supabase'

export default function Setup({ onDone }) {
  const [org, setOrg] = useState(''), [name, setName] = useState(''), [err, setErr] = useState('')
  async function go(e) {
    e.preventDefault(); setErr('')
    const { error } = await supabase.rpc('create_organization', { org_name: org, admin_name: name })
    if (error) setErr(error.message); else onDone()
  }
  return (
    <div className="wrap">
      <h1>Set up your company</h1>
      <form className="card" onSubmit={go} style={{ marginTop: 14 }}>
        <input placeholder="Company name" value={org} onChange={(e) => setOrg(e.target.value)} required />
        <input placeholder="Your full name" value={name} onChange={(e) => setName(e.target.value)} required />
        <button className="full">Continue</button>
        {err && <div className="err">{err}</div>}
      </form>
      <button className="g full" onClick={() => supabase.auth.signOut()}>Log out</button>
    </div>
  )
}
