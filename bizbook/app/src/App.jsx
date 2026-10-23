import { useEffect, useState, useCallback } from 'react'
import { supabase } from './supabase'
import Auth from './screens/Auth.jsx'
import Setup from './screens/Setup.jsx'
import Admin from './screens/Admin.jsx'
import Staff from './screens/Staff.jsx'

export default function App() {
  const [session, setSession] = useState(undefined)
  const [ctx, setCtx] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const refresh = useCallback(async () => {
    const { data: p } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
    if (!p) return setCtx({ needsOrg: true })
    if (!p.active) {
      await supabase.auth.signOut()
      return alert('Your access has been deactivated. Ask your admin.')
    }
    const { data: org } = await supabase.from('organizations').select('*').eq('id', p.org_id).single()
    setCtx({ profile: p, org })
  }, [session])

  useEffect(() => {
    if (session === undefined) return
    if (!session) return setCtx(null)
    refresh()
  }, [session, refresh])

  if (session === undefined) return <div className="wrap m">Loading…</div>
  if (!session) return <Auth />
  if (!ctx) return <div className="wrap m">Loading…</div>
  if (ctx.needsOrg) return <Setup onDone={refresh} />
  const props = { profile: ctx.profile, org: ctx.org, reloadOrg: refresh }
  return ctx.profile.role === 'admin' ? <Admin {...props} /> : <Staff {...props} />
}
