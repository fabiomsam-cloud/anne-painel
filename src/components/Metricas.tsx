import { useEffect, useState } from 'react'
import { supabase, fmtHora, fmtFone, AGENT_LABEL, STATUS_META } from '../lib/supabase'

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
  anne_blindado: { label: '🛡 Checkout Blindado', cls: 'text-gold border-gold/50 bg-gold/15' },
  anne_disparo: { label: '📣 Influência disparo', cls: 'text-win border-win/40 bg-win/10' },
  externa: { label: '⚪ Externa', cls: 'text-dim border-line' },
}
// Venda da Anne = link de checkout enviado PELA PLATAFORMA antes do pagamento
// (IA ou humano). Disparo recebido é influência de campanha, não conversão.
// blindado conta como venda da Anne (conversão direta da régua) desde 10/08
const ANNE_ATTRS = ['anne_ia', 'anne_humano', 'anne_blindado']

type AgRow = {
  agent_slug: string; mes: string
  vendas_ia: number; vendas_humano: number; vendas_anne: number; valor_anne: number | null
  vendas_blindado: number; influenciadas_disparo: number; outros_canais: number
  total_registradas: number; valor_total: number | null
}

// Período dos filtros em DIA CALENDÁRIO de Manaus (UTC-4, sem horário de verão):
// "hoje" = desde 00:00 de Manaus, nunca janela móvel de 24h (confundia com vendas de ontem)
const MANAUS_OFF = '-04:00'
const diaManaus = (t: number) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Manaus' })
const inicioDia = (ymd: string) => new Date(ymd + 'T00:00:00' + MANAUS_OFF).toISOString()
type Periodo = { tipo: 'hoje' | 'ontem' | 'd7' | 'd30' | 'mes' | 'tudo' | 'custom'; de: string; ate: string }
function rangePeriodo(p: Periodo): { de: string | null; ate: string | null } {
  const agora = Date.now()
  if (p.tipo === 'hoje') return { de: inicioDia(diaManaus(agora)), ate: null }
  if (p.tipo === 'ontem') return { de: inicioDia(diaManaus(agora - 86400000)), ate: inicioDia(diaManaus(agora)) }
  if (p.tipo === 'd7') return { de: inicioDia(diaManaus(agora - 6 * 86400000)), ate: null }
  if (p.tipo === 'd30') return { de: inicioDia(diaManaus(agora - 29 * 86400000)), ate: null }
  if (p.tipo === 'mes') return { de: inicioDia(diaManaus(agora).slice(0, 8) + '01'), ate: null }
  if (p.tipo === 'custom' && p.de) return {
    de: inicioDia(p.de),
    ate: p.ate ? new Date(new Date(p.ate + 'T00:00:00' + MANAUS_OFF).getTime() + 86400000).toISOString() : null,
  }
  return { de: null, ate: null }
}
function labelPeriodo(p: Periodo) {
  if (p.tipo === 'hoje') return 'hoje'
  if (p.tipo === 'ontem') return 'ontem'
  if (p.tipo === 'd7') return '7 dias'
  if (p.tipo === 'd30') return '30 dias'
  if (p.tipo === 'mes') return 'este mês'
  if (p.tipo === 'custom') return `${p.de || '…'} → ${p.ate || 'hoje'}`
  return 'todo período'
}

// Funil por agente/etapa (fn_funil_agentes — agregado no banco)
type FunilRow = { agent_slug: string; bucket: string; total: number; parados: number }
const FUNIL_COLS = [
  { k: 'novo', label: '🆕 Novo', hint: 'nunca respondeu' },
  { k: 'fase1', label: 'Fase 1' }, { k: 'fase2', label: 'Fase 2' },
  { k: 'fase3', label: 'Fase 3' }, { k: 'fase4', label: 'Fase 4' },
  { k: 'followup', label: '📨 Régua' }, { k: 'resgate', label: '😴 Dormant' },
  { k: 'humano', label: '👤 Humano' }, { k: 'won', label: '✅ Matric.' },
]

