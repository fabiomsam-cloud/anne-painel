import { useEffect, useState } from 'react'
import { supabase, fmtHora } from '../lib/supabase'

// ============================================================
// Fila "A ATRIBUIR" do Comercial v2 (24/10/2026, Fase 2 do Painel dos Funis).
// O banco detecta a cada 5 min (fn_cv2_detectar): escalação sem dono · negociação travada · classe A parada.
// Com a distribuição automática LIGADA (global_settings.comercial_v2.ativo) o banco entrega sozinho até o teto do dia;
// aqui o closer vê a fila e puxa para si ("Assumir", RPC fn_cv2_assumir — respeita o teto); admin assume para o vendedor escolhido.
// ============================================================

type Item = {
  id: string; conversation_id: string; gatilho: string; prioridade: number; motivo: string | null; agent_slug: string | null; classe: string | null
  criado_em: string; contacts: { name: string | null; phone: string } | null
}
const GATILHO: Record<string, string> = { escalacao: '🚨 Escalação', negociacao_travada: '💳 Negociação travada', classe_a: '🔥 Classe A parada' }

export default function FilaAtribuir({ vendSel, isAdmin, meuTipo, onAssumiu, irParaInbox }: {
  vendSel: string; isAdmin: boolean; meuTipo: string | null; onAssumiu: () => void; irParaInbox: (convId: string) => void
}) {
  const [itens, setItens] = useState<Item[]>([])
  const [aberta, setAberta] = useState(false)
  const [ocupado, setOcupado] = useState('')
  const [msg, setMsg] = useState('')
  const [cfg, setCfg] = useState<any>({})
  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(''), 7000) }

  const carregar = async () => {
    const { data } = await supabase.from('comercial_fila')
      .select('id,conversation_id,gatilho,prioridade,motivo,agent_slug,classe,criado_em,contacts(name,phone)')
      .eq('status', 'aguardando').order('prioridade').order('criado_em').limit(200)
    setItens((data as any) ?? [])
    const { data: c } = await supabase.rpc('fn_cv2_cfg')
    setCfg(c ?? {})
  }
  useEffect(() => {
    carregar()
    const ch = supabase.channel('cv2-fila')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comercial_fila' }, carregar).subscribe()
    const t = setInterval(carregar, 120000)
    return () => { supabase.removeChannel(ch); clearInterval(t) }
  }, [])

  const podeAssumir = isAdmin || meuTipo === 'closer'
  const assumir = async (it: Item) => {
    if (!podeAssumir || ocupado) return
    setOcupado(it.id)
    const { data, error } = await supabase.rpc('fn_cv2_assumir', { p_fila_id: it.id, p_vendedor_id: isAdmin ? vendSel : null })
    setOcupado('')
    if (error) return flash('⚠️ ' + error.message)
    if (!data?.ok) return flash('⚠️ ' + (data?.erro ?? 'Não foi possível assumir.'))
    flash(`☎️ ${it.contacts?.name || 'Lead'} agora está com ${data.vendedor} (${GATILHO[it.gatilho] ?? it.gatilho}).`)
    carregar(); onAssumiu()
  }
  const quentes = itens.filter(i => i.prioridade <= 2).length
  if (!itens.length && !msg) return null
  return (
    <div className="mx-4 md:mx-6 mb-2 border border-gold/30 bg-gold/5 rounded-xl">
      <button onClick={() => setAberta(a => !a)} className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm">
        <span className="font-semibold text-gold">📥 A atribuir · {itens.length}</span>
        <span className="text-[11px] text-dim">{quentes} quentes (escalação + negociação travada) · {itens.length - quentes} classe A parada
          {cfg?.ativo ? ' · distribuição automática LIGADA' : ' · distribuição automática desligada: puxe pelo botão'}
          {cfg?.teto_dia ? ` · teto ${cfg.teto_dia}/dia por vendedor` : ''}</span>
        <span className="ml-auto text-dim text-xs">{aberta ? '▲' : '▼'}</span>
      </button>
      {msg && <div className="rise mx-3 mb-2 text-xs rounded-lg border border-win/40 bg-win/10 text-win px-3 py-2">{msg}</div>}
      {aberta && (
        <div className="px-3 pb-3 space-y-1.5 max-h-72 overflow-y-auto">
          {itens.map(it => (
            <div key={it.id} className="flex items-center gap-2 flex-wrap text-[11px] bg-panel border border-line rounded-lg px-2.5 py-1.5">
              <span className="font-mono px-1.5 py-0.5 rounded border border-line text-dim" title="Prioridade">P{it.prioridade}</span>
              <span className="font-medium text-cream">{it.contacts?.name || it.contacts?.phone || '(sem nome)'}</span>
              <span className="text-gold">{GATILHO[it.gatilho] ?? it.gatilho}</span>
              {it.classe && <span className="font-mono px-1.5 py-0.5 rounded border border-line">Jev {it.classe}</span>}
              <span className="text-dim">{it.agent_slug ?? ''} · {it.motivo ?? ''} · desde {fmtHora(it.criado_em)}</span>
              <div className="ml-auto flex gap-1">
                <button onClick={() => irParaInbox(it.conversation_id)} className="text-[11px] border border-line rounded-lg px-2 py-1 text-dim hover:text-cream">💬 Ver</button>
                {podeAssumir && (
                  <button onClick={() => assumir(it)} disabled={ocupado === it.id}
                    className="text-[11px] font-semibold bg-gold/15 text-gold border border-gold/40 rounded-lg px-2 py-1 hover:bg-gold/25 disabled:opacity-40">
                    {ocupado === it.id ? '…' : '☎️ Assumir'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
