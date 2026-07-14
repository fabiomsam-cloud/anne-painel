import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import Login from './components/Login'
import Inbox from './components/Inbox'
import Escalacoes from './components/Escalacoes'
import Kanban from './components/Kanban'
import Metricas from './components/Metricas'
import Agentes from './components/Agentes'
import Config from './components/Config'

const TABS = [
  { id: 'inbox', label: 'Inbox', icon: '💬' },
  { id: 'escalacoes', label: 'Escalações', icon: '🚨' },
  { id: 'kanban', label: 'Pipeline', icon: '📋' },
  { id: 'agentes', label: 'Agentes', icon: '🤖' },
  { id: 'metricas', label: 'Métricas', icon: '📈' },
  { id: 'config', label: 'Configuração', icon: '⚙️' },
] as const

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<string>('inbox')
  const [escAbertas, setEscAbertas] = useState(0)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    const contar = async () => {
      const { count } = await supabase
        .from('escalations').select('*', { count: 'exact', head: true }).eq('status', 'open')
      setEscAbertas(count ?? 0)
    }
    contar()
    const ch = supabase.channel('esc-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'escalations' }, contar)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [session])

  if (loading) return <div className="h-full grid place-items-center text-dim font-mono text-sm">carregando…</div>
  if (!session) return <Login />

  return (
    <div className="h-full flex">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-line flex flex-col bg-panel/60 backdrop-blur">
        <div className="px-5 pt-6 pb-5 border-b border-line">
          <div className="font-display font-bold text-2xl tracking-tight leading-none">
            Anne<span className="text-gold">.</span>IA
          </div>
          <div className="font-mono text-[10px] text-dim mt-1.5 uppercase tracking-[0.2em]">Central de Comando</div>
        </div>
        <nav className="flex-1 py-4 px-3 space-y-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2.5
                ${tab === t.id ? 'tab-active bg-panel2' : 'text-dim hover:text-cream hover:bg-panel2/60'}`}>
              <span className="text-base">{t.icon}</span>
              {t.label}
              {t.id === 'escalacoes' && escAbertas > 0 && (
                <span className="ml-auto text-[10px] font-mono font-semibold bg-danger/20 text-danger border border-danger/40 rounded-full px-2 py-0.5 pulse-danger">
                  {escAbertas}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="px-5 py-4 border-t border-line">
          <div className="text-[11px] text-dim truncate font-mono">{session.user.email}</div>
          <button onClick={() => supabase.auth.signOut()}
            className="mt-2 text-[11px] text-dim hover:text-danger transition-colors">sair →</button>
        </div>
      </aside>

      {/* Conteúdo */}
      <main className="flex-1 min-w-0 overflow-hidden">
        {tab === 'inbox' && <Inbox />}
        {tab === 'escalacoes' && <Escalacoes irParaInbox={() => setTab('inbox')} />}
        {tab === 'kanban' && <Kanban />}
        {tab === 'agentes' && <Agentes />}
        {tab === 'metricas' && <Metricas />}
        {tab === 'config' && <Config />}
      </main>
    </div>
  )
}
