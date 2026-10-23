import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../supabase'
import { money, KINDS, PRESETS, today } from '../lib.js'

export default function Admin({ profile, org }) {
  const [bizList, setBizList] = useState(null), [cur, setCur] = useState(null), [tab, setTab] = useState('reports')
  const loadBiz = useCallback(async () => {
    const { data } = await supabase.from('businesses').select('*').order('created_at')
    setBizList(data || [])
  }, [])
  useEffect(() => { loadBiz() }, [loadBiz])

  if (!bizList) return <div className="wrap m">Loading…</div>
  const biz = bizList.find((b) => b.id === cur)

  if (!biz) return (
    <div className="wrap">
      <div className="row sp"><h1>{org.name}</h1><button className="g" onClick={() => supabase.auth.signOut()}>Log out</button></div>
      <p className="m">{bizList.length ? 'Choose a business to open. Each keeps its own separate records.' : 'Add your first business to get started.'}</p>
      {bizList.map((b) => <button key={b.id} className="full" style={{ marginBottom: 10, padding: 18, fontSize: 17 }} onClick={() => { setCur(b.id); setTab('reports') }}>{b.name}</button>)}
      <AddBusiness onAdded={loadBiz} />
    </div>
  )

  return (
    <div className="wrap">
      <div className="row sp"><h1>{biz.name}</h1><button className="g" onClick={() => setCur(null)}>Switch business</button></div>
      <div className="seg" style={{ marginTop: 10 }}>
        {[['reports', 'Reports'], ['staff', 'Staff']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'reports' ? <Reports biz={biz} org={org} /> : <StaffTab biz={biz} org={org} />}
    </div>
  )
}

function AddBusiness({ onAdded }) {
  const [name, setName] = useState(''), [p, setP] = useState(0), [err, setErr] = useState('')
  async function add(e) {
    e.preventDefault(); setErr('')
    const { error } = await supabase.from('businesses').insert({ name: name.trim(), unit_label: PRESETS[p].unit, kinds: PRESETS[p].kinds })
    if (error) setErr(error.message); else { setName(''); onAdded() }
  }
  return (
    <form className="card" onSubmit={add}>
      <b>Add a business</b>
      <input style={{ marginTop: 8 }} placeholder="Business name, e.g. Main Street Car Wash" value={name} onChange={(e) => setName(e.target.value)} required />
      <div className="seg" style={{ flexWrap: 'wrap' }}>{PRESETS.map((x, i) => <button type="button" key={x.label} className={p === i ? 'on' : ''} onClick={() => setP(i)}>{x.label}</button>)}</div>
      <button className="full">Add business</button>{err && <div className="err">{err}</div>}
    </form>
  )
}

function Reports({ biz, org }) {
  const [rows, setRows] = useState([]), [range, setRange] = useState('today')
  useEffect(() => {
    supabase.from('entries').select('*, profiles(full_name)').eq('business_id', biz.id).order('created_at', { ascending: false }).limit(500).then(({ data }) => setRows(data || []))
  }, [biz.id])
  const list = rows.filter((r) => range === 'all' || r.entry_date === today())
  const sum = (k) => list.filter((r) => r.kind === k).reduce((a, r) => a + Number(r.amount), 0)
  const profit = sum('sale') - sum('expense') - sum('equipment') - sum('stock')
  const units = list.reduce((a, r) => a + r.units, 0)
  const c = org.currency
  return (<>
    <div className="seg">{[['today', 'Today'], ['all', 'All time']].map(([k, l]) => <button key={k} className={range === k ? 'on' : ''} onClick={() => setRange(k)}>{l}</button>)}</div>
    <div className="card">
      <div className="row sp"><b>Profit</b><b className={profit >= 0 ? 'in' : 'out'} style={{ fontSize: 24 }}>{money(profit, c)}</b></div>
      <div className="grid" style={{ marginTop: 8 }}>
        <div>Sales<b className="in">{money(sum('sale'), c)}</b></div>
        <div>Expenses<b className="out">{money(sum('expense'), c)}</b></div>
        {biz.kinds.includes('equipment') && <div>Equipment<b className="out">{money(sum('equipment'), c)}</b></div>}
        {biz.kinds.includes('stock') && <div>Stock<b className="out">{money(sum('stock'), c)}</b></div>}
        {biz.unit_label && <div>{biz.unit_label}<b>{units}</b></div>}
      </div>
    </div>
    <h2>Activity</h2>
    <div className="card">{list.slice(0, 40).map((r) => (
      <div className="item" key={r.id}><div><b>{r.note || KINDS[r.kind]}</b><div className="m">{KINDS[r.kind]} · {r.profiles?.full_name} · {r.entry_date}{r.units ? ` · ${r.units}` : ''}</div></div>
        <b className={r.kind === 'sale' ? 'in' : 'out'}>{money(r.amount, c)}</b></div>))}
      {!list.length && <div className="m">No entries yet.</div>}</div>
  </>)
}

function StaffTab({ biz, org }) {
  const [staff, setStaff] = useState([]), [f, setF] = useState({ full_name: '', username: '', pin: '' }), [msg, setMsg] = useState('')
  const load = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*').eq('business_id', biz.id).eq('role', 'staff').order('created_at')
    setStaff(data || [])
  }, [biz.id])
  useEffect(() => { load() }, [load])
  const call = async (body) => {
    const { data, error } = await supabase.functions.invoke('admin-users', { body })
    return error ? { error: data?.error || error.message } : data?.error ? { error: data.error } : data
  }
  async function create(e) {
    e.preventDefault(); setMsg('')
    const r = await call({ action: 'create', business_id: biz.id, ...f })
    if (r.error) return setMsg(r.error)
    setMsg(`Created. Company code: ${org.code} · Username: ${f.username.toLowerCase()} · PIN: ${f.pin}`)
    setF({ full_name: '', username: '', pin: '' }); load()
  }
  const toggle = async (s) => { const r = await call({ action: 'set_active', user_id: s.id, active: !s.active }); if (r.error) setMsg(r.error); load() }
  const reset = async (s) => {
    const pin = prompt('New 6-digit PIN for ' + s.full_name); if (!pin) return
    const r = await call({ action: 'reset_pin', user_id: s.id, pin }); setMsg(r.error || 'PIN changed. Tell ' + s.full_name + '.')
  }
  return (<>
    <div className="card"><div className="m">Staff log in with this company code</div><div className="code">{org.code}</div></div>
    <form className="card" onSubmit={create}>
      <b>Create staff login for {biz.name}</b>
      <input style={{ marginTop: 8 }} placeholder="Full name" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} required />
      <input placeholder="Username" autoCapitalize="none" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required />
      <input placeholder="6-digit PIN" inputMode="numeric" maxLength={6} value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} required />
      <button className="full">Create login</button>
      {msg && <div className={msg.startsWith('Created') || msg.startsWith('PIN') ? 'm' : 'err'} style={{ marginTop: 8 }}>{msg}</div>}
    </form>
    {staff.map((s) => (
      <div className="card" key={s.id}>
        <b>{s.full_name}</b><div className="m">@{s.username} · <span className={s.active ? 'in' : 'out'}>{s.active ? 'Active' : 'Deactivated'}</span></div>
        <div className="row" style={{ marginTop: 8 }}><button className="g" onClick={() => toggle(s)}>{s.active ? 'Deactivate' : 'Reactivate'}</button><button className="g" onClick={() => reset(s)}>Reset PIN</button></div>
      </div>))}
    {!staff.length && <div className="m">No staff for this business yet.</div>}
  </>)
}
