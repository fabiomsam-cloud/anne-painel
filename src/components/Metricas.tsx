import { useEffect, useState } from 'react'
import { supabase, fmtHora, fmtFone } from '../lib/supabase'

type Num = number | null
type Venda = {
  id: string; created_at: string; paid_at: string | null; product_name: string
  amount: number; attribution: string; matched_by: string
  lead_name: string | null; lead_phone: string | null
}
type Matriculado = {
  conversation_id: string; name: string | null; phone: string; won_at: string | null
  venda: { product_name: string; amount: number; attribution: string; paid_at: string } | null
  matricula_manual: { detalhes: string; por: string; em: string } | null
}

const ATTR: Record<string, { label: string; cls: string }> = {
  anne_ia: { label: '🤖 Anne IA', cls: 'text-teal border-teal/40 bg-teal/10' },
  anne_humano: { label: '👤 Humano (link)', cls: 'text-gold border-gold/40 bg-gold/10' },
  anne_disparo: { label: '📣 Disparo', cls: 'text-win border-win/40 bg-win/10' },
  externa: { label: '⚪ Externa', cls: 'text-dim border-line' },
}
const ANNE_ATTRS = ['anne_ia', 'anne_humano', 'anne_disparo']

function Card({ titulo, valor, sub, destaque, onClick }:
  { titulo: string; valor: string; sub?: string; destaque?: boolean; onClick?: () => void }) {
  return (
    <div onClick={onClick}
      className={`rise border rounded-xl p-4 ${destaque ? 'border-gold/40 bg-gold/5' : 'border-line bg-panel/50'}
        ${onClick ? 'cursor-pointer hover:brightness-125 transition' : ''}`}>
      <div className="text-[10px] font-mono text-dim uppercase tracking-widest">
        {titulo}{onClick && <span className="ml-1 text-dim/50">▸</span>}
      </div>
      <div className={`font-display font-bold text-3xl mt-1.5 ${destaque ? 'text-gold' : ''}`}>{valor}</div>
      {sub && <div className="text-[11px] text-dim mt-1">{sub}</div>}
    </div>
  )
}