// 💸 Custos de template Meta (fn_custos_templates — tarifa em global_settings.tarifa_template)
type CustoAgente = {
  agent_slug: string; templates: number; custo: number
  vendas_anne: number; receita_anne: number; influenciadas: number; receita_influencia: number
}
type CustoCampanha = { name: string; agent_slug: string; inicio: string; enviados: number; respostas: number; custo: number }
type CustoAcao = { acao: string; templates: number; custo: number }
type CustoData = { tarifa: number; agentes: CustoAgente[]; campanhas: CustoCampanha[]; acoes: CustoAcao[] }
const ACAO_LABEL: Record<string, string> = {
  disparo: '📣 Disparo em massa', convite: '💌 Convite (disparo)', followup: '📨 Follow-up (régua)',
  blindado: '🛡 Checkout blindado', carrinho: '🛒 Carrinho abandonado', retomada: '🔄 Retomada',
  nutricao: '🌱 Nutrição', outros: 'Outros',
}

// 🛡 Checkout blindado — leads do popup pré-Hubla (dados do SOU Data Core via proxy n8n)
const BLINDADO_URL = 'https://workflows.manager03.scvpgti.com.br/webhook/anne/blindado/metricas'
type BlinData = {
  capturados: { created_at: string; product_code: string | null; tem_fone: boolean }[]
  disparos: { sent_at: string; status: string; product_code: string | null; valor: number | null; phone_norm?: string | null }[]
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
  const [periodo, setPeriodo] = useState<Periodo>({ tipo: 'hoje', de: '', ate: '' })
  const [funil, setFunil] = useState<FunilRow[]>([])
  const [lista, setLista] = useState<'vendas' | 'matriculados' | 'checkouts' | null>(null)
  const [checkouts, setCheckouts] = useState<{ id: string; created_at: string; agent_slug: string; via: string; name: string | null; phone: string | null; conv_status: string | null; matriculado: boolean }[]>([])
  const [vendas, setVendas] = useState<Venda[]>([])
  const [matriculados, setMatriculados] = useState<Matriculado[]>([])
  const [agRows, setAgRows] = useState<AgRow[]>([])
  const [mesSel, setMesSel] = useState('')
  const [blin, setBlin] = useState<BlinData | null>(null)
  const [custos, setCustos] = useState<CustoData | null>(null)
  const [blinAnne, setBlinAnne] = useState<{ enviados: Num; pulados: Num; responderam: Num; won: Num }>({
    enviados: null, pulados: null, responderam: null, won: null })

  useEffect(() => {
    fetch(BLINDADO_URL).then(r => r.json()).then(setBlin).catch(() => setBlin({ capturados: [], disparos: [], campanhas: [] }))
  }, [])

  useEffect(() => {
    const { de, ate } = rangePeriodo(periodo)
    const per = (q: any, col = 'created_at') => {
      if (de) q = q.gte(col, de)
      if (ate) q = q.lt(col, ate)
      return q
    }
    ;(async () => {
      const [{ data: recips }, { data: convs }] = await Promise.all([
        per(supabase.from('broadcast_recipients')
          .select('status,created_at,broadcast_campaigns!inner(name)')
          .like('broadcast_campaigns.name', 'BLINDADO%')).limit(5000),
        per(supabase.from('conversations')
          .select('status,won_at,last_user_message_at,created_at')
          .ilike('contexto->>origem_disparo', 'BLINDADO%')).limit(5000),
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
  }, [periodo])

  // Funil por agente/etapa — agregação roda no banco (RPC), volta ~dezenas de linhas
  useEffect(() => {
    const { de, ate } = rangePeriodo(periodo)
    supabase.rpc('fn_funil_agentes', { p_desde: de, p_ate: ate })
      .then(({ data }) => setFunil(((data as any) ?? []) as FunilRow[]))
  }, [periodo])

  // 💸 Custos de template Meta — agregação no banco (RPC), segue o filtro de período
  useEffect(() => {
    const { de, ate } = rangePeriodo(periodo)
    setCustos(null)
    supabase.rpc('fn_custos_templates', { p_desde: de, p_ate: ate })
      .then(({ data }) => setCustos((data as any) ?? null))
  }, [periodo])

  useEffect(() => {
    supabase.from('vw_vendas_agentes').select('*').order('mes', { ascending: false })
      .then(({ data }) => {
        const rows = ((data as any) ?? []) as AgRow[]
        setAgRows(rows)
        if (rows.length) setMesSel(m => m || rows[0].mes)
      })
  }, [])

  useEffect(() => {
    const { de, ate } = rangePeriodo(periodo)
    const per = (q: any, col = 'created_at') => {
      if (de) q = q.gte(col, de)
      if (ate) q = q.lt(col, ate)
      return q
    }
    const count = async (tabela: string, filtro: (q: any) => any): Promise<Num> => {
      const { count } = await filtro(supabase.from(tabela).select('*', { count: 'exact', head: true }))
      return count
    }
    ;(async () => {
      const [leads, msgsIn, msgsIa, escAbertas, escTotal, checkouts, checkoutsFu,
             vendasAnne, vendasCross, vendasDisparo, vendasExternas, fuEnviados, fuRespondidos, wonTotal, wonLista] =
        await Promise.all([
          count('contacts', q => per(q)),
          count('messages', q => per(q.eq('from_type', 'user'))),
          count('messages', q => per(q.eq('from_type', 'ia'))),
          count('escalations', q => q.eq('status', 'open')),
          count('escalations', q => per(q)),
          count('events_outbox', q => per(q.eq('event_type', 'checkout_enviado'))),
          // eventos antigos não têm payload.via — followup é explícito; conversa = total − followup
          count('events_outbox', q => per(q.eq('event_type', 'checkout_enviado').eq('payload->>via', 'followup'))),
          count('sales', q => per(q.in('attribution', ANNE_ATTRS))),
          // cross-sell: lead em conversa com um agente comprou produto de OUTRO agente
          count('sales', q => per(q.eq('matched_by', 'phone_outro_agente'))),
          count('sales', q => per(q.eq('attribution', 'anne_disparo'))),
          count('sales', q => per(q.eq('attribution', 'externa')
            .neq('matched_by', 'unmatched').neq('matched_by', 'phone_outro_agente'))),
          count('followup_log', q => per(q, 'sent_at')),
          count('followup_log', q => per(q.eq('replied', true), 'sent_at')),
          count('conversations', q => q.eq('status', 'won')),
          supabase.from('vw_matriculados_lista').select('venda,matricula_manual').limit(500)
            .then(({ data }) => (data as any[] | null)),
        ])
      const wonAnne = (wonLista ?? []).filter((w: any) =>
        (w.venda && ANNE_ATTRS.includes(w.venda.attribution)) || w.matricula_manual).length
      setM({ leads, msgsIn, msgsIa, escAbertas, escTotal, checkouts, checkoutsFu,
             vendasAnne, vendasCross, vendasDisparo, vendasExternas, fuEnviados, fuRespondidos, wonTotal, wonAnne })
    })()
  }, [periodo])

  const abrirCheckouts = async () => {
    const { de, ate } = rangePeriodo(periodo)
    let q = supabase.from('vw_checkouts_lista').select('*')
    if (de) q = q.gte('created_at', de)
    if (ate) q = q.lt('created_at', ate)
    const { data } = await q.order('created_at', { ascending: false }).limit(1000)
    setCheckouts(((data as any) ?? [])); setLista('checkouts')
  }

  const abrirVendas = async () => {
    const { de, ate } = rangePeriodo(periodo)
    let q = supabase.from('vw_vendas_lista').select('*')
    if (de) q = q.gte('created_at', de)
    if (ate) q = q.lt('created_at', ate)
    const { data } = await q.order('paid_at', { ascending: false }).limit(300)
    const rows = ((data as any) ?? []) as Venda[]
    // Anne primeiro, depois cross-sell (outro produto), depois influência/externas
    const peso = (v: Venda) => ANNE_ATTRS.includes(v.attribution) ? 2 : v.matched_by === 'phone_outro_agente' ? 1 : 0
    rows.sort((a, b) => peso(b) - peso(a))
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
      <div className="flex items-center justify-between mb-6 max-w-4xl flex-wrap gap-2">
        <h1 className="font-display font-bold text-2xl">Métricas</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1 border border-line rounded-lg p-1">
            {([['hoje', 'Hoje'], ['ontem', 'Ontem'], ['d7', '7 dias'], ['d30', '30 dias'], ['mes', 'Este mês'], ['tudo', 'Todo período'], ['custom', '🗓 Personalizado']] as const).map(([t, lbl]) => (
              <button key={t} onClick={() => setPeriodo(p => ({ ...p, tipo: t }))}
                className={`text-xs px-3 py-1 rounded-md transition ${periodo.tipo === t ? 'bg-gold text-ink font-semibold' : 'text-dim hover:text-cream'}`}>
                {lbl}
              </button>
            ))}
          </div>
          {periodo.tipo === 'custom' && (
            <div className="flex items-center gap-1.5 border border-line rounded-lg px-2 py-1">
              <input type="date" value={periodo.de} max={periodo.ate || undefined}
                onChange={e => setPeriodo(p => ({ ...p, de: e.target.value }))}
                className="bg-transparent text-xs text-cream outline-none [color-scheme:dark]" />
              <span className="text-dim text-xs">→</span>
              <input type="date" value={periodo.ate} min={periodo.de || undefined}
                onChange={e => setPeriodo(p => ({ ...p, ate: e.target.value }))}
                className="bg-transparent text-xs text-cream outline-none [color-scheme:dark]" />
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-w-4xl">
        <Card titulo="Leads novos" valor={n(m.leads)} />
        <Card titulo="Msgs recebidas" valor={n(m.msgsIn)} />
        <Card titulo="Respostas da IA" valor={n(m.msgsIa)} sub={`taxa de resposta ${pct(m.msgsIa, m.msgsIn)}`} />
        <Card titulo="Escalações abertas" valor={n(m.escAbertas)} sub={`${n(m.escTotal)} no período`} />
        <Card titulo="Checkouts enviados" valor={n(m.checkouts)} destaque onClick={abrirCheckouts}
          sub={m.checkouts == null || m.checkoutsFu == null ? 'clique para ver a lista por agente'
            : `💬 ${m.checkouts - m.checkoutsFu} pedidos em conversa · ⏰ ${m.checkoutsFu} via follow-up · clique p/ ver`} />
        <Card titulo="Vendas da Anne"
          valor={m.vendasAnne == null || m.vendasCross == null ? '…' : String(m.vendasAnne + m.vendasCross)}
          destaque onClick={abrirVendas}
          sub={`${n(m.vendasAnne)} do agente · +${n(m.vendasCross)} outro produto · +${n(m.vendasDisparo)} influência disparo · +${n(m.vendasExternas)} externas · clique p/ ver`} />
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
                <th className="text-right px-3 py-2.5">🛡 Blindado</th>
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
                  <td className="px-3 py-2.5 text-right text-gold">{r.vendas_blindado ?? 0}</td>
                  <td className="px-3 py-2.5 text-right font-bold">{r.vendas_anne}</td>
                  <td className="px-3 py-2.5 text-right">{r.valor_anne != null ? brl(Number(r.valor_anne)) : '—'}</td>
                  <td className="px-3 py-2.5 text-right text-dim">{r.influenciadas_disparo}</td>
                  <td className="px-4 py-2.5 text-right text-dim">{r.outros_canais}</td>
                </tr>
              ))}
              {agRows.filter(r => r.mes === mesSel).length === 0 && (
                <tr><td colSpan={8} className="text-center py-6 text-dim text-sm">Sem vendas registradas no mês.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 🎯 Controle do funil por agente/etapa */}
      {(() => {
        const slugs = [...new Set(funil.map(r => r.agent_slug))]
          .filter(s => s !== 'roteador')
          .sort((a, b) => {
            const won = (s: string) => funil.find(r => r.agent_slug === s && r.bucket === 'won')?.total ?? 0
            return won(b) - won(a)
          })
        if (!slugs.length) return null
        const cel = (s: string, b: string) => funil.find(r => r.agent_slug === s && r.bucket === b) ?? { total: 0, parados: 0 }
        const soma = (b: string, campo: 'total' | 'parados' = 'total') =>
          funil.filter(r => r.bucket === b && r.agent_slug !== 'roteador').reduce((acc, r) => acc + Number(r[campo]), 0)
        const engajados = (s: string) => FUNIL_COLS.filter(c => c.k !== 'novo')
          .reduce((acc, c) => acc + Number(cel(s, c.k).total), 0)
        const convPct = (s: string) => {
          const e = engajados(s)
          return e ? Math.round((Number(cel(s, 'won').total) / e) * 100) : null
        }
        // Avisos automáticos: gargalos (🔴) e destaques (🟢)
        const vazadas = ['fase1', 'fase2', 'fase3', 'fase4'].map(f => ({ f, n: soma(f, 'parados') }))
        const gargalo = vazadas.sort((a, b) => b.n - a.n)[0]
        const totVazadas = vazadas.reduce((a, v) => a + v.n, 0)
        const ckPend = soma('checkout_pendente'); const ckPend48 = soma('checkout_pendente', 'parados')
        const f4 = soma('fase4') + soma('checkout_pendente', 'parados') * 0 // fase4 ativos
        const wonTot = soma('won')
        const convF4 = (f4 + wonTot) ? Math.round((wonTot / (f4 + wonTot)) * 100) : null
        const melhor = slugs.filter(s => engajados(s) >= 10)
          .map(s => ({ s, p: convPct(s) ?? 0 })).sort((a, b) => b.p - a.p)[0]
        const dormentes = soma('resgate')
        return (
          <div className="max-w-5xl mt-8">
            <h2 className="font-display font-semibold text-lg mb-3">🎯 Controle do funil por agente <span className="text-dim text-xs font-normal">· etapas = leads que CHEGARAM no período · 🛒 links = ENVIADOS no período · {labelPeriodo(periodo)}</span></h2>
            <div className="border border-line rounded-xl overflow-x-auto bg-panel/50">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="text-[10px] font-mono text-dim uppercase tracking-widest border-b border-line">
                    <th className="text-left px-4 py-2.5">Agente</th>
                    {FUNIL_COLS.map(c => <th key={c.k} className="text-right px-3 py-2.5">{c.label}</th>)}
                    <th className="text-right px-3 py-2.5">🛒 Links env.</th>
                    <th className="text-right px-3 py-2.5">🔗 Link pend.</th>
                    <th className="text-right px-4 py-2.5">Conv.</th>
                  </tr>
                </thead>
                <tbody>
                  {slugs.map(s => (
                    <tr key={s} className="border-b border-line/50 last:border-0">
                      <td className="px-4 py-2.5 font-medium">{AGENT_LABEL[s] ?? s}</td>
                      {FUNIL_COLS.map(c => {
                        const { total, parados } = cel(s, c.k)
                        return (
                          <td key={c.k} className={`px-3 py-2.5 text-right ${c.k === 'won' ? 'text-win font-bold' : ''}`}>
                            {Number(total) || <span className="text-dim/40">·</span>}
                            {Number(parados) > 0 && <span className="text-danger text-[10px] font-mono ml-1" title="parados +24h sem follow-up">⚠{parados}</span>}
                          </td>
                        )
                      })}
                      {(() => { const ce = cel(s, 'checkout_enviado'); return (
                        <td className="px-3 py-2.5 text-right">
                          {Number(ce.total) || <span className="text-dim/40">·</span>}
                          {Number(ce.parados) > 0 && <span className="text-win text-[10px] font-mono ml-1" title="desses, quantos já matricularam">🏆{ce.parados}</span>}
                        </td>
                      )})()}
                      {(() => { const ck = cel(s, 'checkout_pendente'); return (
                        <td className="px-3 py-2.5 text-right text-gold">
                          {Number(ck.total) || <span className="text-dim/40">·</span>}
                          {Number(ck.parados) > 0 && <span className="text-danger text-[10px] font-mono ml-1" title="+48h sem pagar">⚠{ck.parados}</span>}
                        </td>
                      )})()}
                      <td className="px-4 py-2.5 text-right font-semibold">{convPct(s) != null ? `${convPct(s)}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 space-y-1.5">
              {totVazadas > 0 && (
                <div className="text-[12px] text-danger">🔴 <b>{totVazadas} conversas ativas paradas há +24h SEM follow-up agendado</b> — vazaram da régua{gargalo.n > 0 && <> · maior concentração: <b>{gargalo.f.replace('fase', 'Fase ')}</b> ({gargalo.n})</>}. São leads quentes esperando alguém puxar.</div>
              )}
              {ckPend > 0 && (
                <div className="text-[12px] text-gold">🟠 <b>{ckPend} leads receberam o link e ainda não pagaram</b>{ckPend48 > 0 && <> ({ckPend48} há +48h — repasse pro Comercial Humano)</>}.</div>
              )}
              {convF4 != null && (
                <div className="text-[12px] text-teal">{convF4 >= 30 ? '🟢' : '🟡'} Dos leads que chegam à <b>Fase 4 (oferta)</b>, <b>{convF4}%</b> viram matrícula.</div>
              )}
              {melhor && melhor.p > 0 && (
                <div className="text-[12px] text-win">🟢 Melhor conversão: <b>{AGENT_LABEL[melhor.s] ?? melhor.s}</b> ({melhor.p}% dos engajados matriculam).</div>
              )}
              {dormentes > 50 && (
                <div className="text-[12px] text-dim">😴 <b>{dormentes} conversas dormentes</b> (cadência esgotada, lead já respondeu antes) — matéria-prima para campanha de reativação.</div>
              )}
              <div className="text-[11px] text-dim/60 leading-relaxed mt-1">
                <b className="text-dim">Novo</b> = nunca respondeu · <b className="text-dim">Fases 1-4</b> = conversando com a IA (⚠ = parado +24h sem régua) ·
                <b className="text-dim"> Régua</b> = follow-up agendado · <b className="text-dim">Dormant</b> = cadência esgotada ·
                <b className="text-dim"> Link pend.</b> = recebeu checkout e não pagou (sobrepõe as outras colunas) ·
                <b className="text-dim"> 🛒 Links env.</b> = links de checkout ENVIADOS no período — mesma conta do card acima, por agente (🏆 = quantos desses leads já matricularam).
                <b className="text-dim"> Conv.</b> = matriculados ÷ engajados (exclui quem nunca respondeu).
              </div>
            </div>
          </div>
        )
      })()}

      {/* 🛡 Checkout Blindado — funil da régua */}
      {blin && (() => {
        const { de, ate } = rangePeriodo(periodo)
        const dentro = (ts: string) => (!de || ts >= de) && (!ate || ts < ate)
        const cap = blin.capturados.filter(c => dentro(c.created_at))
        const disp = blin.disparos.filter(d => dentro(d.sent_at))
        // convertidos por LEAD ÚNICO: o 2º toque da régua gera 2ª linha convertida
        // do mesmo lead/fatura — contar linhas dobraria conversões e valor (10/08)
        const porLead = new Map<string, (typeof disp)[number]>()
        for (const d of disp.filter(x => x.status === 'convertido')) {
          const k = d.phone_norm || d.sent_at
          const atual = porLead.get(k)
          if (!atual || (Number(d.valor) || 0) > (Number(atual.valor) || 0)) porLead.set(k, d)
        }
        const conv = [...porLead.values()]
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
          if (row) row.atk++
        }
        for (const d of conv) {
          const k = d.product_code || '(sem produto)'
          const row: any = (porProduto as any[]).find(p => p.code === k)
          if (row) { row.conv++; row.valor += Number(d.valor) || 0 }
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

      {/* 💸 Custos de disparo (templates Meta) — segue o filtro de período */}
      {custos && (() => {
        const ags = custos.agentes ?? []
        const custoTotal = ags.reduce((s, a) => s + Number(a.custo), 0)
        const tplTotal = ags.reduce((s, a) => s + Number(a.templates), 0)
        const vendasTotal = ags.reduce((s, a) => s + a.vendas_anne + a.influenciadas, 0)
        const receitaTotal = ags.reduce((s, a) => s + Number(a.receita_anne) + Number(a.receita_influencia), 0)
        const cpa = (a: CustoAgente) => {
          const v = a.vendas_anne + a.influenciadas
          return v && Number(a.custo) ? brl(Number(a.custo) / v) : '—'
        }
        const roi = (a: CustoAgente) => {
          const rec = Number(a.receita_anne) + Number(a.receita_influencia)
          return Number(a.custo) && rec ? `${Math.round(rec / Number(a.custo))}x` : '—'
        }
        const camps = custos.campanhas ?? []
        return (
          <div className="max-w-5xl mt-8">
            <h2 className="font-display font-semibold text-lg mb-3">💸 Custo de disparos <span className="text-dim text-xs font-normal">· templates Meta a {brl(Number(custos.tarifa))}/msg · {labelPeriodo(periodo)}</span></h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-4xl">
              <Card titulo="Custo total" valor={brl(custoTotal)} destaque sub={`${tplTotal.toLocaleString('pt-BR')} templates enviados`} />
              <Card titulo="Vendas (Anne + influência)" valor={String(vendasTotal)} sub={`receita ${brl(receitaTotal)}`} />
              <Card titulo="CPA por disparo" valor={vendasTotal && custoTotal ? brl(custoTotal / vendasTotal) : '—'} sub="custo ÷ vendas Anne + influenciadas" />
              <Card titulo="ROI" valor={custoTotal && receitaTotal ? `${Math.round(receitaTotal / custoTotal)}x` : '—'} sub="receita ÷ custo de disparo" />
            </div>

            {/* Por agente */}
            {ags.length > 0 && (
              <div className="border border-line rounded-xl overflow-x-auto bg-panel/50 mt-4">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead>
                    <tr className="text-[10px] font-mono text-dim uppercase tracking-widest border-b border-line">
                      <th className="text-left px-4 py-2.5">Agente</th>
                      <th className="text-right px-3 py-2.5">Templates</th>
                      <th className="text-right px-3 py-2.5">Custo</th>
                      <th className="text-right px-3 py-2.5">Vendas Anne</th>
                      <th className="text-right px-3 py-2.5">📣 Influência</th>
                      <th className="text-right px-3 py-2.5">Receita</th>
                      <th className="text-right px-3 py-2.5">CPA</th>
                      <th className="text-right px-4 py-2.5">ROI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ags.map(a => (
                      <tr key={a.agent_slug} className="border-b border-line/50 last:border-0">
                        <td className="px-4 py-2.5 font-medium">{AGENT_LABEL[a.agent_slug] ?? a.agent_slug}</td>
                        <td className="px-3 py-2.5 text-right">{Number(a.templates).toLocaleString('pt-BR')}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-gold">{brl(Number(a.custo))}</td>
                        <td className="px-3 py-2.5 text-right text-win font-semibold">{a.vendas_anne || <span className="text-dim/40">·</span>}</td>
                        <td className="px-3 py-2.5 text-right text-dim">{a.influenciadas || <span className="text-dim/40">·</span>}</td>
                        <td className="px-3 py-2.5 text-right">{Number(a.receita_anne) + Number(a.receita_influencia) > 0 ? brl(Number(a.receita_anne) + Number(a.receita_influencia)) : '—'}</td>
                        <td className="px-3 py-2.5 text-right">{cpa(a)}</td>
                        <td className="px-4 py-2.5 text-right font-bold">{roi(a)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Por campanha */}
            {camps.length > 0 && (
              <div className="border border-line rounded-xl overflow-x-auto bg-panel/50 mt-3">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead>
                    <tr className="text-[10px] font-mono text-dim uppercase tracking-widest border-b border-line">
                      <th className="text-left px-4 py-2.5">Campanha</th>
                      <th className="text-left px-3 py-2.5">Agente</th>
                      <th className="text-right px-3 py-2.5">Enviados</th>
                      <th className="text-right px-3 py-2.5">Respostas</th>
                      <th className="text-right px-3 py-2.5">Taxa</th>
                      <th className="text-right px-3 py-2.5">Custo</th>
                      <th className="text-right px-4 py-2.5">R$/resposta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {camps.map(c => (
                      <tr key={c.name + c.inicio} className="border-b border-line/50 last:border-0">
                        <td className="px-4 py-2.5 font-medium max-w-[260px] truncate" title={c.name}>{c.name}</td>
                        <td className="px-3 py-2.5 text-dim">{AGENT_LABEL[c.agent_slug] ?? c.agent_slug ?? '—'}</td>
                        <td className="px-3 py-2.5 text-right">{Number(c.enviados).toLocaleString('pt-BR')}</td>
                        <td className="px-3 py-2.5 text-right text-teal font-semibold">{c.respostas}</td>
                        <td className="px-3 py-2.5 text-right">{pct(c.respostas, c.enviados)}</td>
                        <td className="px-3 py-2.5 text-right text-gold">{brl(Number(c.custo))}</td>
                        <td className="px-4 py-2.5 text-right font-semibold">{c.respostas ? brl(Number(c.custo) / c.respostas) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Por ação */}
            {(custos.acoes ?? []).length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {(custos.acoes ?? []).map(ac => (
                  <div key={ac.acao} className="border border-line rounded-lg px-3 py-1.5 bg-panel/50 text-[12px]">
                    <span className="font-medium">{ACAO_LABEL[ac.acao] ?? ac.acao}</span>
                    <span className="text-dim ml-2">{Number(ac.templates).toLocaleString('pt-BR')} msgs</span>
                    <span className="text-gold ml-2 font-semibold">{brl(Number(ac.custo))}</span>
                  </div>
                ))}
              </div>
            )}

            <p className="text-[11px] text-dim/60 mt-2 leading-relaxed">
              <b className="text-dim">Custo</b> = templates Meta enviados × tarifa ({brl(Number(custos.tarifa))}/msg — ajustável em
              <span className="font-mono"> global_settings.tarifa_template</span>). Inclui disparos em massa, blindado, carrinho
              e follow-ups fora da janela de 24h. Conversas dentro da janela são grátis.
              <b className="text-dim"> CPA</b> = custo ÷ (vendas Anne + influenciadas no período).
              <b className="text-dim"> ROI</b> = receita dessas vendas ÷ custo. Nutrição não vende por design — o retorno dela aparece no funil TJ-AM.
            </p>
          </div>
        )
      })()}

      <p className="text-[11px] text-dim/60 mt-6 max-w-2xl leading-relaxed">
        <b className="text-dim">Vendas da Anne</b> = o comprador recebeu o link de pagamento pela plataforma
        (🤖 IA ou 👤 humano que assumiu) na conversa, antes de pagar. <b className="text-dim">Influência disparo</b> =
        recebeu campanha até 7 dias antes mas comprou sem link da conversa — influência, não conversão.
        <b className="text-dim"> Outro produto</b> = lead em conversa com um agente comprou produto
        de OUTRO agente (cross-sell) — soma no destaque do card.
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
                {lista === 'vendas' ? `Vendas no período (${labelPeriodo(periodo)})`
                  : lista === 'checkouts' ? `Checkouts enviados (${labelPeriodo(periodo)})`
                  : 'Matriculados'}
              </h2>
              <button onClick={() => setLista(null)} className="ml-auto text-dim hover:text-cream text-xl leading-none">✕</button>
            </div>

            {lista === 'vendas' && (
              <div className="space-y-2">
                {vendas.map(v => (
                  <div key={v.id} className={`border rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap
                    ${ANNE_ATTRS.includes(v.attribution) || v.matched_by === 'phone_outro_agente'
                      ? 'border-line bg-panel2' : 'border-line/50 bg-panel/40 opacity-70'}`}>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{v.lead_name || fmtFone(v.lead_phone) || '(sem contato)'}</div>
                      <div className="text-[11px] text-dim truncate">{v.product_name}</div>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${
                      v.matched_by === 'phone_outro_agente' ? 'text-teal border-teal/40 bg-teal/10' : ATTR[v.attribution]?.cls ?? ''}`}>
                      {v.matched_by === 'phone_outro_agente' ? '🔀 Outro produto' : ATTR[v.attribution]?.label ?? v.attribution}
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

            {lista === 'checkouts' && (
              <div className="space-y-4">
                {Object.entries(checkouts.reduce((m: Record<string, typeof checkouts>, c) => {
                  (m[c.agent_slug] ??= [] as any).push(c); return m
                }, {})).sort((a, b) => b[1].length - a[1].length).map(([slug, rows]) => (
                  <div key={slug}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[11px] font-mono uppercase tracking-widest text-gold">
                        {AGENT_LABEL[slug] ?? slug}
                      </span>
                      <span className="text-[10px] font-mono text-dim">{rows.length} link(s)</span>
                      <span className="text-[10px] font-mono text-win ml-auto">
                        🏆 {rows.filter(r => r.matriculado).length} matriculado(s)
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {rows.map(c => (
                        <div key={c.id} className="border border-line bg-panel2 rounded-xl px-4 py-2.5 flex items-center gap-3 flex-wrap">
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{c.name || fmtFone(c.phone) || '(sem contato)'}</div>
                            <div className="font-mono text-[10px] text-dim">{fmtFone(c.phone)}</div>
                          </div>
                          {c.via === 'followup' && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full border border-gold/40 text-gold bg-gold/5 shrink-0">⏰ via follow-up</span>
                          )}
                          {c.matriculado ? (
                            <span className="text-[10px] px-2 py-0.5 rounded-full border border-win/40 text-win bg-win/10 shrink-0">🏆 Matriculado</span>
                          ) : c.conv_status && (
                            <span className={`text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${STATUS_META[c.conv_status]?.cls ?? 'border-line text-dim'}`}>
                              {STATUS_META[c.conv_status]?.label ?? c.conv_status}
                            </span>
                          )}
                          <div className="ml-auto font-mono text-[10px] text-dim shrink-0">{fmtHora(c.created_at)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {checkouts.length === 0 && <div className="text-center py-8 text-dim text-sm">Nenhum checkout enviado no período.</div>}
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
