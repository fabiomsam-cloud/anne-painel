import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, AGENT_LABEL } from '../lib/supabase'

// ============================================================
// 📈 Métricas do Comercial Humano (admin) — layout definido pela
// coordenação da missão: KPIs com comparativo, funil por etapa,
// tabela por vendedor, ranking de conversão, tempo médio por
// etapa e motivos de devolução.
// Coorte = leads DISTRIBUÍDOS no período (assigned_at); as etapas
// derivam das atividades registradas pelos vendedores no pipeline.
// ============================================================

type Vendedor = { id: string; nome: string; email: string; tipo: string; ativo: boolean }
type Ass = {
  id: string; vendedor_id: string; conversation_id: string | null
  estrato: string; status: string; motivo_perda: string | null; venda_valor: number | null
  assigned_at: string; closed_at: string | null
  conversations: { current_agent_slug: string } | null
}
type Atv = { id: string; assignment_id: string; tipo: string; agendada_para: string | null; created_at: string }
type Janela = { cards: Ass[]; ativs: Record<string, Atv[]> }

// contato real com o lead; agendamento e nota não contam como tentativa
const TENTATIVAS = ['ligacao_atendida', 'ligacao_nao_atendida', 'whatsapp']

const MOTIVO_LABEL: Record<string, string> = {
  sem_interesse: 'Sem interesse', sem_dinheiro_agora: 'Sem dinheiro agora', preco: 'Preço',
  vai_pensar: 'Vai pensar', concorrente: 'Comprou concorrente', sem_contato: 'Não atende mais / sumiu',
  telefone_invalido: 'Telefone inválido', outro: 'Outro',
  expirado_sem_trabalho: 'Expirado sem trabalho', expirado: 'Expirado (posse venceu)',
}
const MOTIVO_CORES = ['#e06f6f', '#f5a623', '#4da3ff', '#b18cff', '#8aa396', '#35d0ba', '#6fe08c', '#3a4150']

// Período em DIA CALENDÁRIO de Manaus (UTC-4) — mesmo padrão da aba 📈 Métricas
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

// pega TODAS as linhas paginando (max-rows do PostgREST é 1000 por requisição)
async function fetchAll<T>(monta: (de: number, ate: number) => any): Promise<T[]> {
  const out: T[] = []
  for (let de = 0; ; de += 1000) {
    const { data } = await monta(de, de + 999)
    const page = (data as T[]) ?? []
    out.push(...page)
    if (page.length < 1000) break
  }
  return out
}

async function carregarJanela(de: string | null, ate: string | null): Promise<Janela> {
  const cards = await fetchAll<Ass>((a, b) => {
    let q = supabase.from('lead_assignments')
      .select('id,vendedor_id,conversation_id,estrato,status,motivo_perda,venda_valor,assigned_at,closed_at,conversations(current_agent_slug)')
      .order('assigned_at').order('id').range(a, b)
    if (de) q = q.gte('assigned_at', de)
    if (ate) q = q.lt('assigned_at', ate)
    return q
  })
  const ativs: Record<string, Atv[]> = {}
  const ids = cards.map(c => c.id)
  for (let i = 0; i < ids.length; i += 100) {
    const lote = ids.slice(i, i + 100)
    const rows = await fetchAll<Atv>((a, b) => supabase.from('atividades_comercial')
      .select('id,assignment_id,tipo,agendada_para,created_at')
      .in('assignment_id', lote).order('created_at').order('id').range(a, b))
    for (const r of rows) (ativs[r.assignment_id] ??= []).push(r)
  }
  return { cards, ativs }
}

// ---- agregação: uma passada pelos cards produz tudo que a tela mostra ----
type Linha = {
  recebidos: number; semTentativa: number; emCadencia: number; comAgenda: number
  matriculados: number; devolvidos: number; expirados: number
  tentativas: number; trabalhados: number; ciclosMs: number[]; receita: number
}
const novaLinha = (): Linha => ({
  recebidos: 0, semTentativa: 0, emCadencia: 0, comAgenda: 0,
  matriculados: 0, devolvidos: 0, expirados: 0,
  tentativas: 0, trabalhados: 0, ciclosMs: [], receita: 0,
})