export default function Metricas() {
  const [m, setM] = useState<Record<string, Num>>({})
  const [dias, setDias] = useState(7)
  const [lista, setLista] = useState<'vendas' | 'matriculados' | null>(null)
  const [vendas, setVendas] = useState<Venda[]>([])
  const [matriculados, setMatriculados] = useState<Matriculado[]>([])

  useEffect(() => {
    const desde = new Date(Date.now() - dias * 86400000).toISOString()
    const count = async (tabela: string, filtro: (q: any) => any): Promise<Num> => {
      const { count } = await filtro(supabase.from(tabela).select('*', { count: 'exact', head: true }))
      return count
    }
    ;(async () => {
      const [leads, msgsIn, msgsIa, escAbertas, escTotal, checkouts,
             vendasAnne, vendasExternas, fuEnviados, fuRespondidos, wonTotal, wonLista] =
        await Promise.all([
          count('contacts', q => q.gte('created_at', desde)),
          count('messages', q => q.eq('from_type', 'user').gte('created_at', desde)),
          count('messages', q => q.eq('from_type', 'ia').gte('created_at', desde)),
          count('escalations', q => q.eq('status', 'open')),
          count('escalations', q => q.gte('created_at', desde)),
          count('events_outbox', q => q.eq('event_type', 'checkout_enviado').gte('created_at', desde)),
          count('sales', q => q.in('attribution', ANNE_ATTRS).gte('created_at', desde)),
          count('sales', q => q.eq('attribution', 'externa').neq('matched_by', 'unmatched').gte('created_at', desde)),
          count('followup_log', q => q.gte('sent_at', desde)),
          count('followup_log', q => q.eq('replied', true).gte('sent_at', desde)),
          count('conversations', q => q.eq('status', 'won')),
          supabase.from('vw_matriculados_lista').select('venda,matricula_manual').limit(500)
            .then(({ data }) => (data as any[] | null)),
        ])
      const wonAnne = (wonLista ?? []).filter((w: any) =>
        (w.venda && ANNE_ATTRS.includes(w.venda.attribution)) || w.matricula_manual).length
      setM({ leads, msgsIn, msgsIa, escAbertas, escTotal, checkouts,
             vendasAnne, vendasExternas, fuEnviados, fuRespondidos, wonTotal, wonAnne })
    })()
  }, [dias])

  const abrirVendas = async () => {
    const desde = new Date(Date.now() - dias * 86400000).toISOString()
    const { data } = await supabase.from('vw_vendas_lista').select('*')
      .gte('created_at', desde).order('paid_at', { ascending: false }).limit(300)
    const rows = ((data as any) ?? []) as Venda[]
    rows.sort((a, b) => (ANNE_ATTRS.includes(b.attribution) ? 1 : 0) - (ANNE_ATTRS.includes(a.attribution) ? 1 : 0))
    setVendas(rows); setLista('vendas')
  }

  const abrirMatriculados = async () => {
    const { data } = await supabase.from('vw_matriculados_lista').select('*')
      .order('won_at', { ascending: false, nullsFirst: false }).limit(300)
    setMatriculados(((data as any) ?? [])); setLista('matriculados')
  }

  const pct = (a: Num, b: Num) => (b && a != null ? `${Math.round((a / b) * 100)}%` : '—')
  const n = (v: Num) => (v == null ? '…' : String(v))
  const brl = (v: number) => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="flex items-center justify-between mb-6 max-w-4xl">
        <h1 className="font-display font-bold text-2xl">Métricas</h1>
        <div className="flex gap-1 border border-line rounded-lg p-1">
          {[1, 7, 30].map(d => (
            <button key={d} onClick={() => setDias(d)}
              className={`text-xs px-3 py-1 rounded-md transition ${dias === d ? 'bg-gold text-ink font-semibold' : 'text-dim hover:text-cream'}`}>
              {d === 1 ? 'Hoje' : `${d} dias`}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-w-4xl">
        <Card titulo="Leads novos" valor={n(m.leads)} />
        <Card titulo="Msgs recebidas" valor={n(m.msgsIn)} />
        <Card titulo="Respostas da IA" valor={n(m.msgsIa)} sub={`taxa de resposta ${pct(m.msgsIa, m.msgsIn)}`} />
        <Card titulo="Escalações abertas" valor={n(m.escAbertas)} sub={`${n(m.escTotal)} no período`} />
        <Card titulo="Checkouts enviados" valor={n(m.checkouts)} destaque />
        <Card titulo="Vendas da Anne" valor={n(m.vendasAnne)} destaque onClick={abrirVendas}
          sub={`+${n(m.vendasExternas)} externas casadas · clique p/ ver`} />
        <Card titulo="Matriculados Anne" valor={n(m.wonAnne)} destaque onClick={abrirMatriculados}
          sub={`${n(m.wonTotal)} conversas fechadas no total · clique p/ ver`} />
        <Card titulo="Follow-ups enviados" valor={n(m.fuEnviados)} sub={`recuperados ${pct(m.fuRespondidos, m.fuEnviados)}`} />
      </div>

      <p className="text-[11px] text-dim/60 mt-6 max-w-2xl leading-relaxed">
        <b className="text-dim">Vendas da Anne</b> = comprador recebeu o link na conversa (IA ou humano) antes de pagar,
        ou recebeu um disparo de campanha até 7 dias antes. <b className="text-dim">Externas casadas</b> = compraram por
        outro canal, mas eram contatos da Anne — ela para de vender para eles, sem contar o crédito.
      </p>

      {/* Modal de listagem */}
      {lista && (
        <div className="fixed inset-0 z-50 bg-ink/70 backdrop-blur-sm grid place-items-center p-4" onClick={() => setLista(null)}>
          <div className="rise w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-panel border border-line rounded-2xl p-5"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center mb-4">
              <h2 className="font-display font-semibold text-lg">
                {lista === 'vendas' ? `Vendas no período (${dias === 1 ? 'hoje' : dias + ' dias'})` : 'Matriculados'}
              </h2>
              <button onClick={() => setLista(null)} className="ml-auto text-dim hover:text-cream text-xl leading-none">✕</button>
            </div>

            {lista === 'vendas' && (
              <div className="space-y-2">
                {vendas.map(v => (
                  <div key={v.id} className={`border rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap
                    ${ANNE_ATTRS.includes(v.attribution) ? 'border-line bg-panel2' : 'border-line/50 bg-panel/40 opacity-70'}`}>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{v.lead_name || fmtFone(v.lead_phone) || '(sem contato)'}</div>
                      <div className="text-[11px] text-dim truncate">{v.product_name}</div>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${ATTR[v.attribution]?.cls ?? ''}`}>
                      {ATTR[v.attribution]?.label ?? v.attribution}
                    </span>
                    <div className="ml-auto text-right shrink-0">
                      <div className="text-sm font-semibold">{brl(v.amount)}</div>
                      <div className="font-mono text-[10px] text-dim">{fmtHora(v.paid_at ?? v.created_at)}</div>
                    </div>
                  </div>
                ))}
                {vendas.length === 0 && <div className="text-center py-8 text-dim text-sm">Nenhuma venda no período.</div>}
              </div>
            )}

            {lista === 'matriculados' && (
              <div className="space-y-2">
                {matriculados.map(w => (
                  <div key={w.conversation_id} className="border border-line bg-panel2 rounded-xl px-4 py-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{w.name || fmtFone(w.phone)}</div>
                        <div className="text-[11px] text-dim truncate">
                          {w.venda ? w.venda.product_name
                            : w.matricula_manual ? '📝 registro manual: ' + w.matricula_manual.detalhes
                            : '⚠️ sem venda registrada (won manual)'}
                        </div>
                      </div>
                      {w.venda && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${ATTR[w.venda.attribution]?.cls ?? ''}`}>
                          {ATTR[w.venda.attribution]?.label ?? w.venda.attribution}
                        </span>
                      )}
                      <div className="ml-auto text-right shrink-0">
                        {w.venda && <div className="text-sm font-semibold">{brl(w.venda.amount)}</div>}
                        <div className="font-mono text-[10px] text-dim">{w.won_at ? fmtHora(w.won_at) : ''}</div>
                      </div>
                    </div>
                  </div>
                ))}
                {matriculados.length === 0 && <div className="text-center py-8 text-dim text-sm">Nenhum matriculado ainda.</div>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
