import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, carregarAgentLabels, papelDoPainel, type PapelPainel } from './lib/supabase'
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
import Sentinela, { buscarSaude, type Saude } from './components/Sentinela'

const TABS = [
  { id: 'inbox', label: 'Inbox', icon: '💬' },
  { id: 'escalacoes', label: 'Escalações', icon: '🚨' },
  { id: 'kanban', label: 'Pipeline', icon: '📋' },
  { id: 'comercial', label: 'Comercial', icon: '☎️' },
  { id: 'agentes', label: 'Agentes', icon: '🤖' },
  { id: 'disparos', label: 'Disparos', icon: '📣' },
  { id: 'metricas', label: 'Métricas', icon: '📈' },
  { id: 'sentinela', label: 'Sentinela', icon: '🛡️' },
  { id: 'equipe', label: 'Equipe', icon: '👥' },
  { id: 'config', label: 'Configuração', icon: '⚙️' },
] as const

// vendedor (closer ou escalação) só enxerga a operação; o resto é de administrador
const TABS_VENDEDOR = ['inbox', 'escalacoes', 'comercial', 'sentinela']

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [papel, setPapel] = useState<PapelPainel | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<string>('inbox')
  const [escAbertas, setEscAbertas] = useState(0)
  const [convParaAbrir, setConvParaAbrir] = useState<string | null>(null)
  const [saude, setSaude] = useState<Saude | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) { await carregarAgentLabels(); setPapel(await papelDoPainel()) }
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      if (s) { await carregarAgentLabels(); setPapel(await papelDoPainel()) }
      else setPapel(null)
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

  // SENTINELA global: vigia a saúde em QUALQUER aba (poll 60s). Ao entrar em
  // crítico: banner vermelho em todas as abas + notificação do navegador +
  // título da janela sinalizado (para quem está em outra aba do browser).
  useEffect(() => {
    if (!session) return
    let anterior: string | null = null
    const vigiar = async () => {
      const s = await buscarSaude()
      if (!s) return
      setSaude(s)
      if (s.geral === 'crit' && anterior !== 'crit') {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          const probs = s.checks.filter(c => c.status === 'crit').map(c => c.titulo).join(' · ')
          new Notification('🔴 Anne — problema crítico', { body: probs || 'Verifique a aba Sentinela.' })
        }
      }
      document.title = s.geral === 'crit' ? '🔴 Anne.IA — PROBLEMA CRÍTICO' : 'Anne.IA'
      anterior = s.geral
    }
    vigiar()
    const t = setInterval(vigiar, 60_000)
    return () => { clearInterval(t); document.title = 'Anne.IA' }
  }, [session])

  if (loading) return <div className="h-full grid place-items-center text-dim font-mono text-sm">carregando…</div>
  if (!session) return <Login />
  if (!papel) return <div className="h-full grid place-items-center text-dim font-mono text-sm">verificando acesso…</div>

  // autenticou mas não é admin nem vendedor cadastrado: RLS já bloqueia os dados;
  // aqui só explicamos em vez de mostrar um painel vazio
  if (papel.role === 'none') return (
    <div className="h-full grid place-items-center p-6">
      <div className="text-center max-w-sm space-y-3">
        <div className="text-4xl">🔒</div>
        <div className="font-display font-semibold text-lg">Acesso não liberado</div>
        <p className="text-sm text-dim">
          O e-mail <b className="text-cream font-mono">{session.user.email}</b> não está cadastrado
          como administrador nem como vendedor. Fale com o administrador do painel.
        </p>
        <button onClick={() => supabase.auth.signOut()}
          className="text-xs text-dim border border-line rounded-lg px-4 py-2 hover:text-danger transition">sair →</button>
      </div>
    </div>
  )

  const tabs = TABS.filter(t => papel.role === 'admin' || TABS_VENDEDOR.includes(t.id))
  if (!tabs.some(t => t.id === tab)) setTab('inbox')

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
          {tabs.map(t => (
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
          {tabs.map(t => (
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
      <main className="flex-1 min-w-0 overflow-hidden flex flex-col">
        {saude?.geral === 'crit' && tab !== 'sentinela' && (
          <button onClick={() => setTab('sentinela')}
            className="shrink-0 w-full text-left bg-danger/15 border-b border-danger/60 px-4 py-2.5 flex items-center gap-2.5 hover:bg-danger/25 transition">
            <span className="w-2.5 h-2.5 rounded-full bg-danger pulse-danger shrink-0" />
            <span className="text-sm text-danger font-semibold">
              PROBLEMA CRÍTICO: {saude.checks.filter(c => c.status === 'crit').map(c => c.titulo).join(' · ')}
            </span>
            <span className="ml-auto text-[11px] text-danger/80 shrink-0">abrir Sentinela →</span>
          </button>
        )}
        <div className="flex-1 min-h-0">
        {tab === 'inbox' && <Inbox convInicial={convParaAbrir} aoConsumir={() => setConvParaAbrir(null)} isAdmin={papel.role === 'admin'} />}
        {tab === 'escalacoes' && <Escalacoes irParaInbox={(convId?: string) => { setConvParaAbrir(convId ?? null); setTab('inbox') }} />}
        {tab === 'kanban' && <Kanban />}
        {tab === 'comercial' && <Comercial irParaInbox={(convId: string) => { setConvParaAbrir(convId); setTab('inbox') }}
          isAdmin={papel.role === 'admin'} meuVendedorId={papel.vendedor_id ?? null} meuTipo={papel.tipo ?? null} />}
        {tab === 'agentes' && <Agentes />}
        {tab === 'disparos' && <Disparos />}
        {tab === 'equipe' && <Equipe />}
        {tab === 'metricas' && <Metricas />}
        {tab === 'sentinela' && <Sentinela />}
        {tab === 'config' && <Config />}
        </div>
      </main>
    </div>
  )
}