type Resumo = {
  porV: Record<string, Linha>; total: Linha
  motivos: [string, number][]; agendaram: number
  tPrimeira: number[]; tAgendou: number[]; tFechou: number[]
}
function resumir(cards: Ass[], ativs: Record<string, Atv[]>): Resumo {
  const porV: Record<string, Linha> = {}
  const total = novaLinha()
  const motivos: Record<string, number> = {}
  let agendaram = 0
  const tPrimeira: number[] = [], tAgendou: number[] = [], tFechou: number[] = []
  const agora = Date.now()
  for (const a of cards) {
    const lista = ativs[a.id] ?? []
    const tents = lista.filter(x => TENTATIVAS.includes(x.tipo))
    const agds = lista.filter(x => x.tipo === 'ligacao_agendada')
    const trabalhado = tents.length > 0 || agds.length > 0 || a.status === 'matriculado'
    const agendaFutura = a.status === 'ativo' &&
      agds.some(x => x.agendada_para && new Date(x.agendada_para).getTime() > agora - 3600000)
    for (const l of [(porV[a.vendedor_id] ??= novaLinha()), total]) {
      l.recebidos++
      l.tentativas += tents.length
      if (trabalhado) l.trabalhados++
      if (a.status === 'matriculado') {
        l.matriculados++; l.receita += Number(a.venda_valor) || 0
        if (a.closed_at) l.ciclosMs.push(new Date(a.closed_at).getTime() - new Date(a.assigned_at).getTime())
      }
      else if (a.status === 'devolvido') l.devolvidos++
      else if (a.status === 'expirado') l.expirados++
      else if (agendaFutura) l.comAgenda++
      else if (trabalhado) l.emCadencia++
      else l.semTentativa++
    }
    if (agds.length) agendaram++
    if (a.status === 'devolvido' || a.status === 'expirado') {
      const m = (a.motivo_perda ?? (a.status === 'expirado' ? 'expirado_sem_trabalho' : 'outro')).split(' — ')[0]
      motivos[m] = (motivos[m] ?? 0) + 1
    }
    // tempos entre etapas (só transições concluídas — card ativo não puxa a média)
    const prim = lista.find(x => x.tipo !== 'nota')
    if (prim) tPrimeira.push(new Date(prim.created_at).getTime() - new Date(a.assigned_at).getTime())
    if (prim && agds[0] && agds[0].id !== prim.id)
      tAgendou.push(Math.max(0, new Date(agds[0].created_at).getTime() - new Date(prim.created_at).getTime()))
    if (a.status === 'matriculado' && a.closed_at && agds[0])
      tFechou.push(Math.max(0, new Date(a.closed_at).getTime() - new Date(agds[0].created_at).getTime()))
  }
  return {
    porV, total, agendaram, tPrimeira, tAgendou, tFechou,
    motivos: Object.entries(motivos).sort((a, b) => b[1] - a[1]),
  }
}

const media = (arr: number[]) => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null
const fmtDias = (ms: number | null) => ms == null ? '—' : (ms / 86400000).toFixed(1).replace('.', ',') + 'd'
const pct = (n: number, d: number) => d ? (100 * n / d).toFixed(1).replace('.', ',') + '%' : '—'
const fmtBRL = (v: number) => 'R$ ' + v.toLocaleString('pt-BR')

// delta do KPI vs período anterior — inverso=true quando subir é ruim
function Delta({ atual, prev, fmt, inverso = false }:
  { atual: number; prev: number | null; fmt?: (d: number) => string; inverso?: boolean }) {
  if (prev == null) return <div className="text-[11px] text-dim/60 mt-1.5">sem comparativo</div>
  const d = atual - prev
  if (Math.abs(d) < 0.05) return <div className="text-[11px] text-dim mt-1.5">≈ estável vs. período anterior</div>
  const bom = inverso ? d < 0 : d > 0
  return (
    <div className={`text-[11px] mt-1.5 ${bom ? 'text-win' : 'text-danger'}`}>
      {d > 0 ? '↑' : '↓'} {fmt ? fmt(Math.abs(d)) : Math.abs(Math.round(d))} vs. período anterior
    </div>
  )
}

