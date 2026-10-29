import { useEffect, useMemo, useState } from 'react'
import { supabase, AGENT_LABEL } from '../lib/supabase'

// ============================================================
// 🧩 Templates do vendedor (29/10/2026) — só administrador (Lucas).
// Cura e cria os templates que o vendedor vê no Inbox com a janela
// de 24h fechada. Tabela vendedor_templates (migration 56); quem fala
// com a Meta é a rotina n8n "ANNE · Templates Vendedor Sync" (10 min):
// rascunho → fila → enviado → aprovado | rejeitado | erro.
// Variáveis: {{1}} nome do lead · {{2}} nome do vendedor · {{3}} concurso.
// ============================================================

type Row = {
  id: string; nome: string; rotulo: string; dica: string | null; frentes: string[] | null; ativo: boolean; ordem: number
  categoria: 'MARKETING' | 'UTILITY'; corpo: string | null; botoes: { text: string }[]; status: string
  meta_id: string | null; motivo: string | null; criado_por: string | null; criado_em: string; enviado_em: string | null; aprovado_em: string | null
}
type MetaTpl = { name: string; body: string; buttons: string[]; category: string }
type Metrica = { nome: string; envios: number; conversas: number; respostas: number; vendas: number; custo: number; ultimo_envio: string | null }
type Agente = { slug: string; name: string }

const TEMPLATES_URL = 'https://workflows.manager03.scvpgti.com.br/webhook/anne/meta/templates'
const STATUS_LABEL: Record<string, string> = {
  rascunho: '📝 Rascunho', fila: '⏫ Na fila para a Meta', enviado: '⏳ Em análise na Meta',
  aprovado: '✅ Aprovado', rejeitado: '❌ Rejeitado pela Meta', erro: '⚠️ Erro ao enviar',
}
const STATUS_CLS: Record<string, string> = {
  rascunho: 'border-line text-dim', fila: 'border-gold/40 text-gold', enviado: 'border-gold/40 text-gold',
  aprovado: 'border-win/40 text-win', rejeitado: 'border-danger/40 text-danger', erro: 'border-danger/40 text-danger',
}
const OPTOUT = ['Não tenho interesse', 'Bloquear este número']
const EXEMPLO = { 1: 'Maria', 2: 'Lucas', 3: 'TJ-AM' } as Record<number, string>
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60)
const render = (corpo: string, v: Record<number, string>) => corpo.replace(/\{\{(\d)\}\}/g, (_, n) => v[+n] ?? `{{${n}}}`)
const fmtData = (s: string | null) => s ? new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '—'

