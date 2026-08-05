import { useEffect, useState } from 'react'
import { supabase, fmtHora, fmtFone, AGENT_LABEL } from '../lib/supabase'

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
  anne_disparo: { label: '📣 Influência disparo', cls: 'text-win border-win/40 bg-win/10' },
  externa: { label: '⚪ Externa', cls: 'text-dim border-line' },
}
// Venda da Anne = link de checkout enviado PELA PLATAFORMA antes do pagamento
// (IA ou humano). Disparo recebido é influência de campanha, não conversão.
const ANNE_ATTRS = ['anne_ia', 'anne_humano']

type AgRow = {
  agent_slug: string; mes: string
  vendas_ia: number; vendas_humano: number; vendas_anne: number; valor_anne: number | null
  influenciadas_disparo: number; outros_canais: number
  total_registradas: number; valor_total: number | null
}

// 🛡 Checkout blindado — leads do popup pré-Hubla (dados do SOU Data Core via proxy n8n)
const BLINDADO_URL = 'https://workflows.manager03.scvpgti.com.br/webhook/anne/blindado/metricas'
type BlinData = {
  capturados: { created_at: string; product_code: string | null; tem_fone: boolean }[]
  disparos: { sent_at: string; status: string; product_code: string | null; valor: number | null }[]
  campanhas: { nome: string; agent_slug: string; ativa: boolean; delay_min: number; product_codes: string[] }[]
}
const PROD_LABEL: Record<string, string> = {
  PRF_ELITE_001: 'Elite PRF', TJAM_ELITE_001: 'Elite TJ-AM', INSS_ELITE_001: 'Elite INSS',
  DIAMANTE_ELITE_001: 'Elite Diamante', POLICIAL_ELITE_001: 'Elite Policial',
  SEDUCAM_ELITE_001: 'Elite SEDUC-AM', SEDUCPA_ELITE_001: 'Elite SEDUC-PA',
  SEMSA_ELITE_001: 'Elite SEMSA', SES_ELITE_001: 'Elite SES-AM',
  MANAUSPREV_ELITE_001: 'Elite ManausPrev', PCAM_ELITE_001: 'Elite PC-AM',
}

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
  const [agRows, setAgRows] = useState<AgRow[]>([])
  const [mesSel, setMesSel] = useState('')
  const [blin, setBlin] = useState<BlinData | null>(null)
  const [blinAnne, setBlinAnne] = useState<{ enviados: Num; pulados: Num; responderam: Num; won: Num }>({
    enviados: null, pulados: null, responderam: null, won: null })

  useEffect(() => {
    fetch(BLINDADO_URL).then(r => r.json()).then(setBlin).catch(() => setBlin({ capturados: [], disparos: [], campanhas: [] }))
  }, [])

  useEffect(() => {
    const desde = new Date(Date.now() - dias * 86400000).toISOString()
    ;(async () => {
      const [{ data: recips }, { data: convs }] = await Promise.all([
        supabase.from('broadcast_recipients')
          .select('status,created_at,broadcast_campaigns!inner(name)')
          .like('broadcast_campaigns.name', 'BLINDADO%')
          .gte('created_at', desde).limit(5000),
        supabase.from('conversations')
          .select('status,won_at,last_user_message_at,created_at')
          .ilike('contexto->>origem_disparo', 'BLINDADO%')
          .gte('created_at', desde).limit(5000),
      ])
      const rs = (recips as any[]) ?? []
      const cs = (convs as any[]) ?? []
      setBlinAnne({
        enviados: rs.filter(r => r.status === 'sent').length,
        pulados: rs.filter(r => String(r.status).startsWith('skipped') || r.status === 'failed').length,
        responderam: cs.filter(c => c.last_user_message_at).length,
        won: cs.filter(c => c.status === 'won' || c.won_at).length,
      })
    })()
  }, [dias])

  useEffect(() => {
    supabase.from('vw_vendas_agentes').select('*').order('mes', { ascending: false })
      .then(({ data }) => {
        const rows = ((data as any) ?? []) as AgRow[]
        setAgRows(rows)
        if (rows.length) setMesSel(m => m || rows[0].mes)
      })
  }, [])

  useEffect(() => {
    const desde = new Date(Date.now() - dias * 86400000).toISOString()
    const count = async (tabela: string, filtro: (q: any) => any): Promise<Num> => {
      const { count } = await filtro(supabase.from(tabela).select('*', { count: 'exact', head: true }))
      return count
    }
    ;(async () => {
      const [leads, msgsIn, msgsIa, escAbertas, escTotal, checkouts,
             vendasAnne, vendasDisparo, vendasExternas, fuEnviados, fuRespondidos, wonTotal, wonLista] =
        await Promise.all([
          count('contacts', q => q.gte('created_at', desde)),
          count('messages', q => q.eq('from_type', 'user').gte('created_at', desde)),
          count('messages', q => q.eq('from_type', 'ia').gte('created_at', desde)),
          count('escalations', q => q.eq('status', 'open')),
          count('escalations', q => q.gte('created_at', desde)),
          count('events_outbox', q => q.eq('event_type', 'checkout_enviado').gte('created_at', desde)),
          count('sales', q => q.in('attribution', ANNE_ATTRS).gte('created_at', desde)),
          count('sales', q => q.eq('attribution', 'anne_disparo').gte('created_at', desde)),
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
             vendasAnne, vendasDisparo, vendasExternas, fuEnviados, fuRespondidos, wonTotal, wonAnne })
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
          sub={`+${n(m.vendasDisparo)} influência disparo · +${n(m.vendasExternas)} externas · clique p/ ver`} />
        <Card titulo="Matriculados Anne" valor={n(m.wonAnne)} destaque onClick={abrirMatriculados}
          sub={`${n(m.wonTotal)} conversas fechadas no total · clique p/ ver`} />
        <Card titulo="Follow-ups enviados" valor={n(m.fuEnviados)} sub={`recuperados ${pct(m.fuRespondidos, m.fuEnviados)}`} />
      </div>

      {/* Desempenho por agente (vw_vendas_agentes) */}
      <div className="max-w-4xl mt-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display font-semibold text-lg">Desempenho por agente</h2>
          {agRows.length > 0 && (
            <div className="flex gap-1 border border-line rounded-lg p-1">
              {[...new Set(agRows.map(r => r.mes))].slice(0, 4).map(mes => (
                <button key={mes} onClick={() => setMesSel(mes)}
                  className={`text-xs px-3 py-1 rounded-md transition ${mesSel === mes ? 'bg-gold text-ink font-semibold' : 'text-dim hover:text-cream'}`}>
                  {new Date(mes).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' })}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="border border-line rounded-xl overflow-x-auto bg-panel/50">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] font-mono text-dim uppercase tracking-widest border-b border-line">
                <th className="text-left px-4 py-2.5">Agente</th>
                <th className="text-right px-3 py-2.5">🤖 IA</th>
                <th className="text-right px-3 py-2.5">👤 Humano</th>
                <th className="text-right px-3 py-2.5">Anne</th>
                <th className="text-right px-3 py-2.5">Valor Anne</th>
                <th className="text-right px-3 py-2.5">📣 Influência</th>
                <th className="text-right px-4 py-2.5">Outros canais</th>
              </tr>
            </thead>
            <tbody>
              {agRows.filter(r => r.mes === mesSel).sort((a, b) => b.vendas_anne - a.vendas_anne).map(r => (
                <tr key={r.agent_slug} className="border-b border-line/50 last:border-0">
                  <td className="px-4 py-2.5 font-medium">{AGENT_LABEL[r.agent_slug] ?? r.agent_slug ?? '(sem agente)'}</td>
                  <td className="px-3 py-2.5 text-right text-teal font-semibold">{r.vendas_ia}</td>
                  <td className="px-3 py-2.5 text-right text-gold font-semibold">{r.vendas_humano}</td>
                  <td className="px-3 py-2.5 text-right font-bold">{r.vendas_anne}</td>
                  <td className="px-3 py-2.5 text-right">{r.valor_anne != null ? brl(Number(r.valor_anne)) : '—'}</td>
                  <td className="px-3 py-2.5 text-right text-dim">{r.influenciadas_disparo}</td>
                  <td className="px-4 py-2.5 text-right text-dim">{r.outros_canais}</td>
                </tr>
              ))}
              {agRows.filter(r => r.mes === mesSel).length === 0 && (
                <tr><td colSpan={7} className="text-center py-6 text-dim text-sm">Sem vendas registradas no mês.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 🛡 Checkout Blindado — funil da régua */}
      {blin && (() => {
        const desde = Date.now() - dias * 86400000
        const cap = blin.capturados.filter(c => new Date(c.created_at).getTime() >= desde)
        const disp = blin.disparos.filter(d => new Date(d.sent_at).getTime() >= desde)
        const conv = disp.filter(d => d.status === 'convertido')
        const convValor = conv.reduce((s, d) => s + (Number(d.valor) || 0), 0)
        const pausada = blin.campanhas.length > 0 && blin.campanhas.every(c => !c.ativa)
        const porProduto = Object.values(cap.reduce((m: Record<string, any>, c) => {
          const k = c.product_code || '(sem produto)'
          m[k] = m[k] || { code: k, cap: 0, atk: 0, conv: 0, valor: 0 }
          m[k].cap++
          return m
        }, {}))
        for (const d of disp) {
          const k = d.product_code || '(sem produto)'
          const row: any = (porProduto as any[]).find(p => p.code === k)
          if (!row) continue
          row.atk++
          if (d.status === 'convertido') { row.conv++; row.valor += Number(d.valor) || 0 }
        }
        return (
          <div className="max-w-4xl mt-8">
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <h2 className="font-display font-semibold text-lg">🛡 Checkout Blindado</h2>
              {pausada
                ? <span className="text-[10px] px-2 py-0.5 rounded-full border border-gold/40 bg-gold/10 text-gold">⏸ régua PAUSADA — capturando leads, sem disparos</span>
                : blin.campanhas.some(c => c.ativa)
                ? <span className="text-[10px] px-2 py-0.5 rounded-full border border-teal/40 bg-teal/10 text-teal">▶ régua ativa · delay {blin.campanhas.find(c => c.ativa)?.delay_min ?? 10} min</span>
                : null}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <Card titulo="Capturados no popup" valor={String(cap.length)}
                sub={`${cap.filter(c => c.tem_fone).length} com telefone`} />
              <Card titulo="Atacados pela régua" valor={String(disp.length)}
                sub={`${pct(disp.length, cap.length)} dos capturados`} />
              <Card titulo="Entregues" valor={n(blinAnne.enviados)}
                sub={`${n(blinAnne.pulados)} pulados (opt-out/conversa ativa)`} />
              <Card titulo="Responderam" valor={n(blinAnne.responderam)}
                sub={`${pct(blinAnne.responderam, blinAnne.enviados)} dos entregues · ${n(blinAnne.won)} matriculados`} />
              <Card titulo="Convertidos" valor={String(conv.length)} destaque
                sub={convValor ? `recuperado ${brl(convValor)}` : `${pct(conv.length, disp.length)} dos atacados`} />
            </div>
            {(porProduto as any[]).length > 0 && (
              <div className="border border-line rounded-xl overflow-x-auto bg-panel/50 mt-3">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] font-mono text-dim uppercase tracking-widest border-b border-line">
                      <th className="text-left px-4 py-2.5">Produto</th>
                      <th className="text-right px-3 py-2.5">Capturados</th>
                      <th className="text-right px-3 py-2.5">Atacados</th>
                      <th className="text-right px-3 py-2.5">Convertidos</th>
                      <th className="text-right px-4 py-2.5">Recuperado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(porProduto as any[]).sort((a, b) => b.cap - a.cap).map(p => (
                      <tr key={p.code} className="border-b border-line/50 last:border-0">
                        <td className="px-4 py-2.5 font-medium">{PROD_LABEL[p.code] ?? p.code}</td>
                        <td className="px-3 py-2.5 text-right font-semibold">{p.cap}</td>
                        <td className="px-3 py-2.5 text-right text-dim">{p.atk}</td>
                        <td className="px-3 py-2.5 text-right text-win font-semibold">{p.conv}</td>
                        <td className="px-4 py-2.5 text-right">{p.valor ? brl(p.valor) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[11px] text-dim/60 mt-2 leading-relaxed">
              <b className="text-dim">Capturados</b> = preencheram o popup pré-checkout no portal.
              <b className="text-dim"> Atacados</b> = não compraram em {blin.campanhas[0]?.delay_min ?? 10} min e entraram na régua.
              <b className="text-dim"> Entregues/Responderam</b> = etapa WhatsApp aqui na Anne.
              Quem compra antes do disparo é excluído automaticamente — configuração na aba 🛡 do painel de produtos.
            </p>
          </div>
        )
      })()}

      <p className="text-[11px] text-dim/60 mt-6 max-w-2xl leading-relaxed">
        <b className="text-dim">Vendas da Anne</b> = o comprador recebeu o link de pagamento pela plataforma
        (🤖 IA ou 👤 humano que assumiu) na conversa, antes de pagar. <b className="text-dim">Influência disparo</b> =
        recebeu campanha até 7 dias antes mas comprou sem link da conversa — influência, não conversão.
        <b className="text-dim"> Externas</b> = compraram por outro canal, mas eram contatos da Anne — ela para de
        vender para eles, sem contar o crédito.
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