function Kpi({ label, valor, children }: { label: string; valor: string; children?: any }) {
  return (
    <div className="rise border border-line bg-panel/50 rounded-xl p-4">
      <div className="text-[10px] font-mono text-dim uppercase tracking-widest">{label}</div>
      <div className="font-display font-bold text-2xl mt-1.5">{valor}</div>
      {children}
    </div>
  )
}

export default function ComercialMetricas({ vendedores }: { vendedores: Vendedor[] }) {
  const [periodo, setPeriodo] = useState<Periodo>({ tipo: 'd30', de: '', ate: '' })
  const [janela, setJanela] = useState<Janela>({ cards: [], ativs: {} })
  const [janelaPrev, setJanelaPrev] = useState<Janela | null>(null)
  const [vendSel, setVendSel] = useState<Set<string>>(new Set())   // vazio = todos
  const [prodSel, setProdSel] = useState('')                        // '' = todos
  const [dropVend, setDropVend] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const seq = useRef(0)

  const carregar = async () => {
    const meu = ++seq.current
    setCarregando(true)
    const { de, ate } = rangePeriodo(periodo)
    const atual = await carregarJanela(de, ate)
    if (seq.current !== meu) return
    setJanela(atual)
    setCarregando(false)
    // comparativo: janela anterior de MESMA duração, terminando onde a atual começa
    if (de && periodo.tipo !== 'tudo') {
      const fimMs = ate ? new Date(ate).getTime() : Date.now()
      const iniMs = new Date(de).getTime()
      const prev = await carregarJanela(new Date(iniMs - (fimMs - iniMs)).toISOString(), de)
      if (seq.current === meu) setJanelaPrev(prev)
    } else setJanelaPrev(null)
  }
  useEffect(() => { carregar() }, [periodo])
  useEffect(() => {
    const ch = supabase.channel('comercial-metricas')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lead_assignments' }, carregar)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [periodo])

  const closers = vendedores.filter(v => v.tipo === 'closer')
  const filtra = (cards: Ass[]) => cards.filter(a =>
    (!vendSel.size || vendSel.has(a.vendedor_id)) &&
    (!prodSel || a.conversations?.current_agent_slug === prodSel))

  const r = useMemo(() => resumir(filtra(janela.cards), janela.ativs), [janela, vendSel, prodSel])
  const rPrev = useMemo(() => janelaPrev ? resumir(filtra(janelaPrev.cards), janelaPrev.ativs) : null,
    [janelaPrev, vendSel, prodSel])

  const produtos = useMemo(() => {
    const s = new Set<string>()
    for (const a of janela.cards) if (a.conversations?.current_agent_slug) s.add(a.conversations.current_agent_slug)
    return [...s].sort()
  }, [janela])

  const t = r.total
  const emPosse = t.semTentativa + t.emCadencia + t.comAgenda
  const perdidos = t.devolvidos + t.expirados
  const cicloMedio = media(t.ciclosMs)
  const tentMedia = t.trabalhados ? t.tentativas / t.trabalhados : null
  const pv = rPrev?.total
  const convPct = (l: Linha) => l.recebidos ? 100 * l.matriculados / l.recebidos : 0

  // tabela ordenada por conversão (base = coorte recebida), como no ranking
  const linhas = useMemo(() =>
    Object.entries(r.porV)
      .map(([vid, l]) => ({ vid, l, nome: vendedores.find(v => v.id === vid)?.nome ?? '?' }))
      .sort((a, b) => convPct(b.l) - convPct(a.l)),
    [r, vendedores])

  // ranking pela taxa sobre TRABALHADOS (mérito do vendedor sobre o que ele tocou)
  const ranking = useMemo(() =>
    linhas.map(x => ({ ...x, taxa: x.l.trabalhados ? 100 * x.l.matriculados / x.l.trabalhados : 0 }))
      .sort((a, b) => b.taxa - a.taxa),
    [linhas])
  const topTaxa = ranking[0]?.taxa || 0

  const tempos = [
    { label: 'Recebido → 1ª tentativa', ms: media(r.tPrimeira), cor: '#e06f6f' },
    { label: '1ª tentativa → agendamento', ms: media(r.tAgendou), cor: '#4da3ff' },
    { label: 'Agendamento → matrícula', ms: media(r.tFechou), cor: '#f5a623' },
    { label: 'Entrada → matrícula (ciclo)', ms: cicloMedio, cor: '#6fe08c' },
  ]
  const maxTempo = Math.max(...tempos.map(x => x.ms ?? 0), 1)

  // donut de motivos (conic-gradient) — mesmas fatias da lista ao lado
  const donut = useMemo(() => {
    const tot = r.motivos.reduce((s, [, n]) => s + n, 0)
    if (!tot) return null
    let acc = 0
    const stops = r.motivos.map(([, n], i) => {
      const de = acc / tot * 100; acc += n
      return `${MOTIVO_CORES[i % MOTIVO_CORES.length]} ${de}% ${acc / tot * 100}%`
    })
    return { tot, css: `conic-gradient(${stops.join(', ')})` }
  }, [r.motivos])

  const inp = 'bg-panel border border-line rounded-lg px-3 py-2 text-sm text-cream focus:outline-none focus:border-gold/60'
  const funil = [
    { label: 'Recebidos', n: t.recebidos, cor: '#e06f6f', hint: 'distribuídos no período' },
    { label: 'Em cadência', n: t.trabalhados, cor: '#4da3ff', hint: 'com ao menos 1 atividade' },
    { label: 'Ligação agendada', n: r.agendaram, cor: '#f5a623', hint: 'marcaram compromisso' },
    { label: 'Matriculados', n: t.matriculados, cor: '#6fe08c', hint: 'venda confirmada' },
  ]

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 max-w-6xl">
      {/* ---- filtros ---- */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          {([['hoje', 'Hoje'], ['ontem', 'Ontem'], ['d7', '7 dias'], ['d30', '30 dias'], ['mes', 'Este mês'], ['tudo', 'Tudo']] as const).map(([id, lbl]) => (
            <button key={id} onClick={() => setPeriodo({ tipo: id, de: '', ate: '' })}
              className={`text-xs px-3 py-1.5 rounded-lg border transition
                ${periodo.tipo === id ? 'border-gold/60 bg-gold/10 text-cream' : 'border-line text-dim hover:text-cream'}`}>
              {lbl}
            </button>
          ))}
          <div className="flex items-center gap-1 text-xs text-dim">
            <input type="date" className={inp + ' py-1'} value={periodo.de}
              onChange={e => setPeriodo({ tipo: 'custom', de: e.target.value, ate: periodo.ate })} />
            →
            <input type="date" className={inp + ' py-1'} value={periodo.ate}
              onChange={e => setPeriodo({ tipo: 'custom', de: periodo.de, ate: e.target.value })} />
          </div>
        </div>
        <div className="relative ml-auto">
          <button onClick={() => setDropVend(!dropVend)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition ${vendSel.size ? 'border-gold/60 bg-gold/10 text-cream' : 'border-line text-dim hover:text-cream'}`}>
            👤 {vendSel.size ? `${vendSel.size} vendedor${vendSel.size > 1 ? 'es' : ''}` : `Todos os vendedores (${closers.length})`} ▾
          </button>
          {dropVend && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setDropVend(false)} />
              <div className="absolute right-0 top-full mt-1 z-40 w-56 bg-panel border border-line rounded-xl shadow-2xl p-2 space-y-0.5">
                <button onClick={() => setVendSel(new Set())}
                  className="w-full text-left text-xs px-2 py-1.5 rounded-lg text-dim hover:text-cream hover:bg-panel2 transition">
                  Todos os vendedores
                </button>
                {closers.map(v => (
                  <label key={v.id} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg hover:bg-panel2 cursor-pointer transition">
                    <input type="checkbox" checked={vendSel.has(v.id)}
                      onChange={() => {
                        const s = new Set(vendSel)
                        s.has(v.id) ? s.delete(v.id) : s.add(v.id)
                        setVendSel(s)
                      }} />
                    <span className={v.ativo ? '' : 'line-through text-dim'}>{v.nome}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
        <select value={prodSel} onChange={e => setProdSel(e.target.value)} className={inp + ' text-xs py-1.5'}>
          <option value="">🎯 Todos os produtos</option>
          {produtos.map(p => <option key={p} value={p}>{AGENT_LABEL[p] ?? p}</option>)}
        </select>
      </div>

      {carregando ? (
        <div className="py-16 text-center text-dim font-mono text-sm">carregando métricas…</div>
      ) : !t.recebidos ? (
        <div className="py-16 text-center text-dim text-sm">
          Nenhum lead distribuído no período/filtro selecionado.<br />
          A roleta distribui quando há corte ativo (aba 📊 Gestão).
        </div>
      ) : (
        <>
          {/* ---- KPIs ---- */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label="Ativos no funil" valor={String(emPosse)}>
              <div className="text-[11px] text-dim mt-1.5">{t.recebidos} recebidos no período</div>
            </Kpi>
            <Kpi label="Conversão geral" valor={pct(t.matriculados, t.recebidos)}>
              <Delta atual={convPct(t)} prev={pv ? convPct(pv) : null}
                fmt={d => d.toFixed(1).replace('.', ',') + ' p.p.'} />
            </Kpi>
            <Kpi label="Matriculados" valor={String(t.matriculados)}>
              <Delta atual={t.matriculados} prev={pv?.matriculados ?? null} />
            </Kpi>
            <Kpi label="Devolvidos" valor={String(perdidos)}>
              <Delta atual={perdidos} prev={pv ? pv.devolvidos + pv.expirados : null} inverso />
            </Kpi>
            <Kpi label="Ciclo médio" valor={fmtDias(cicloMedio)}>
              <Delta atual={(cicloMedio ?? 0) / 86400000} prev={pv && media(pv.ciclosMs) != null ? media(pv.ciclosMs)! / 86400000 : null}
                fmt={d => d.toFixed(1).replace('.', ',') + 'd'} inverso />
            </Kpi>
            <Kpi label="Tentativas / lead" valor={tentMedia == null ? '—' : tentMedia.toFixed(1).replace('.', ',')}>
              <Delta atual={tentMedia ?? 0}
                prev={pv?.trabalhados ? pv.tentativas / pv.trabalhados : null}
                fmt={d => d.toFixed(1).replace('.', ',')} />
            </Kpi>
          </div>

          {/* ---- funil geral ---- */}
          <section className="border border-line bg-panel/50 rounded-xl p-4 space-y-3">
            <div className="flex items-baseline gap-3 flex-wrap">
              <h2 className="font-display font-semibold">Funil geral — leads por etapa</h2>
              <span className="text-[11px] text-dim">coorte de entrada no período · {t.recebidos} leads · etapa = já passou por ela</span>
            </div>
            <div className="flex items-stretch overflow-x-auto">
              {funil.map((f, i) => (
                <div key={f.label} className="flex items-stretch flex-1 min-w-32">
                  {i > 0 && (
                    <div className="self-center text-center text-dim px-1.5 shrink-0">
                      →<br /><span className="font-mono text-[10px]">{pct(f.n, funil[i - 1].n)}</span>
                    </div>
                  )}
                  <div className={`flex-1 text-center py-3 px-2 ${i > 0 ? 'border-l border-line/40' : ''}`}>
                    <div className="w-2 h-2 rounded-full mx-auto mb-2" style={{ background: f.cor }} />
                    <div className="font-mono text-2xl font-bold">{f.n}</div>
                    <div className="text-[11px] text-dim uppercase tracking-wide mt-0.5">{f.label}</div>
                    <div className="text-[10px] text-dim/60 mt-0.5">{f.hint}</div>
                    <div className="h-1.5 bg-panel2 rounded mt-2 overflow-hidden">
                      <div className="h-full rounded" style={{ width: pct(f.n, t.recebidos), background: f.cor }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="pt-3 border-t border-dashed border-line flex items-center gap-3 text-xs text-dim flex-wrap">
              <span className="font-mono text-[11px] px-2 py-0.5 rounded border border-danger/30 bg-danger/10 text-danger">↩ Devolvidos</span>
              <span>
                <b className="text-cream">{t.devolvidos}</b> devolvidos
                {t.expirados > 0 && <> + <b className="text-cream">{t.expirados}</b> expirados</>}
                {' '}no período — <b className="text-cream">{pct(perdidos, t.trabalhados || t.recebidos)}</b> dos
                leads trabalhados. Motivos detalhados abaixo.
              </span>
            </div>
          </section>

          {/* ---- tabela por vendedor ---- */}
          <section className="border border-line bg-panel/50 rounded-xl p-4 space-y-3">
            <div className="flex items-baseline gap-3 flex-wrap">
              <h2 className="font-display font-semibold">Performance por vendedor</h2>
              <span className="text-[11px] text-dim">carteira atual + resultados da coorte do período</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] font-mono text-dim uppercase tracking-wider text-left border-b border-line">
                    <th className="py-2 pr-3">Vendedor</th>
                    <th className="py-2 px-2 text-right" title="Em posse, ainda sem tentativa">Recebidos</th>
                    <th className="py-2 px-2 text-right" title="Em posse, trabalhando o lead">Em cadência</th>
                    <th className="py-2 px-2 text-right" title="Em posse, com ligação marcada">Ligação</th>
                    <th className="py-2 px-2 text-right">Matriculados</th>
                    <th className="py-2 px-2 text-right" title="Devolvidos + expirados">Devolvidos</th>
                    <th className="py-2 px-2 text-right" title="Ligações + WhatsApp por lead trabalhado">Tentativas</th>
                    <th className="py-2 px-2 text-right" title="Entrada → matrícula">Ciclo</th>
                    <th className="py-2 px-2 text-right">Receita</th>
                    <th className="py-2 pl-2 text-right text-gold" title="Matriculados ÷ recebidos na coorte">Conversão</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map(({ vid, l, nome }) => (
                    <tr key={vid} className="border-b border-line/40">
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-2 font-medium">
                          <span className="w-6 h-6 rounded-md bg-panel2 text-dim grid place-items-center text-[10px] font-mono font-bold">
                            {nome.slice(0, 1).toUpperCase()}
                          </span>
                          {nome}
                        </div>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono">{l.semTentativa}</td>
                      <td className="py-2.5 px-2 text-right font-mono">{l.emCadencia}</td>
                      <td className="py-2.5 px-2 text-right font-mono">{l.comAgenda}</td>
                      <td className="py-2.5 px-2 text-right font-mono text-win">{l.matriculados}</td>
                      <td className="py-2.5 px-2 text-right font-mono">{l.devolvidos + l.expirados}</td>
                      <td className="py-2.5 px-2 text-right font-mono">
                        {l.trabalhados ? (l.tentativas / l.trabalhados).toFixed(1).replace('.', ',') : '—'}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono">{fmtDias(media(l.ciclosMs))}</td>
                      <td className="py-2.5 px-2 text-right font-mono">{l.receita ? fmtBRL(l.receita) : '—'}</td>
                      <td className="py-2.5 pl-2">
                        <div className="flex items-center gap-2 justify-end">
                          <span className="font-mono font-bold">{pct(l.matriculados, l.recebidos)}</span>
                          <div className="w-16 h-1.5 bg-panel2 rounded overflow-hidden shrink-0">
                            <div className="h-full bg-win rounded"
                              style={{ width: `${linhas[0] && convPct(linhas[0].l) ? 100 * convPct(l) / convPct(linhas[0].l) : 0}%` }} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                  <tr className="font-bold">
                    <td className="py-2.5 pr-3">Total geral</td>
                    <td className="py-2.5 px-2 text-right font-mono">{t.semTentativa}</td>
                    <td className="py-2.5 px-2 text-right font-mono">{t.emCadencia}</td>
                    <td className="py-2.5 px-2 text-right font-mono">{t.comAgenda}</td>
                    <td className="py-2.5 px-2 text-right font-mono text-win">{t.matriculados}</td>
                    <td className="py-2.5 px-2 text-right font-mono">{perdidos}</td>
                    <td className="py-2.5 px-2 text-right font-mono">{tentMedia == null ? '—' : tentMedia.toFixed(1).replace('.', ',')}</td>
                    <td className="py-2.5 px-2 text-right font-mono">{fmtDias(cicloMedio)}</td>
                    <td className="py-2.5 px-2 text-right font-mono">{t.receita ? fmtBRL(t.receita) : '—'}</td>
                    <td className="py-2.5 pl-2 text-right font-mono text-gold">{pct(t.matriculados, t.recebidos)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* ---- ranking + tempo por etapa ---- */}
          <div className="grid md:grid-cols-2 gap-4">
            <section className="border border-line bg-panel/50 rounded-xl p-4 space-y-3">
              <div className="flex items-baseline gap-3 flex-wrap">
                <h2 className="font-display font-semibold">Ranking · taxa de conversão</h2>
                <span className="text-[11px] text-dim">matriculados ÷ leads trabalhados</span>
              </div>
              <div className="space-y-2.5">
                {ranking.map((x, i) => (
                  <div key={x.vid} className="flex items-center gap-3">
                    <span className="w-6 font-mono text-xs text-dim">{i + 1}º</span>
                    <span className="w-24 text-sm font-medium truncate">{x.nome}</span>
                    <div className="flex-1 h-5 bg-panel2 rounded-md overflow-hidden">
                      <div className="h-full rounded-md"
                        style={{
                          width: `${topTaxa ? 100 * x.taxa / topTaxa : 0}%`,
                          background: x.taxa < topTaxa / 2 && ranking.length > 1
                            ? 'linear-gradient(90deg,#e06f6f,#f5a623)'
                            : 'linear-gradient(90deg,#6fe08c,#4da3ff)',
                        }} />
                    </div>
                    <span className="w-14 text-right font-mono text-sm font-bold">
                      {x.taxa.toFixed(0)}%
                    </span>
                  </div>
                ))}
                {!ranking.length && <div className="text-center text-[11px] text-dim/60 py-4">sem dados no período</div>}
              </div>
            </section>

            <section className="border border-line bg-panel/50 rounded-xl p-4 space-y-3">
              <div className="flex items-baseline gap-3 flex-wrap">
                <h2 className="font-display font-semibold">Tempo médio por etapa</h2>
                <span className="text-[11px] text-dim">só transições concluídas</span>
              </div>
              <div className="space-y-3">
                {tempos.map(x => (
                  <div key={x.label} className="flex items-center gap-3">
                    <span className="w-44 text-xs text-dim shrink-0">{x.label}</span>
                    <div className="flex-1 h-4 bg-panel2 rounded overflow-hidden">
                      <div className="h-full rounded"
                        style={{ width: `${x.ms == null ? 0 : Math.max(4, 100 * x.ms / maxTempo)}%`, background: x.cor }} />
                    </div>
                    <span className="w-12 text-right font-mono text-xs">{fmtDias(x.ms)}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* ---- devoluções: motivos ---- */}
          <section className="border border-line bg-panel/50 rounded-xl p-4 space-y-3">
            <div className="flex items-baseline gap-3 flex-wrap">
              <h2 className="font-display font-semibold">Análise de devoluções — motivos</h2>
              <span className="text-[11px] text-dim">
                {perdidos} lead{perdidos === 1 ? '' : 's'} devolvido{perdidos === 1 ? '' : 's'}/expirado{perdidos === 1 ? '' : 's'} no período —
                o motivo alimenta a evolução da Anne
              </span>
            </div>
            {donut ? (
              <div className="grid md:grid-cols-[200px_1fr] gap-6 items-center">
                <div>
                  <div className="relative w-44 h-44 rounded-full mx-auto" style={{ background: donut.css }}>
                    <div className="absolute inset-6 rounded-full bg-panel grid place-items-center font-mono text-2xl font-bold">
                      {donut.tot}
                    </div>
                  </div>
                  <div className="text-center text-[10px] font-mono text-dim uppercase tracking-widest mt-2">Total devolvido</div>
                </div>
                <div>
                  {r.motivos.map(([m, n], i) => (
                    <div key={m} className="flex items-center gap-3 py-2 border-b border-line/40 last:border-0 text-sm">
                      <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: MOTIVO_CORES[i % MOTIVO_CORES.length] }} />
                      <span className="flex-1">{MOTIVO_LABEL[m] ?? m.replace(/_/g, ' ')}</span>
                      <span className="font-mono font-bold w-14 text-right">{pct(n, donut.tot)}</span>
                      <span className="font-mono text-dim text-xs w-16 text-right">{n} lead{n > 1 ? 's' : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center text-[11px] text-dim/60 py-4">Nenhuma devolução no período. 🎉</div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