export default function ComercialTemplates({ flash }: { flash: (t: string) => void }) {
  const [rows, setRows] = useState<Row[]>([])
  const [meta, setMeta] = useState<MetaTpl[]>([])
  const [metricas, setMetricas] = useState<Record<string, Metrica>>({})
  const [periodo, setPeriodo] = useState<30 | 90 | 0>(30)
  const [agentes, setAgentes] = useState<Agente[]>([])
  const [editor, setEditor] = useState<Partial<Row> | null>(null)
  const [aberto, setAberto] = useState<string | null>(null)
  const [addMeta, setAddMeta] = useState('')
  const [salvando, setSalvando] = useState(false)

  const carregar = async () => {
    const { data } = await supabase.from('vendedor_templates').select('*').order('ordem').order('criado_em')
    setRows((data as any) ?? [])
  }
  const carregarMetricas = async () => {
    const desde = periodo ? new Date(Date.now() - periodo * 86400000).toISOString().slice(0, 10) : null
    const { data } = await supabase.rpc('fn_vendedor_templates_metricas', { p_desde: desde, p_ate: null })
    const m: Record<string, Metrica> = {}
    for (const x of ((data as Metrica[]) ?? [])) m[x.nome] = x
    setMetricas(m)
  }
  useEffect(() => {
    carregar()
    fetch(TEMPLATES_URL).then(r => r.json()).then(d => setMeta(d.templates ?? [])).catch(() => setMeta([]))
    supabase.from('agent_profiles').select('slug,name').eq('active', true).order('slug').then(({ data }) => setAgentes((data as any) ?? []))
  }, [])
  useEffect(() => { carregarMetricas() }, [periodo])
  // enquanto houver algo na fila / em análise, atualiza a cada 60 s (a rotina roda a cada 10 min)
  useEffect(() => {
    if (!rows.some(r => r.status === 'fila' || r.status === 'enviado')) return
    const t = setInterval(carregar, 60000); return () => clearInterval(t)
  }, [rows])

  const corpoDe = (r: Row) => r.corpo ?? meta.find(t => t.name === r.nome)?.body ?? ''
  const botoesDe = (r: Row): string[] => r.corpo ? r.botoes.map(b => b.text) : (meta.find(t => t.name === r.nome)?.buttons ?? [])
  const nomesNaTabela = useMemo(() => new Set(rows.map(r => r.nome)), [rows])
  const metaForaDaTabela = useMemo(() => meta.filter(t => !nomesNaTabela.has(t.name)).sort((a, b) => a.name.localeCompare(b.name)), [meta, nomesNaTabela])
  const grupos = useMemo(() => ({
    ativos: rows.filter(r => r.status === 'aprovado' && r.ativo),
    desligados: rows.filter(r => r.status === 'aprovado' && !r.ativo),
    analise: rows.filter(r => r.status === 'fila' || r.status === 'enviado'),
    problema: rows.filter(r => r.status === 'rejeitado' || r.status === 'erro'),
    rascunhos: rows.filter(r => r.status === 'rascunho'),
  }), [rows])

  // ---- ações de curadoria ----
  const patch = async (r: Row, campos: Partial<Row>, msg?: string) => {
    const { error } = await supabase.from('vendedor_templates').update(campos).eq('id', r.id)
    if (error) return flash('Erro: ' + error.message)
    if (msg) flash(msg)
    carregar()
  }
  const mover = async (r: Row, dir: -1 | 1) => {
    const lista = grupos.ativos
    const i = lista.findIndex(x => x.id === r.id); const j = i + dir
    if (j < 0 || j >= lista.length) return
    const a = lista[i], b = lista[j]
    await supabase.from('vendedor_templates').update({ ordem: b.ordem }).eq('id', a.id)
    await supabase.from('vendedor_templates').update({ ordem: a.ordem === b.ordem ? a.ordem + dir : a.ordem }).eq('id', b.id)
    carregar()
  }
  const excluir = async (r: Row) => {
    if (!window.confirm(`Excluir "${r.rotulo}" da lista?${r.status === 'aprovado' ? '\n\nO template continua existindo na Meta; só sai da curadoria (dá para adicionar de novo).' : ''}`)) return
    const { error } = await supabase.from('vendedor_templates').delete().eq('id', r.id)
    if (error) return flash('Erro: ' + error.message)
    carregar()
  }
  const adicionarDaMeta = async () => {
    const t = meta.find(x => x.name === addMeta); if (!t) return
    const { error } = await supabase.from('vendedor_templates').insert({
      nome: t.name, rotulo: t.name.replace(/^humano_/, '').replace(/_/g, ' '), status: 'aprovado', ativo: false,
      categoria: t.category === 'UTILITY' ? 'UTILITY' : 'MARKETING', ordem: (rows[rows.length - 1]?.ordem ?? 0) + 10, aprovado_em: new Date().toISOString(),
    })
    if (error) return flash(/nome_check/.test(error.message) ? 'Só templates com nome começando em "humano_" entram na lista do vendedor.' : 'Erro: ' + error.message)
    setAddMeta(''); flash('Adicionado desligado — dê um rótulo e ligue quando quiser.'); carregar()
  }

  // ---- editor (criar / editar) ----
  const novo = () => setEditor({ rotulo: '', dica: '', frentes: null, categoria: 'MARKETING', corpo: '', botoes: [{ text: '' }], nome: '' })
  const corrigir = (r: Row) => {
    // Meta não aceita o mesmo nome de novo: cria uma versão nova a partir do rejeitado
    const base = r.nome.replace(/_v\d+$/, ''); let n = 2
    while (nomesNaTabela.has(`${base}_v${n}`)) n++
    setEditor({ rotulo: r.rotulo, dica: r.dica, frentes: r.frentes, categoria: r.categoria, corpo: r.corpo ?? '', botoes: r.botoes.length ? r.botoes : [{ text: '' }], nome: `${base}_v${n}` })
  }
  const nParams = (corpo: string) => Math.max(0, ...[...corpo.matchAll(/\{\{(\d)\}\}/g)].map(m => +m[1]))
  const problemas = (e: Partial<Row>) => {
    const p: string[] = []
    const corpo = e.corpo ?? ''
    if (!e.rotulo?.trim()) p.push('Dê um rótulo (é o que o vendedor vê).')
    if (!e.nome || !/^humano_[a-z0-9_]{1,100}$/.test(e.nome)) p.push('Nome técnico inválido (só letras minúsculas, números e _, começando com humano_).')
    if (e.id == null && e.nome && nomesNaTabela.has(e.nome)) p.push('Já existe um template com esse nome técnico.')
    if (corpo.trim().length < 10) p.push('Escreva o texto da mensagem.')
    if (corpo.length > 1024) p.push('Texto acima de 1024 caracteres (limite da Meta).')
    const nums = [...corpo.matchAll(/\{\{(\d+)\}\}/g)].map(m => +m[1])
    if (nums.some(n => n > 3)) p.push('Só existem as variáveis {{1}}, {{2}} e {{3}}.')
    const max = nParams(corpo)
    for (let i = 1; i <= max; i++) if (!nums.includes(i)) p.push(`A Meta exige variáveis em sequência: faltou {{${i}}}.`)
    if (/\{\{\d\}\}\s*$/.test(corpo.trim()) || /^\s*\{\{\d\}\}/.test(corpo)) p.push('A Meta recusa texto que começa ou termina com variável — ponha uma palavra antes/depois.')
    if (/\d{1,2}\/\d{1,2}(\/\d{2,4})?/.test(corpo)) p.push('Evite data fixa no texto: o template vence e vira lixo no seletor.')
    const qs = (e.botoes ?? []).map(b => b.text.trim()).filter(Boolean)
    if (qs.some(t => t.length > 25)) p.push('Cada botão tem no máximo 25 caracteres.')
    if (e.categoria === 'MARKETING' && !qs.length) p.push('Coloque pelo menos um botão de resposta rápida: é ele que reabre a janela de 24h.')
    return p
  }
  const salvar = async (enviar: boolean) => {
    if (!editor || salvando) return
    const p = problemas(editor); if (p.length) return flash('⚠️ ' + p[0])
    setSalvando(true)
    const { data: u } = await supabase.auth.getUser()
    const dados = {
      nome: editor.nome, rotulo: editor.rotulo!.trim(), dica: editor.dica?.trim() || null,
      frentes: editor.frentes?.length ? editor.frentes : null, categoria: editor.categoria,
      corpo: editor.corpo!.trim(), botoes: (editor.botoes ?? []).map(b => ({ text: b.text.trim() })).filter(b => b.text),
      status: enviar ? 'fila' : 'rascunho', ativo: false, motivo: null,
    }
    const q = editor.id
      ? supabase.from('vendedor_templates').update(dados).eq('id', editor.id)
      : supabase.from('vendedor_templates').insert({ ...dados, criado_por: u.user?.email ?? 'painel', ordem: (rows[rows.length - 1]?.ordem ?? 0) + 10 })
    const { error } = await q
    setSalvando(false)
    if (error) return flash('Erro ao salvar: ' + error.message)
    setEditor(null)
    flash(enviar ? '⏫ Na fila — a rotina envia à Meta em até 10 minutos e o status aparece aqui.' : '📝 Rascunho salvo.')
    carregar()
  }
  const enviarFila = (r: Row) => patch(r, { status: 'fila', motivo: null }, '⏫ Na fila — a rotina envia à Meta em até 10 minutos.')

  const inp = 'bg-panel border border-line rounded-lg px-3 py-2 text-sm text-cream focus:outline-none focus:border-gold/60 placeholder:text-dim/40 w-full'
  const pct = (n: number, d: number) => d ? `${Math.round(100 * n / d)}%` : '—'

  const Card = ({ r, comOrdem }: { r: Row; comOrdem?: boolean }) => {
    const m = metricas[r.nome]; const corpo = corpoDe(r); const exp = aberto === r.id
    return (
      <div className={`border rounded-xl p-3 space-y-2 ${r.ativo && r.status === 'aprovado' ? 'border-line bg-panel/60' : 'border-line/60 bg-panel/30'}`}>
        <div className="flex items-start gap-2 flex-wrap">
          {comOrdem && (
            <div className="flex flex-col -my-1">
              <button onClick={() => mover(r, -1)} className="text-dim hover:text-cream text-xs leading-none px-1" title="Subir">▲</button>
              <button onClick={() => mover(r, 1)} className="text-dim hover:text-cream text-xs leading-none px-1" title="Descer">▼</button>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold">{r.rotulo}</span>
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${STATUS_CLS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-line text-dim">{r.categoria === 'UTILITY' ? 'utilidade' : 'marketing'}</span>
              {r.frentes?.length
                ? r.frentes.map(f => <span key={f} className="text-[10px] px-1.5 py-0.5 rounded border border-teal/30 text-teal">{AGENT_LABEL[f] ?? f}</span>)
                : <span className="text-[10px] px-1.5 py-0.5 rounded border border-line text-dim">todas as frentes</span>}
            </div>
            <div className="text-[11px] text-dim font-mono mt-0.5">{r.nome}</div>
            {r.dica && <div className="text-xs text-dim mt-1">💡 {r.dica}</div>}
            {r.motivo && <div className="text-xs text-danger/90 mt-1">Meta: {r.motivo}</div>}
          </div>
          {m && (
            <div className="text-right text-[11px] text-dim whitespace-nowrap" title="Envios · conversas que responderam em 48h · vendas em 14 dias · custo">
              <div><b className="text-cream font-mono">{m.envios}</b> envios · <b className={`font-mono ${m.respostas / Math.max(1, m.envios) >= 0.15 ? 'text-win' : 'text-cream'}`}>{pct(m.respostas, m.envios)}</b> resp.</div>
              <div><b className="text-gold font-mono">{m.vendas}</b> venda(s) · R$ {m.custo.toFixed(2).replace('.', ',')} · último {fmtData(m.ultimo_envio)}</div>
            </div>
          )}
        </div>
        {exp && (
          <div className="text-xs border border-teal/25 bg-teal/5 rounded-lg px-3 py-2 whitespace-pre-wrap leading-relaxed">
            {corpo ? render(corpo, EXEMPLO) : <span className="text-dim">Texto não disponível (a lista da Meta não carregou).</span>}
            {botoesDe(r).length > 0 && <div className="mt-2 flex gap-1 flex-wrap">{botoesDe(r).map((b, i) => <span key={i} className="px-2 py-0.5 rounded-full border border-line text-dim">{b}</span>)}</div>}
          </div>
        )}
        <div className="flex gap-1.5 flex-wrap text-xs">
          <button onClick={() => setAberto(exp ? null : r.id)} className="border border-line rounded-lg px-2.5 py-1 text-dim hover:text-cream transition">{exp ? 'Ocultar texto' : '👁 Ver texto'}</button>
          {r.status === 'aprovado' && (
            <button onClick={() => patch(r, { ativo: !r.ativo }, r.ativo ? 'Desligado — some do seletor dos vendedores.' : '✅ Ligado — já aparece para os vendedores.')}
              className={`rounded-lg px-2.5 py-1 border transition ${r.ativo ? 'border-amber/40 text-amber hover:bg-amber/10' : 'border-win/40 text-win hover:bg-win/10'}`}>
              {r.ativo ? '⏸ Desligar' : '▶ Ligar para os vendedores'}
            </button>
          )}
          <button onClick={() => setEditor({ ...r })} className="border border-line rounded-lg px-2.5 py-1 text-dim hover:text-cream transition">✏️ {r.status === 'rascunho' ? 'Editar' : 'Rótulo, dica e frentes'}</button>
          {r.status === 'rascunho' && r.corpo && <button onClick={() => enviarFila(r)} className="bg-gold text-ink font-semibold rounded-lg px-2.5 py-1 hover:brightness-110 transition">⏫ Enviar à Meta</button>}
          {(r.status === 'rejeitado' || r.status === 'erro') && <button onClick={() => corrigir(r)} className="bg-gold text-ink font-semibold rounded-lg px-2.5 py-1 hover:brightness-110 transition">🔁 Corrigir e reenviar como versão nova</button>}
          {!(r.status === 'aprovado' && r.ativo) && <button onClick={() => excluir(r)} className="ml-auto text-danger/70 hover:text-danger px-2 py-1 transition">Excluir</button>}
        </div>
      </div>
    )
  }

  const Grupo = ({ titulo, lista, comOrdem, vazio }: { titulo: string; lista: Row[]; comOrdem?: boolean; vazio?: string }) => (
    <section className="space-y-2">
      <h2 className="font-display font-semibold text-sm text-dim uppercase tracking-wider">{titulo} <span className="font-mono text-xs">({lista.length})</span></h2>
      {lista.length ? lista.map(r => <Card key={r.id} r={r} comOrdem={comOrdem} />) : <div className="text-xs text-dim">{vazio ?? 'Nenhum.'}</div>}
    </section>
  )

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 max-w-5xl">
      <section className="border border-line bg-panel/50 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="font-display font-semibold">🧩 Templates da janela fechada</h2>
          <div className="flex gap-1 ml-auto items-center">
            <span className="text-[11px] text-dim mr-1">Métricas:</span>
            {([[30, '30 dias'], [90, '90 dias'], [0, 'tudo']] as const).map(([v, l]) => (
              <button key={v} onClick={() => setPeriodo(v)} className={`text-xs px-2.5 py-1 rounded-lg border transition ${periodo === v ? 'border-gold/60 bg-gold/10 text-cream' : 'border-line text-dim hover:text-cream'}`}>{l}</button>
            ))}
          </div>
        </div>
        <div className="text-[11px] text-dim leading-relaxed">
          Quando o lead fica mais de 24h sem responder, a Meta só permite <b className="text-cream">template aprovado</b>. Aqui você decide quais os vendedores veem
          (ligar/desligar, ordem, frente e dica de uso) e cria templates novos — eles vão para a Meta pela rotina automática e só aparecem depois de aprovados.
          Cada envio custa cerca de <b className="text-cream">R$ 0,43</b>. Os dois botões de saída (opt-out) entram sozinhos em todo template de marketing.
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <button onClick={novo} className="bg-gold text-ink font-semibold rounded-lg px-4 py-2 text-sm hover:brightness-110 transition">＋ Criar template</button>
          {metaForaDaTabela.length > 0 && (
            <div className="flex gap-1 items-center">
              <select value={addMeta} onChange={e => setAddMeta(e.target.value)} className="bg-panel border border-line rounded-lg px-2 py-2 text-xs max-w-[18rem]">
                <option value="">Adicionar um já aprovado na Meta…</option>
                {metaForaDaTabela.map(t => <option key={t.name} value={t.name}>[{t.category}] {t.name}</option>)}
              </select>
              <button onClick={adicionarDaMeta} disabled={!addMeta} className="text-xs border border-line rounded-lg px-2.5 py-2 text-dim hover:text-cream disabled:opacity-40 transition">Adicionar</button>
            </div>
          )}
        </div>
      </section>

      <Grupo titulo="✅ Ligados para os vendedores (nesta ordem)" lista={grupos.ativos} comOrdem vazio="Nenhum template ligado — os vendedores não conseguem reabrir janela nenhuma!" />
      {grupos.analise.length > 0 && <Grupo titulo="⏳ Na Meta" lista={grupos.analise} />}
      {grupos.problema.length > 0 && <Grupo titulo="❌ Rejeitados / erro" lista={grupos.problema} />}
      {grupos.rascunhos.length > 0 && <Grupo titulo="📝 Rascunhos" lista={grupos.rascunhos} />}
      {grupos.desligados.length > 0 && <Grupo titulo="⏸ Aprovados, desligados" lista={grupos.desligados} />}

      {/* ---- editor ---- */}
      {editor && (
        <>
          <div className="fixed inset-0 z-40 bg-ink/60" onClick={() => setEditor(null)} />
          <div className="fixed inset-y-0 right-0 z-50 w-[34rem] max-w-[96vw] bg-panel border-l border-line shadow-2xl overflow-y-auto p-5 space-y-4">
            <div className="flex items-center">
              <h2 className="font-display font-semibold">{editor.id ? '✏️ Editar template' : '＋ Novo template'}</h2>
              <button onClick={() => setEditor(null)} className="ml-auto text-dim hover:text-cream text-xl leading-none">✕</button>
            </div>
            {(() => {
              const podeTexto = !editor.id || editor.status === 'rascunho'
              const corpo = editor.corpo ?? ''
              const qs = (editor.botoes ?? [])
              const ins = (v: string) => setEditor({ ...editor, corpo: corpo + (corpo && !/\s$/.test(corpo) ? ' ' : '') + v })
              const setNome = (rot: string) => setEditor({ ...editor, rotulo: rot, ...(podeTexto && !editor.id ? { nome: 'humano_' + slug(rot) } : {}) })
              const probs = problemas(editor)
              return (
                <>
                  <label className="block text-xs text-dim">Rótulo (o que o vendedor vê)
                    <input className={inp + ' mt-1'} value={editor.rotulo ?? ''} onChange={e => setNome(e.target.value)} placeholder="Ex.: Retomada pós-aula" /></label>
                  <label className="block text-xs text-dim">Quando usar (dica curta)
                    <input className={inp + ' mt-1'} value={editor.dica ?? ''} onChange={e => setEditor({ ...editor, dica: e.target.value })} placeholder="Ex.: lead viu a aula inteira e sumiu" /></label>
                  <div className="text-xs text-dim">Mostrar só nas frentes
                    <div className="flex flex-wrap gap-1 mt-1">
                      <button onClick={() => setEditor({ ...editor, frentes: null })} className={`text-[11px] px-2 py-1 rounded-lg border ${!editor.frentes?.length ? 'border-gold/60 bg-gold/10 text-cream' : 'border-line text-dim'}`}>Todas</button>
                      {agentes.map(a => { const on = editor.frentes?.includes(a.slug); return (
                        <button key={a.slug} onClick={() => { const f = new Set(editor.frentes ?? []); on ? f.delete(a.slug) : f.add(a.slug); setEditor({ ...editor, frentes: [...f] }) }}
                          className={`text-[11px] px-2 py-1 rounded-lg border ${on ? 'border-teal/60 bg-teal/10 text-teal' : 'border-line text-dim'}`}>{AGENT_LABEL[a.slug] ?? a.name}</button>) })}
                    </div>
                  </div>
                  {podeTexto && (
                    <>
                      <div className="text-xs text-dim">Categoria
                        <div className="flex gap-1 mt-1">
                          {(['MARKETING', 'UTILITY'] as const).map(c => (
                            <button key={c} onClick={() => setEditor({ ...editor, categoria: c })} className={`text-[11px] px-2.5 py-1 rounded-lg border ${editor.categoria === c ? 'border-gold/60 bg-gold/10 text-cream' : 'border-line text-dim'}`}>
                              {c === 'MARKETING' ? 'Marketing (retomada, oferta)' : 'Utilidade (aviso, suporte)'}</button>
                          ))}
                        </div>
                        <div className="text-[10px] text-dim mt-1">Utilidade não leva botões de saída, mas a Meta reclassifica para marketing se o texto vender algo.</div>
                      </div>
                      <label className="block text-xs text-dim">Texto da mensagem
                        <textarea className={inp + ' mt-1 h-36 leading-relaxed'} value={corpo} onChange={e => setEditor({ ...editor, corpo: e.target.value })}
                          placeholder={'{{1}}, aqui é {{2}}. Vi que você se interessou pela mentoria de {{3}}…'} /></label>
                      <div className="flex gap-1 flex-wrap text-[11px]">
                        <span className="text-dim self-center">Inserir:</span>
                        <button onClick={() => ins('{{1}}')} className="border border-line rounded px-2 py-0.5 text-dim hover:text-cream">{'{{1}}'} nome do lead</button>
                        <button onClick={() => ins('{{2}}')} className="border border-line rounded px-2 py-0.5 text-dim hover:text-cream">{'{{2}}'} nome do vendedor</button>
                        <button onClick={() => ins('{{3}}')} className="border border-line rounded px-2 py-0.5 text-dim hover:text-cream">{'{{3}}'} concurso</button>
                        <span className="text-dim self-center ml-auto font-mono">{corpo.length}/1024</span>
                      </div>
                      <div className="text-xs text-dim">Botões de resposta rápida (até 25 caracteres; o 1º é o que reabre a janela)
                        {qs.map((b, i) => (
                          <div key={i} className="flex gap-1 mt-1">
                            <input className={inp} value={b.text} maxLength={25} onChange={e => { const n = [...qs]; n[i] = { text: e.target.value }; setEditor({ ...editor, botoes: n }) }} placeholder={i === 0 ? 'Ex.: Quero avançar' : 'Ex.: Retomar depois'} />
                            {qs.length > 1 && <button onClick={() => setEditor({ ...editor, botoes: qs.filter((_, j) => j !== i) })} className="text-dim hover:text-danger px-2">✕</button>}
                          </div>
                        ))}
                        {qs.length < 3 && <button onClick={() => setEditor({ ...editor, botoes: [...qs, { text: '' }] })} className="text-[11px] text-dim hover:text-cream mt-1">＋ outro botão</button>}
                      </div>
                      <label className="block text-xs text-dim">Nome técnico na Meta
                        <input className={inp + ' mt-1 font-mono text-xs'} value={editor.nome ?? ''} disabled={!!editor.id} onChange={e => setEditor({ ...editor, nome: e.target.value.toLowerCase() })} /></label>
                    </>
                  )}

                  {/* prévia */}
                  <div className="border border-teal/25 bg-teal/5 rounded-xl p-3 space-y-2">
                    <div className="text-[10px] font-mono text-teal uppercase tracking-widest">Prévia (como o lead recebe)</div>
                    <div className="text-sm whitespace-pre-wrap leading-relaxed">{render(corpo || (editor.id ? corpoDe(editor as Row) : ''), EXEMPLO) || <span className="text-dim">…</span>}</div>
                    <div className="flex gap-1 flex-wrap text-[11px]">
                      {qs.map(b => b.text.trim()).filter(Boolean).map((b, i) => <span key={i} className="px-2 py-0.5 rounded-full border border-teal/40 text-teal">{b}</span>)}
                      {editor.categoria !== 'UTILITY' && OPTOUT.map(b => <span key={b} className="px-2 py-0.5 rounded-full border border-line text-dim" title="Adicionado automaticamente — obrigatório">{b}</span>)}
                    </div>
                  </div>
                  {podeTexto && probs.length > 0 && (
                    <ul className="text-xs text-amber space-y-0.5">{probs.map((p, i) => <li key={i}>⚠️ {p}</li>)}</ul>
                  )}
                  <div className="text-[10px] text-dim leading-relaxed">
                    Regras: sem data fixa nem preço que muda (não dá para editar depois de aprovado — vira template novo); botão de link não reabre a janela,
                    só resposta rápida; a aprovação da Meta leva de minutos a 1 dia e pode ser recusada — o motivo aparece aqui.
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {podeTexto ? (
                      <>
                        <button onClick={() => salvar(false)} disabled={salvando} className="border border-line rounded-lg px-4 py-2 text-sm text-dim hover:text-cream transition disabled:opacity-40">Salvar rascunho</button>
                        <button onClick={() => salvar(true)} disabled={salvando || probs.length > 0} className="bg-gold text-ink font-semibold rounded-lg px-4 py-2 text-sm hover:brightness-110 transition disabled:opacity-40">⏫ Salvar e enviar à Meta</button>
                      </>
                    ) : (
                      <button onClick={async () => { await patch(editor as Row, { rotulo: editor.rotulo!.trim(), dica: editor.dica?.trim() || null, frentes: editor.frentes?.length ? editor.frentes : null }, '✅ Salvo.'); setEditor(null) }}
                        disabled={!editor.rotulo?.trim()} className="bg-gold text-ink font-semibold rounded-lg px-4 py-2 text-sm hover:brightness-110 transition disabled:opacity-40">Salvar</button>
                    )}
                  </div>
                </>
              )
            })()}
          </div>
        </>
      )}
    </div>
  )
}
