import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../supabase'
import { money, KINDS, compress } from '../lib.js'

export default function Staff({ profile, org }) {
  const [biz, setBiz] = useState(null), [rows, setRows] = useState([])
  const [kind, setKind] = useState('sale'), [amount, setAmount] = useState(''), [units, setUnits] = useState('')
  const [note, setNote] = useState(''), [file, setFile] = useState(null), [busy, setBusy] = useState(false), [err, setErr] = useState('')

  const load = useCallback(async () => {
    const { data: b } = await supabase.from('businesses').select('*').eq('id', profile.business_id).single()
    setBiz(b)
    const { data } = await supabase.from('entries').select('*').order('created_at', { ascending: false })
    setRows(data || [])
  }, [profile.business_id])
  useEffect(() => { load() }, [load])

  async function save(e) {
    e.preventDefault(); setErr(''); setBusy(true)
    let receipt_path = null
    if (file && kind !== 'sale') {
      receipt_path = `${profile.org_id}/${biz.id}/${crypto.randomUUID()}.jpg`
      const up = await supabase.storage.from('receipts').upload(receipt_path, await compress(file), { contentType: 'image/jpeg' })
      if (up.error) { setErr(up.error.message); setBusy(false); return }
    }
    const { error } = await supabase.from('entries').insert({
      business_id: biz.id, kind, amount: Number(amount), note: note.trim() || null, receipt_path,
      units: kind === 'sale' && biz.unit_label ? Number(units) || 0 : 0,
    })
    if (error) setErr(error.message)
    else { setAmount(''); setUnits(''); setNote(''); setFile(null); e.target.reset(); load() }
    setBusy(false)
  }

  if (!biz) return <div className="wrap m">Loading…</div>
  const sum = (f) => rows.filter(f).reduce((a, r) => a + Number(r.amount), 0)
  const unitsToday = rows.reduce((a, r) => a + r.units, 0)

  return (
    <div className="wrap">
      <div className="row sp"><div><h1>{biz.name}</h1><div className="m">{profile.full_name}</div></div>
        <button className="g" onClick={() => supabase.auth.signOut()}>Log out</button></div>
      <form className="card" onSubmit={save} style={{ marginTop: 14 }}>
        <div className="seg">{biz.kinds.map((k) => <button type="button" key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{KINDS[k]}</button>)}</div>
        <input type="number" inputMode="decimal" step="0.01" min="0.01" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        {biz.unit_label && kind === 'sale' && <input type="number" inputMode="numeric" min="0" placeholder={biz.unit_label} value={units} onChange={(e) => setUnits(e.target.value)} />}
        <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        {kind !== 'sale' && <><div className="m">Receipt photo</div><input type="file" accept="image/*" capture="environment" onChange={(e) => setFile(e.target.files[0])} /></>}
        <button className="full" disabled={busy}>Save</button>
        {err && <div className="err">{err}</div>}
      </form>
      <h2>Today</h2>
      <div className="card">
        <div className="grid">
          <div>In<b className="in">{money(sum((r) => r.kind === 'sale'), org.currency)}</b></div>
          <div>Out<b className="out">{money(sum((r) => r.kind !== 'sale'), org.currency)}</b></div>
          {biz.unit_label && <div>{biz.unit_label}<b>{unitsToday}</b></div>}
        </div>
        {rows.map((r) => (
          <div className="item" key={r.id}><div><b>{r.note || KINDS[r.kind]}</b><div className="m">{KINDS[r.kind]}{r.units ? ` · ${r.units}` : ''}</div></div>
            <b className={r.kind === 'sale' ? 'in' : 'out'}>{money(r.amount, org.currency)}</b></div>
        ))}
        {!rows.length && <div className="m" style={{ marginTop: 8 }}>Nothing recorded yet today.</div>}
      </div>
    </div>
  )
}
