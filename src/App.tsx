import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, carregarAgentLabels } from './lib/supabase'
import Login from './components/Login'
import Inbox from './components/Inbox'
import Escalacoes from './components/Escalacoes'
import Kanban from './components/Kanban'
import Metricas from './components/Metricas'
import Agentes from './components/Agentes'
import Disparos from './components/Disparos'
import Config from './components/Config'
import Equipe from './components/Equipe'
import Comercial from './components/Comercial'

const TABS = [
  { id: 'inbox', label: 'Inbox', icon: '💬' },
  { id: 'escalacoes', label: 'Escalações', icon: '🚨' },
  { id: 'kanban', label: 'Pipeline', icon: '📋' },
  { id: 'comercial', label: 'Comercial', icon: '☎️' },
  { id: 'agentes', label: 'Agentes', icon: '🤖' },
  { id: 'disparos', label: 'Disparos', icon: '📣' },
  { id: 'metricas', label: 'Métricas', icon: '📈' },
  { id: 'equipe', label: 'Equipe', icon: '👥' },
  { id: 'config', label: 'Configuração', icon: '⚙️' },
] as const

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<string>('inbox')
  const [escAbertas, setEscAbertas] = useState(0)
  const [convParaAbrir, setConvParaAbrir] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) await carregarAgentLabels()
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      if (s) await carregarAgentLabels()
      setSession(s)
    })
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
    <div className="h-full flex flex-col md:flex-row">
      {/* Barra superior (mobile) */}
      <header className="md:hidden shrink-0 border-b border-line bg-panel/60 backdrop-blur">
        <div className="flex items-center px-4 pt-3">
          <div className="font-display font-bold text-lg leading-none">Anne<span className="text-gold">.</span>IA</div>
          <button onClick={() => supabase.auth.signOut()}
            className="ml-auto text-[11px] text-dim hover:text-danger transition-colors">sair →</button>
        </div>
        <nav className="flex gap-1 px-2 py-2 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`relative shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5
                ${tab === t.id ? 'bg-panel2 text-cream' : 'text-dim'}`}>
              <span>{t.icon}</span>{t.label}
              {t.id === 'escalacoes' && escAbertas > 0 && (
                <span className="text-[9px] font-mono font-semibold bg-danger/20 text-danger border border-danger/40 rounded-full px-1.5">
                  {escAbertas}
                </span>
              )}
            </button>
          ))}
        </nav>
      </header>

      {/* Sidebar (desktop) */}
      <aside className="hidden md:flex w-56 shrink-0 border-r border-line flex-col bg-panel/60 backdrop-blur">
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
        {tab === 'inbox' && <Inbox convInicial={convParaAbrir} aoConsumir={() => setConvParaAbrir(null)} />}
        {tab === 'escalacoes' && <Escalacoes irParaInbox={(convId?: string) => { setConvParaAbrir(convId ?? null); setTab('inbox') }} />}
        {tab === 'kanban' && <Kanban />}
        {tab === 'comercial' && <Comercial irParaInbox={(convId: string) => { setConvParaAbrir(convId); setTab('inbox') }} />}
        {tab === 'agentes' && <Agentes />}
        {tab === 'disparos' && <Disparos />}
        {tab === 'equipe' && <Equipe />}
        {tab === 'metricas' && <Metricas />}
        {tab === 'config' && <Config />}
      </main>
    </div>
  )
}
