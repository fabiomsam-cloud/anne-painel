import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase, AGENT_LABEL, fmtFone } from '../lib/supabase'
import { ESTRATO_CLS } from '../lib/comercial'

// ============================================================
// 📥 Leads por planilha (29/10/2026) — só administrador.
// O admin comercial (Lucas) sobe uma planilha, o banco cruza cada
// telefone com a Anne (fn_leads_cruzar), o admin escolhe a roleta,
// vê a prévia e confirma (fn_leads_distribuir → cards de 14 dias).
// Opt-out NUNCA vira card: além do cruzamento, há trava por trigger
// em lead_assignments (migration 55).
// ============================================================

type Vendedor = { id: string; nome: string; email: string; tipo: string; ativo: boolean }
type Situacao = 'elegivel' | 'optout' | 'comprou' | 'card' | 'humano' | 'cadencia' | 'sem_anne' | 'invalido'
type Lead = {
  fone: string; pk: string | null; contact_id: string | null; conversation_id: string | null
  nome: string | null; telefone: string | null; situacao: Situacao; estrato: 'A' | 'B' | 'C' | null
  aluno: boolean; agente: string | null; responsavel: string | null; ultima_msg_lead: string | null
  nome_planilha?: string; email_planilha?: string
}
type Importacao = {
  id: string; arquivo: string | null; modo: string | null; criado_por: string | null; criado_em: string
  total_planilha: number | null; resumo: Record<string, number> | null
  por_vendedor: { vendedor: string; cards: number }[] | null; cards_criados: number | null
  recusados: { fone: string | null; motivo: string }[] | null
}
type Modo = 'iguais' | 'equilibrar' | 'manual'

const SIT_LABEL: Record<Situacao, string> = {
  elegivel: '✅ Elegível',
  optout: '🚫 Pediu para não receber mensagens (opt-out)',
  comprou: '🎓 Já comprou / matriculado',
  card: '☎️ Já está com um vendedor (card ativo)',
  humano: '🧑‍💼 Em atendimento humano',
  cadencia: '⏳ Follow-up da Anne ainda agendado',
  sem_anne: '❔ Não existe na Anne (nunca conversou)',
  invalido: '⚠️ Telefone inválido',
}
const SIT_ORDEM: Situacao[] = ['elegivel', 'optout', 'comprou', 'card', 'humano', 'cadencia', 'sem_anne', 'invalido']
const MODO_LABEL: Record<Modo, string> = { iguais: 'Partes iguais', equilibrar: 'Equilibrar carteiras', manual: 'Quantidade por vendedor' }

// acha a coluna de telefone: pelo cabeçalho ou pela coluna com mais valores "com cara de telefone"
function detectarColunas(rows: any[][]): { fone: number; nome: number; email: number; temCabecalho: boolean } {
  const cab = (rows[0] ?? []).map(c => String(c ?? '').toLowerCase())
  const porCab = (re: RegExp) => cab.findIndex(c => re.test(c))
  let fone = porCab(/tel|fone|phone|whats|celular|contato/)
  const nome = porCab(/^nome|name|first/)
  const email = porCab(/mail/)
  const temCabecalho = fone >= 0 || nome >= 0 || email >= 0
  if (fone < 0) {
    const ncol = Math.max(0, ...rows.slice(0, 50).map(r => r.length))
    let melhor = -1, melhorN = 0
    for (let c = 0; c < ncol; c++) {
      const n = rows.slice(temCabecalho ? 1 : 0, 200).filter(r => /^\d{10,13}$/.test(String(r[c] ?? '').replace(/\D/g, ''))).length
      if (n > melhorN) { melhor = c; melhorN = n }
    }
    fone = melhor
  }
  return { fone, nome, email, temCabecalho }
}

function baixarCsv(nome: string, linhas: string[][]) {
  const esc = (s: any) => `"${String(s ?? '').replace(/"/g, '""')}"`
  const blob = new Blob(['﻿' + linhas.map(l => l.map(esc).join(';')).join('\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

export default function ComercialLeads({ vendedores, flash }: { vendedores: Vendedor[]; flash: (t: string) => void }) {
  const closers = useMemo(() => vendedores.filter(v => v.tipo === 'closer' && v.ativo), [vendedores])
  const [arquivo, setArquivo] = useState('')
  const [linhasPlanilha, setLinhasPlanilha] = useState(0)
  const [leads, setLeads] = useState<Lead[]>([])
  const [cruzando, setCruzando] = useState(false)
  const [carteira, setCarteira] = useState<Record<string, number>>({})
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [modo, setModo] = useState<Modo>('iguais')
  const [manual, setManual] = useState<Record<string, number>>({})
  const [distribuindo, setDistribuindo] = useState(false)
  const [resultado, setResultado] = useState<any>(null)
  const [historico, setHistorico] = useState<Importacao[]>([])
  const [verFora, setVerFora] = useState<Situacao | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const carregarCarteira = async () => {
    const cnt: Record<string, number> = {}
    const { data } = await supabase.from('lead_assignments').select('vendedor_id').eq('status', 'ativo').limit(5000)
    for (const a of ((data as any) ?? [])) cnt[a.vendedor_id] = (cnt[a.vendedor_id] ?? 0) + 1
    setCarteira(cnt)
  }
  const carregarHistorico = async () => {
    const { data } = await supabase.from('lead_importacoes').select('*').order('criado_em', { ascending: false }).limit(30)
    setHistorico((data as any) ?? [])
  }
  useEffect(() => { carregarCarteira(); carregarHistorico() }, [])
  useEffect(() => { setSel(new Set(closers.map(v => v.id))) }, [closers.length])

  // ---- 1. ler a planilha no navegador e cruzar no banco ----
  const lerArquivo = async (f: File) => {
    setResultado(null); setLeads([]); setVerFora(null)
    const buf = await f.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: false, defval: '' }) as any[][]
    const col = detectarColunas(rows)
    if (col.fone < 0) return flash('Não achei uma coluna de telefone na planilha.')
    const dados = rows.slice(col.temCabecalho ? 1 : 0).filter(r => String(r[col.fone] ?? '').replace(/\D/g, '').length >= 8)
    setArquivo(f.name); setLinhasPlanilha(dados.length)
    if (!dados.length) return flash('A planilha não tem telefones.')
    // extras da planilha (nome/e-mail) por telefone digitado — só para exibir e exportar
    const extras: Record<string, { nome: string; email: string }> = {}
    const fones: string[] = []
    for (const r of dados) {
      const fone = String(r[col.fone]).trim()
      if (!extras[fone]) { fones.push(fone); extras[fone] = { nome: col.nome >= 0 ? String(r[col.nome] ?? '').trim() : '', email: col.email >= 0 ? String(r[col.email] ?? '').trim() : '' } }
    }
    setCruzando(true)
    const out: Lead[] = []
    for (let i = 0; i < fones.length; i += 1500) {
      const { data, error } = await supabase.rpc('fn_leads_cruzar', { p_fones: fones.slice(i, i + 1500) })
      if (error) { setCruzando(false); return flash('Erro no cruzamento: ' + error.message) }
      for (const l of ((data as Lead[]) ?? [])) out.push({ ...l, nome_planilha: extras[l.fone]?.nome, email_planilha: extras[l.fone]?.email })
    }
    // mesmo contato repetido na planilha (dois formatos do mesmo número): fica um só
    const vistos = new Set<string>()
    const unicos = out.filter(l => { const k = l.contact_id ?? l.fone; if (vistos.has(k)) return false; vistos.add(k); return true })
    setLeads(unicos); setCruzando(false)
  }

  const porSituacao = useMemo(() => {
    const m: Partial<Record<Situacao, Lead[]>> = {}
    for (const l of leads) (m[l.situacao] ??= []).push(l)
    return m
  }, [leads])
  const elegiveis = useMemo(() => {
    const ord = { A: 0, B: 1, C: 2 } as Record<string, number>
    return [...(porSituacao.elegivel ?? [])].sort((a, b) =>
      (ord[a.estrato ?? 'C'] - ord[b.estrato ?? 'C']) ||
      (new Date(b.ultima_msg_lead ?? 0).getTime() - new Date(a.ultima_msg_lead ?? 0).getTime()))
  }, [porSituacao])

  // ---- 2. roleta (prévia calculada aqui; o banco rechecagem cada lead ao gravar) ----
  const previa = useMemo(() => {
    const vs = closers.filter(v => sel.has(v.id)).sort((a, b) => (carteira[a.id] ?? 0) - (carteira[b.id] ?? 0))
    const atrib: { lead: Lead; vendedor: Vendedor }[] = []
    if (!vs.length || !elegiveis.length) return { atrib, vs, sobra: elegiveis.length }
    const dado: Record<string, number> = Object.fromEntries(vs.map(v => [v.id, 0]))
    if (modo === 'equilibrar') {
      // cada lead vai para quem estiver com a carteira (ativos + recebidos agora) mais leve
      for (const lead of elegiveis) {
        const v = vs.reduce((m, x) => ((carteira[x.id] ?? 0) + dado[x.id]) < ((carteira[m.id] ?? 0) + dado[m.id]) ? x : m, vs[0])
        atrib.push({ lead, vendedor: v }); dado[v.id]++
      }
    } else {
      // rodízio quente → frio; a sobra cai em quem tem a carteira mais leve (vs já está nessa ordem).
      // manual: rodízio respeitando a quantidade de cada um
      const cap: Record<string, number> = Object.fromEntries(vs.map(v => [v.id, modo === 'manual' ? (manual[v.id] ?? 0) : Infinity]))
      let i = 0
      for (const lead of elegiveis) {
        let tent = 0, v: Vendedor | null = null
        while (tent < vs.length) { const x = vs[i % vs.length]; i++; tent++; if (dado[x.id] < cap[x.id]) { v = x; break } }
        if (!v) break
        atrib.push({ lead, vendedor: v }); dado[v.id]++
      }
    }
    return { atrib, vs, sobra: elegiveis.length - atrib.length }
  }, [closers, sel, carteira, elegiveis, modo, manual])

  const resumoPrevia = useMemo(() => {
    const m: Record<string, { n: number; A: number; B: number; C: number }> = {}
    for (const { lead, vendedor } of previa.atrib) {
      const x = (m[vendedor.id] ??= { n: 0, A: 0, B: 0, C: 0 }); x.n++; x[lead.estrato ?? 'C']++
    }
    return m
  }, [previa])

  // ---- 3. gravar ----
  const distribuir = async () => {
    if (distribuindo || !previa.atrib.length) return
    const n = previa.atrib.length
    if (!window.confirm(`Criar ${n} card(s) no Comercial para ${previa.vs.filter(v => resumoPrevia[v.id]?.n).map(v => v.nome).join(', ')}?\n\nCada lead sai da Anne e passa para o vendedor por 14 dias. Opt-out, compradores e quem já está com vendedor ficaram de fora.`)) return
    setDistribuindo(true)
    const resumo: Record<string, number> = {}
    for (const s of SIT_ORDEM) if (porSituacao[s]?.length) resumo[s] = porSituacao[s]!.length
    const itens = previa.atrib.map(a => ({ conversation_id: a.lead.conversation_id, vendedor_id: a.vendedor.id }))
    const { data, error } = await supabase.rpc('fn_leads_distribuir', {
      p_itens: itens, p_arquivo: arquivo, p_modo: MODO_LABEL[modo], p_total: linhasPlanilha, p_resumo: resumo,
    })
    setDistribuindo(false)
    if (error || !(data as any)?.ok) return flash('Erro ao distribuir: ' + (error?.message ?? (data as any)?.erro))
    setResultado(data)
    flash(`✅ ${(data as any).cards_criados} card(s) criado(s) — já aparecem no Pipeline e no Inbox de cada vendedor.`)
    setLeads([]); setArquivo(''); if (fileRef.current) fileRef.current.value = ''
    carregarCarteira(); carregarHistorico()
  }

  const exportarFora = () => {
    const linhas = [['telefone', 'nome (planilha)', 'e-mail (planilha)', 'nome (Anne)', 'situação', 'detalhe']]
    for (const s of SIT_ORDEM) if (s !== 'elegivel') for (const l of (porSituacao[s] ?? []))
      linhas.push([l.fone, l.nome_planilha ?? '', l.email_planilha ?? '', l.nome ?? '', SIT_LABEL[s].replace(/^\S+\s/, ''),
        s === 'humano' || s === 'card' ? (l.responsavel ?? '') : (l.agente ? (AGENT_LABEL[l.agente] ?? l.agente) : '')])
    baixarCsv(`fora_${arquivo.replace(/\.[^.]+$/, '')}.csv`, linhas)
  }
  const exportarPrevia = () => {
    const linhas = [['vendedor', 'ordem', 'telefone', 'nome (planilha)', 'nome (Anne)', 'temperatura', 'aluno', 'agente da Anne', 'última mensagem do lead']]
    previa.atrib.forEach((a, i) => linhas.push([a.vendedor.nome, String(i + 1), a.lead.fone, a.lead.nome_planilha ?? '', a.lead.nome ?? '',
      a.lead.estrato ?? '', a.lead.aluno ? 'sim' : '', a.lead.agente ? (AGENT_LABEL[a.lead.agente] ?? a.lead.agente) : '',
      a.lead.ultima_msg_lead ? new Date(a.lead.ultima_msg_lead).toLocaleDateString('pt-BR') : '']))
    baixarCsv(`distribuicao_${arquivo.replace(/\.[^.]+$/, '')}.csv`, linhas)
  }

  const fora = leads.length - elegiveis.length
  const inp = 'bg-panel border border-line rounded-lg px-3 py-2 text-sm text-cream focus:outline-none focus:border-gold/60'

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 max-w-5xl">
      {/* ---- 1. planilha ---- */}
      <section className="border border-line bg-panel/50 rounded-xl p-4 space-y-3">
        <h2 className="font-display font-semibold">📥 1. Subir a planilha de leads</h2>
        <div className="text-[11px] text-dim">
          Arquivo .xlsx ou .csv com uma coluna de telefone (nome e e-mail são opcionais). O cruzamento acontece no banco:
          quem pediu para não receber mensagens <b className="text-danger/90">nunca</b> entra, nem compradores, nem quem já está com vendedor.
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="text-xs text-dim file:mr-3 file:bg-gold file:text-ink file:font-semibold file:rounded-lg file:px-4 file:py-2 file:border-0 file:text-sm file:cursor-pointer"
            onChange={e => { const f = e.target.files?.[0]; if (f) lerArquivo(f) }} />
          {cruzando && <span className="text-xs text-gold animate-pulse">Cruzando {linhasPlanilha} telefones com a Anne…</span>}
        </div>
      </section>

      {/* ---- 2. cruzamento ---- */}
      {leads.length > 0 && (
        <section className="border border-line bg-panel/50 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="font-display font-semibold">🔎 2. Cruzamento com a Anne</h2>
            <span className="text-xs text-dim font-mono">{arquivo} · {linhasPlanilha} linhas</span>
            {fora > 0 && <button onClick={exportarFora} className="ml-auto text-xs border border-line rounded-lg px-2.5 py-1 text-dim hover:text-cream transition">⬇ Baixar quem ficou de fora ({fora})</button>}
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            {SIT_ORDEM.filter(s => porSituacao[s]?.length).map(s => (
              <button key={s} onClick={() => setVerFora(verFora === s ? null : s)}
                className={`text-left text-sm rounded-lg border px-3 py-2 transition ${s === 'elegivel' ? 'border-win/40 bg-win/5' : s === 'optout' ? 'border-danger/40 bg-danger/5' : 'border-line hover:border-line/80'} ${verFora === s ? 'ring-1 ring-gold/50' : ''}`}>
                <b className={`font-mono text-base mr-2 ${s === 'elegivel' ? 'text-win' : s === 'optout' ? 'text-danger' : 'text-cream'}`}>{porSituacao[s]!.length}</b>
                {SIT_LABEL[s]}
              </button>
            ))}
          </div>
          {verFora && (
            <div className="max-h-64 overflow-y-auto border border-line rounded-lg">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-panel2 text-dim"><tr><th className="text-left px-2 py-1">Telefone</th><th className="text-left px-2 py-1">Nome</th><th className="text-left px-2 py-1">{verFora === 'elegivel' ? 'Temperatura' : 'Detalhe'}</th></tr></thead>
                <tbody>
                  {(porSituacao[verFora] ?? []).slice(0, 500).map((l, i) => (
                    <tr key={i} className="border-t border-line/60">
                      <td className="px-2 py-1 font-mono">{fmtFone(l.telefone ?? l.fone) || l.fone}</td>
                      <td className="px-2 py-1">{l.nome ?? l.nome_planilha ?? '—'}{l.aluno && <span className="ml-1 text-[10px] text-gold">aluno</span>}</td>
                      <td className="px-2 py-1 text-dim">
                        {verFora === 'elegivel' ? <span className={`font-mono px-1.5 py-0.5 rounded border ${ESTRATO_CLS[l.estrato ?? 'C']}`}>{l.estrato}</span>
                          : (verFora === 'humano' || verFora === 'card') ? (l.responsavel ?? '') : (l.agente ? (AGENT_LABEL[l.agente] ?? l.agente) : '')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {elegiveis.length > 0 && (
            <div className="text-[11px] text-dim">
              Temperatura dos elegíveis: <b className="text-jevA">A {elegiveis.filter(l => l.estrato === 'A').length}</b> ·{' '}
              <b className="text-jevB">B {elegiveis.filter(l => l.estrato === 'B').length}</b> · C {elegiveis.filter(l => l.estrato === 'C').length}
              {elegiveis.some(l => l.aluno) && <> · <b className="text-gold">{elegiveis.filter(l => l.aluno).length} já são alunos</b> de algum produto (entram mesmo assim)</>}
            </div>
          )}
        </section>
      )}

      {/* ---- 3. roleta + prévia ---- */}
      {elegiveis.length > 0 && (
        <section className="border border-line bg-panel/50 rounded-xl p-4 space-y-4">
          <h2 className="font-display font-semibold">🎯 3. Roleta entre os vendedores</h2>
          <div className="flex flex-wrap gap-2">
            {closers.map(v => (
              <label key={v.id} className={`flex items-center gap-2 text-xs border rounded-lg px-2.5 py-1.5 cursor-pointer ${sel.has(v.id) ? 'border-gold/50 bg-gold/5' : 'border-line text-dim'}`}>
                <input type="checkbox" checked={sel.has(v.id)} onChange={e => { const s = new Set(sel); e.target.checked ? s.add(v.id) : s.delete(v.id); setSel(s) }} />
                <span>{v.nome}</span>
                <span className="font-mono text-[10px] text-dim">carteira {carteira[v.id] ?? 0}</span>
                {modo === 'manual' && sel.has(v.id) && (
                  <input type="number" min={0} className="w-16 bg-panel2 border border-line rounded px-1.5 py-0.5 text-xs font-mono"
                    value={manual[v.id] ?? ''} placeholder="0" onChange={e => setManual({ ...manual, [v.id]: Math.max(0, parseInt(e.target.value) || 0) })} />
                )}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {(Object.keys(MODO_LABEL) as Modo[]).map(m => (
              <button key={m} onClick={() => setModo(m)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition ${modo === m ? 'border-gold/60 bg-gold/10 text-cream' : 'border-line text-dim hover:text-cream'}`}>{MODO_LABEL[m]}</button>
            ))}
            <span className="text-[11px] text-dim self-center ml-2">
              {modo === 'iguais' && 'Rodízio do quente ao frio; a sobra vai para a carteira mais leve.'}
              {modo === 'equilibrar' && 'Quem tem menos leads ativos recebe mais, até as carteiras ficarem parecidas.'}
              {modo === 'manual' && 'Digite quantos cada vendedor recebe; o rodízio mantém a mistura de temperaturas.'}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-dim text-xs"><tr>
                <th className="text-left px-2 py-1">Vendedor</th><th className="text-right px-2 py-1">Recebe</th>
                <th className="text-right px-2 py-1 text-jevA">A</th><th className="text-right px-2 py-1 text-jevB">B</th><th className="text-right px-2 py-1">C</th>
                <th className="text-right px-2 py-1">Carteira depois</th></tr></thead>
              <tbody>
                {previa.vs.map(v => { const r = resumoPrevia[v.id]; return (
                  <tr key={v.id} className="border-t border-line/60">
                    <td className="px-2 py-1.5">{v.nome}</td>
                    <td className="px-2 py-1.5 text-right font-mono font-semibold text-cream">{r?.n ?? 0}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{r?.A ?? 0}</td><td className="px-2 py-1.5 text-right font-mono">{r?.B ?? 0}</td><td className="px-2 py-1.5 text-right font-mono">{r?.C ?? 0}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-dim">{(carteira[v.id] ?? 0) + (r?.n ?? 0)}</td>
                  </tr>) })}
              </tbody>
            </table>
          </div>
          {previa.sobra > 0 && <div className="text-xs text-amber">⚠️ {previa.sobra} elegível(is) ficam sem vendedor com essa configuração{modo === 'manual' ? ' — aumente as quantidades' : ' — marque pelo menos um vendedor'}.</div>}

          <div className="flex flex-wrap items-center gap-3">
            <button onClick={distribuir} disabled={distribuindo || !previa.atrib.length}
              className="bg-gold text-ink font-semibold rounded-lg px-5 py-2 text-sm hover:brightness-110 transition disabled:opacity-40">
              {distribuindo ? 'Distribuindo…' : `Distribuir ${previa.atrib.length} lead(s)`}
            </button>
            <button onClick={exportarPrevia} className="text-xs border border-line rounded-lg px-2.5 py-1.5 text-dim hover:text-cream transition">⬇ Baixar a prévia</button>
            <span className="text-[11px] text-dim">Na hora de gravar, o banco confere cada lead de novo (opt-out, compra, card, atendimento). Posse de 14 dias.</span>
          </div>
        </section>
      )}

      {/* ---- resultado ---- */}
      {resultado && (
        <section className="rise border border-win/40 bg-win/5 rounded-xl p-4 space-y-2">
          <h2 className="font-display font-semibold text-win">✅ Distribuição feita</h2>
          <div className="text-sm">{resultado.cards_criados} card(s) criado(s): {(resultado.por_vendedor ?? []).map((p: any) => `${p.vendedor} ${p.cards}`).join(' · ')}</div>
          {(resultado.recusados ?? []).length > 0 && (
            <div className="text-xs text-amber">
              {resultado.recusados.length} recusado(s) na gravação (mudaram entre o cruzamento e a confirmação):
              <ul className="mt-1 space-y-0.5">{resultado.recusados.slice(0, 20).map((r: any, i: number) => <li key={i} className="font-mono">{fmtFone(r.fone) || r.fone || '—'} — {r.motivo}</li>)}</ul>
            </div>
          )}
        </section>
      )}

      {/* ---- histórico ---- */}
      <section className="border border-line bg-panel/50 rounded-xl p-4 space-y-3">
        <h2 className="font-display font-semibold">📜 Importações anteriores</h2>
        {historico.length === 0 ? <div className="text-xs text-dim">Nenhuma importação por planilha ainda.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-dim"><tr>
                <th className="text-left px-2 py-1">Quando</th><th className="text-left px-2 py-1">Arquivo</th><th className="text-left px-2 py-1">Quem</th>
                <th className="text-right px-2 py-1">Planilha</th><th className="text-right px-2 py-1">Cards</th><th className="text-left px-2 py-1">Por vendedor</th><th className="text-left px-2 py-1">Fora</th></tr></thead>
              <tbody>
                {historico.map(h => (
                  <tr key={h.id} className="border-t border-line/60 align-top">
                    <td className="px-2 py-1.5 whitespace-nowrap">{new Date(h.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="px-2 py-1.5 max-w-[14rem] truncate" title={h.arquivo ?? ''}>{h.arquivo ?? '—'}<div className="text-[10px] text-dim">{h.modo}</div></td>
                    <td className="px-2 py-1.5 text-dim">{(h.criado_por ?? '').split('@')[0]}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{h.total_planilha ?? '—'}</td>
                    <td className="px-2 py-1.5 text-right font-mono font-semibold text-cream">{h.cards_criados ?? 0}</td>
                    <td className="px-2 py-1.5">{(h.por_vendedor ?? []).map(p => `${p.vendedor} ${p.cards}`).join(' · ') || '—'}</td>
                    <td className="px-2 py-1.5 text-dim">
                      {Object.entries(h.resumo ?? {}).filter(([k]) => k !== 'elegivel').map(([k, v]) => `${SIT_LABEL[k as Situacao]?.replace(/^\S+\s/, '').split(' (')[0] ?? k} ${v}`).join(' · ') || '—'}
                      {(h.recusados?.length ?? 0) > 0 && <span className="text-amber"> · {h.recusados!.length} recusado(s) na gravação</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
