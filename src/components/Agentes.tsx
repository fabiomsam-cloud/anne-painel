import { useEffect, useState } from 'react'
import { supabase, fmtHora } from '../lib/supabase'

type Profile = {
  id: string; slug: string; name: string; active: boolean; model: string
  system_prompt: string | null; prompt_sections: any; dados_mentoria: any
  checkout_url: string | null; entry_triggers: any; followup_cadence_id: string | null
}
type Revision = {
  id: string; campo: string; old_value: any; changed_by: string | null; created_at: string
}
type Doc = { id: string; title: string; doc_type: string; status: string; updated_at: string }

const SECOES: { key: string; titulo: string; ajuda: string; rows: number }[] = [
  { key: 'fase1_perguntas', titulo: 'Fase 1 · Perguntas de situação',
    ajuda: 'As perguntas abertas que a Anne usa para conhecer o momento do lead (já estuda? trabalha? qual cargo mira?). Separe com "?" — ela usa UMA por mensagem.', rows: 3 },
  { key: 'fase2_dores', titulo: 'Fase 2 · Dores, implicação e prova social',
    ajuda: 'As dores típicas deste concurso, a implicação de esperar o edital, e a prova social REAL (só casos verdadeiros da base — nunca inventar).', rows: 6 },
  { key: 'fase3_exemplos', titulo: 'Fase 3 · Exemplos de valor gratuito',
    ajuda: 'O que a Anne entrega DE GRAÇA conectado à dor (priorização de matérias, dado da banca, passo do método). Formato: um exemplo por linha começando com "- Dor → entrega".', rows: 6 },
  { key: 'fase4_diferenciais', titulo: 'Fase 4 · Entregáveis prioritários da oferta (opcional)',
    ajuda: 'Se preenchido, a Anne prioriza estes itens na pilha de ✅ da oferta. Vazio = ela escolhe da base de conhecimento.', rows: 3 },
  { key: 'verdades', titulo: 'Verdades do concurso (limites do que pode dizer)',
    ajuda: 'O que é FATO vs. previsão (edital publicado? banca? vagas?). A Anne nunca viola isto — é a proteção contra promessa falsa.', rows: 5 },
]

const NOVO_PLACEHOLDER: Record<string, string> = {
  fase1_perguntas: 'já estuda ou está começando? trabalha e estuda? qual cargo você mira?',
  fase2_dores: 'Explore a dor principal: falta de tempo? falta de direção? reprovações?\nAmplie a implicação com leveza: [oportunidade do concurso — vagas/ano previsto].\nSe mencionar reprovação: acolha; prova social APENAS com casos reais da base.',
  fase3_exemplos: '- Falta de direção → matérias de maior peso do último edital: [liste]\n- Falta de tempo → ciclo enxuto priorizando [matérias]\n- [Dor típica] → [entrega gratuita da base]',
  fase4_diferenciais: '',
  verdades: 'O concurso [status real: anunciado/solicitado]. Edital NÃO publicado; banca NÃO definida; sem data de prova. O último edital ([ano]) é referência, não garantia. Nunca prometa aprovação.',
}

export default function Agentes() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [sel, setSel] = useState<Profile | null>(null)
  const [modo, setModo] = useState<'lista' | 'agente' | 'novo' | 'avancado'>('lista')
  const [form, setForm] = useState<any>({})
  const [revisoes, setRevisoes] = useState<Revision[]>([])
  const [docs, setDocs] = useState<Doc[]>([])
  const [novoDoc, setNovoDoc] = useState({ title: '', doc_type: 'faq', raw_content: '' })
  const [metodo, setMetodo] = useState('')
  const [roteadorPrompt, setRoteadorPrompt] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState('')
  const [preview, setPreview] = useState('')

  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(''), 6000) }

  const carregar = async () => {
    const { data } = await supabase.from('agent_profiles').select('*').order('slug')
    setProfiles((data as any) ?? [])
  }
  useEffect(() => { carregar() }, [])

  const abrirAgente = async (p: Profile) => {
    setSel(p); setModo('agente'); setPreview('')
    setForm({
      name: p.name, model: p.model, active: p.active,
      checkout_url: p.checkout_url ?? '',
      valor_ancora: p.dados_mentoria?.valor_ancora ?? '',
      valor_promocional: p.dados_mentoria?.valor_promocional ?? '',
      keywords: (p.entry_triggers?.keywords ?? []).join(', '),
      mentoria_nome: p.prompt_sections?.mentoria_nome ?? '',
      concurso_nome: p.prompt_sections?.concurso_nome ?? '',
      ...Object.fromEntries(SECOES.map(s => [s.key, p.prompt_sections?.[s.key] ?? ''])),
    })
    const { data: r } = await supabase.from('prompt_revisions')
      .select('id,campo,old_value,changed_by,created_at')
      .eq('agent_slug', p.slug).order('created_at', { ascending: false }).limit(10)
    setRevisoes((r as any) ?? [])
    const { data: d } = await supabase.from('knowledge_documents')
      .select('id,title,doc_type,status,updated_at')
      .eq('agent_slug', p.slug).order('updated_at', { ascending: false }).limit(20)
    setDocs((d as any) ?? [])
  }

  const salvarAgente = async () => {
    if (!sel) return
    setSalvando(true)
    const sections = {
      mentoria_nome: form.mentoria_nome, concurso_nome: form.concurso_nome,
      ...Object.fromEntries(SECOES.map(s => [s.key, form[s.key] ?? ''])),
    }
    const { error } = await supabase.from('agent_profiles').update({
      name: form.name, model: form.model, active: form.active,
      checkout_url: form.checkout_url || null,
      dados_mentoria: { ...(sel.dados_mentoria ?? {}), valor_ancora: form.valor_ancora, valor_promocional: form.valor_promocional, parcelamento: form.valor_promocional },
      entry_triggers: { ...(sel.entry_triggers ?? {}), keywords: form.keywords.split(',').map((k: string) => k.trim()).filter(Boolean) },
      prompt_sections: sections,
    }).eq('id', sel.id)
    setSalvando(false)
    if (error) return flash('Erro: ' + error.message)
    flash('Salvo! O prompt foi recomposto e já vale na próxima mensagem.')
    carregar(); abrirAgente({ ...sel, name: form.name } as Profile)
  }

  const verPreview = async () => {
    if (!sel) return
    const { data } = await supabase.from('agent_profiles').select('system_prompt').eq('id', sel.id).single()
    setPreview(data?.system_prompt ?? '')
  }

  const restaurar = async (r: Revision) => {
    if (!sel || !r.old_value) return
    if (!window.confirm('Restaurar as seções desta versão? A versão atual fica no histórico.')) return
    await supabase.from('agent_profiles').update({ prompt_sections: r.old_value }).eq('id', sel.id)
    flash('Versão restaurada.')
    const { data } = await supabase.from('agent_profiles').select('*').eq('id', sel.id).single()
    if (data) abrirAgente(data as Profile)
  }

  const enviarDoc = async () => {
    if (!sel || !novoDoc.title.trim() || !novoDoc.raw_content.trim()) return
    const { data: u } = await supabase.auth.getUser()
    await supabase.from('knowledge_documents').insert({
      ...novoDoc, agent_slug: sel.slug, source: 'painel', created_by: u.user?.email ?? 'painel',
    })
    setNovoDoc({ title: '', doc_type: 'faq', raw_content: '' })
    flash('Documento enviado — ingestão automática em andamento (status vira "ready").')
    setTimeout(() => abrirAgente(sel), 4000)
  }

  const criarAgente = async () => {
    const slug = (form.slug || '').trim()
    if (!slug || !form.name || !form.mentoria_nome) return flash('Preencha ao menos slug, nome e nome da mentoria.')
    setSalvando(true)
    const { data: cad } = await supabase.from('followup_cadences').select('id').eq('name', 'Padrão 6x6h').limit(1).single()
    const sections = {
      mentoria_nome: form.mentoria_nome, concurso_nome: form.concurso_nome ?? '',
      ...Object.fromEntries(SECOES.map(s => [s.key, form[s.key] ?? ''])),
    }
    const { error } = await supabase.from('agent_profiles').insert({
      slug, name: form.name, active: false, model: 'gpt-5',
      checkout_url: form.checkout_url || null,
      dados_mentoria: { valor_ancora: form.valor_ancora ?? '', valor_promocional: form.valor_promocional ?? '', parcelamento: form.valor_promocional ?? '', moeda: 'BRL' },
      entry_triggers: { keywords: (form.keywords ?? '').split(',').map((k: string) => k.trim()).filter(Boolean), prefill_snippets: [], ctwa_ids: [] },
      prompt_sections: sections, rag_namespace: slug,
      followup_cadence_id: cad?.id ?? null,
    })
    setSalvando(false)
    if (error) return flash('Erro: ' + error.message)
    flash('Agente criado INATIVO. Adicione a base de conhecimento, teste, e só então ative.')
    setModo('lista'); carregar()
  }

  const abrirAvancado = async () => {
    setModo('avancado')
    const { data } = await supabase.from('global_settings').select('value').eq('key', 'metodo_vendas').single()
    setMetodo(typeof data?.value === 'string' ? data.value : (data?.value ?? ''))
    const rot = profiles.find(p => p.slug === 'roteador')
    setRoteadorPrompt(rot?.system_prompt ?? '')
  }

  const salvarMetodo = async () => {
    if (!window.confirm('O MÉTODO vale para TODOS os agentes e contém as regras calibradas de conversão. Confirmar a alteração e recompor todos os prompts?')) return
    setSalvando(true)
    const { error } = await supabase.from('global_settings')
      .update({ value: metodo, updated_at: new Date().toISOString() }).eq('key', 'metodo_vendas')
    if (!error) {
      const { data: n } = await supabase.rpc('recompose_all_prompts')
      flash(`Método salvo — ${n ?? '?'} agentes recompostos.`)
    } else flash('Erro: ' + error.message)
    setSalvando(false); carregar()
  }

  const salvarRoteador = async () => {
    const rot = profiles.find(p => p.slug === 'roteador')
    if (!rot) return
    await supabase.from('agent_profiles').update({ system_prompt: roteadorPrompt }).eq('id', rot.id)
    flash('Prompt do roteador salvo.')
  }

  const inp = 'w-full bg-panel border border-line rounded-lg px-3 py-2 text-sm text-cream focus:outline-none focus:border-gold/60 placeholder:text-dim/40'
  const lbl = 'block text-xs text-dim'

  /* ---------- LISTA ---------- */
  if (modo === 'lista') return (
    <div className="h-full overflow-y-auto p-6 max-w-4xl">
      {msg && <div className="rise border border-win/40 bg-win/10 text-win text-sm rounded-xl px-4 py-3 mb-4">{msg}</div>}
      <div className="flex items-center justify-between mb-2">
        <h1 className="font-display font-bold text-2xl">Agentes</h1>
        <button onClick={() => { setForm({ model: 'gpt-5' }); setModo('novo') }}
          className="bg-gold text-ink font-semibold rounded-lg px-4 py-2 text-sm hover:brightness-110 transition">＋ Novo agente</button>
      </div>
      <p className="text-xs text-dim mb-5">Cada agente vende uma mentoria. Edite as seções do prompt para melhorar a performance — a mudança vale na mensagem seguinte, com histórico e restauração.</p>
      <div className="space-y-2">
        {profiles.filter(p => p.slug !== 'roteador').map(p => (
          <button key={p.id} onClick={() => abrirAgente(p)}
            className="w-full text-left border border-line bg-panel/50 rounded-xl p-4 hover:border-gold/40 transition flex items-center gap-3">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${p.active ? 'bg-win' : 'bg-dim'}`} />
            <div className="min-w-0">
              <div className="font-semibold">{p.name}</div>
              <div className="font-mono text-[11px] text-dim">{p.slug} · {p.model}
                {p.dados_mentoria?.valor_promocional && <span className="text-gold"> · {p.dados_mentoria.valor_promocional}</span>}
              </div>
            </div>
            <span className="ml-auto text-dim text-sm">editar →</span>
          </button>
        ))}
      </div>
      <button onClick={abrirAvancado} className="mt-8 text-xs text-dim hover:text-danger transition">
        ⚙️ Modo avançado (método de vendas global + roteador) →
      </button>
    </div>
  )

  /* ---------- MODO AVANÇADO ---------- */
  if (modo === 'avancado') return (
    <div className="h-full overflow-y-auto p-6 max-w-4xl space-y-5">
      {msg && <div className="rise border border-win/40 bg-win/10 text-win text-sm rounded-xl px-4 py-3">{msg}</div>}
      <button onClick={() => setModo('lista')} className="text-sm text-dim hover:text-cream">← Voltar</button>
      <div className="border border-danger/40 bg-danger/5 rounded-xl p-4 text-sm">
        ⚠️ <b>Área sensível.</b> O método abaixo vale para TODOS os agentes e contém as regras calibradas de conversão
        (4 fases, 1 pergunta por mensagem, gate do link). Os trechos <span className="font-mono text-xs">{'{{ASSIM}}'}</span> são
        preenchidos pelas seções de cada agente — não os remova.
      </div>
      <section>
        <h2 className="font-display font-bold text-lg mb-2">Método de vendas (global)</h2>
        <textarea rows={22} value={metodo} onChange={e => setMetodo(e.target.value)}
          className={inp + ' font-mono text-xs leading-relaxed'} />
        <button onClick={salvarMetodo} disabled={salvando}
          className="mt-2 bg-danger/80 text-ink font-semibold rounded-lg px-5 py-2 text-sm hover:brightness-110 transition disabled:opacity-50">
          Salvar método e recompor TODOS os agentes
        </button>
      </section>
      <section>
        <h2 className="font-display font-bold text-lg mb-2">Prompt do roteador (triagem)</h2>
        <textarea rows={6} value={roteadorPrompt} onChange={e => setRoteadorPrompt(e.target.value)}
          className={inp + ' text-xs leading-relaxed'} />
        <button onClick={salvarRoteador} className="mt-2 bg-gold text-ink font-semibold rounded-lg px-5 py-2 text-sm hover:brightness-110 transition">Salvar roteador</button>
      </section>
    </div>
  )

  /* ---------- NOVO AGENTE ---------- */
  if (modo === 'novo') return (
    <div className="h-full overflow-y-auto p-6 max-w-3xl space-y-4">
      {msg && <div className="rise border border-win/40 bg-win/10 text-win text-sm rounded-xl px-4 py-3">{msg}</div>}
      <button onClick={() => setModo('lista')} className="text-sm text-dim hover:text-cream">← Voltar</button>
      <h1 className="font-display font-bold text-2xl">Novo agente</h1>
      <p className="text-xs text-dim">O agente nasce <b>inativo</b>: preencha, adicione a base de conhecimento, teste com um número da equipe e só então ative. O roteador o reconhece automaticamente pelas palavras-chave.</p>
      <div className="grid grid-cols-2 gap-3">
        <label className={lbl}>Nome do agente
          <input className={inp + ' mt-1'} placeholder="Especialista Elite INSS" value={form.name ?? ''}
            onChange={e => setForm({ ...form, name: e.target.value, slug: (form.slugTocado ? form.slug : 'elite_' + e.target.value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^especialista\s+elite\s+/i, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')) })} />
        </label>
        <label className={lbl}>Slug (identificador único)
          <input className={inp + ' mt-1 font-mono'} placeholder="elite_inss" value={form.slug ?? ''}
            onChange={e => setForm({ ...form, slug: e.target.value, slugTocado: true })} />
        </label>
        <label className={lbl}>Nome da mentoria (como a Anne fala)
          <input className={inp + ' mt-1'} placeholder="Mentoria Elite INSS" value={form.mentoria_nome ?? ''}
            onChange={e => setForm({ ...form, mentoria_nome: e.target.value })} />
        </label>
        <label className={lbl}>Concurso (como a Anne fala)
          <input className={inp + ' mt-1'} placeholder="concurso do INSS" value={form.concurso_nome ?? ''}
            onChange={e => setForm({ ...form, concurso_nome: e.target.value })} />
        </label>
        <label className={lbl}>Valor âncora
          <input className={inp + ' mt-1'} placeholder="R$ 3.000,00" value={form.valor_ancora ?? ''}
            onChange={e => setForm({ ...form, valor_ancora: e.target.value })} />
        </label>
        <label className={lbl}>Valor promocional
          <input className={inp + ' mt-1'} placeholder="12x R$ 159,77" value={form.valor_promocional ?? ''}
            onChange={e => setForm({ ...form, valor_promocional: e.target.value })} />
        </label>
        <label className={lbl + ' col-span-2'}>Link de matrícula (Hubla)
          <input className={inp + ' mt-1 font-mono'} placeholder="https://hub.la/r/..." value={form.checkout_url ?? ''}
            onChange={e => setForm({ ...form, checkout_url: e.target.value })} />
        </label>
        <label className={lbl + ' col-span-2'}>Palavras-chave de roteamento (separadas por vírgula)
          <input className={inp + ' mt-1'} placeholder="inss, previdência, técnico do seguro social" value={form.keywords ?? ''}
            onChange={e => setForm({ ...form, keywords: e.target.value })} />
        </label>
      </div>
      {SECOES.map(s => (
        <label key={s.key} className={lbl}>{s.titulo}
          <div className="text-[11px] text-dim/70 mb-1">{s.ajuda}</div>
          <textarea rows={s.rows} className={inp} placeholder={NOVO_PLACEHOLDER[s.key]}
            value={form[s.key] ?? ''} onChange={e => setForm({ ...form, [s.key]: e.target.value })} />
        </label>
      ))}
      <button onClick={criarAgente} disabled={salvando}
        className="bg-gold text-ink font-semibold rounded-lg px-6 py-2.5 text-sm hover:brightness-110 transition disabled:opacity-50">
        {salvando ? 'Criando…' : 'Criar agente (inativo)'}
      </button>
    </div>
  )

  /* ---------- AGENTE (edição) ---------- */
  if (!sel) return null
  return (
    <div className="h-full overflow-y-auto p-6 max-w-3xl space-y-5">
      {msg && <div className="rise border border-win/40 bg-win/10 text-win text-sm rounded-xl px-4 py-3">{msg}</div>}
      <button onClick={() => { setModo('lista'); setSel(null); carregar() }} className="text-sm text-dim hover:text-cream">← Voltar</button>

      <div className="flex items-center gap-3">
        <h1 className="font-display font-bold text-2xl">{sel.name}</h1>
        <span className="font-mono text-[11px] text-dim">{sel.slug}</span>
        <label className="ml-auto text-xs text-dim flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={!!form.active} onChange={e => setForm({ ...form, active: e.target.checked })}
            className="accent-[#f5b942]" /> ativo
        </label>
      </div>

      <section className="border border-line bg-panel/50 rounded-xl p-4 space-y-3">
        <h2 className="font-display font-semibold">Comercial</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className={lbl}>Nome <input className={inp + ' mt-1'} value={form.name ?? ''} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
          <label className={lbl}>Modelo IA <input className={inp + ' mt-1 font-mono'} value={form.model ?? ''} onChange={e => setForm({ ...form, model: e.target.value })} /></label>
          <label className={lbl}>Valor âncora <input className={inp + ' mt-1'} value={form.valor_ancora ?? ''} onChange={e => setForm({ ...form, valor_ancora: e.target.value })} /></label>
          <label className={lbl}>Valor promocional <input className={inp + ' mt-1'} value={form.valor_promocional ?? ''} onChange={e => setForm({ ...form, valor_promocional: e.target.value })} /></label>
          <label className={lbl + ' col-span-2'}>Link de matrícula <input className={inp + ' mt-1 font-mono'} value={form.checkout_url ?? ''} onChange={e => setForm({ ...form, checkout_url: e.target.value })} /></label>
          <label className={lbl + ' col-span-2'}>Palavras-chave de roteamento <input className={inp + ' mt-1'} value={form.keywords ?? ''} onChange={e => setForm({ ...form, keywords: e.target.value })} /></label>
        </div>
      </section>

      <section className="border border-line bg-panel/50 rounded-xl p-4 space-y-4">
        <h2 className="font-display font-semibold">Prompt do agente <span className="text-[11px] text-dim font-body font-normal">— o método de vendas (4 fases) é global; aqui você edita o que é específico desta mentoria</span></h2>
        <div className="grid grid-cols-2 gap-3">
          <label className={lbl}>Nome da mentoria <input className={inp + ' mt-1'} value={form.mentoria_nome ?? ''} onChange={e => setForm({ ...form, mentoria_nome: e.target.value })} /></label>
          <label className={lbl}>Concurso <input className={inp + ' mt-1'} value={form.concurso_nome ?? ''} onChange={e => setForm({ ...form, concurso_nome: e.target.value })} /></label>
        </div>
        {SECOES.map(s => (
          <label key={s.key} className={lbl}>{s.titulo}
            <div className="text-[11px] text-dim/70 mb-1">{s.ajuda}</div>
            <textarea rows={s.rows} className={inp + ' leading-relaxed'} value={form[s.key] ?? ''}
              onChange={e => setForm({ ...form, [s.key]: e.target.value })} />
          </label>
        ))}
        <div className="flex items-center gap-3">
          <button onClick={salvarAgente} disabled={salvando}
            className="bg-gold text-ink font-semibold rounded-lg px-6 py-2.5 text-sm hover:brightness-110 transition disabled:opacity-50">
            {salvando ? 'Salvando…' : 'Salvar alterações'}
          </button>
          <button onClick={verPreview} className="text-xs text-dim border border-line rounded-lg px-3 py-2 hover:text-cream transition">
            👁 Ver prompt final composto
          </button>
        </div>
        {preview && (
          <pre className="rise bg-panel border border-line rounded-xl p-4 text-[11px] leading-relaxed whitespace-pre-wrap max-h-80 overflow-y-auto text-dim">{preview}</pre>
        )}
      </section>

      <section className="border border-line bg-panel/50 rounded-xl p-4 space-y-3">
        <h2 className="font-display font-semibold">Base de conhecimento deste agente</h2>
        {docs.map(d => (
          <div key={d.id} className="flex items-center gap-3 text-sm border border-line/60 bg-panel/30 rounded-lg px-3 py-2">
            <span className={`font-mono text-[10px] uppercase ${d.status === 'ready' ? 'text-win' : d.status === 'error' ? 'text-danger' : 'text-gold'}`}>● {d.status}</span>
            <span className="truncate">{d.title}</span>
            <span className="ml-auto font-mono text-[10px] text-dim/60">{d.doc_type} · {fmtHora(d.updated_at)}</span>
          </div>
        ))}
        <div className="grid grid-cols-2 gap-3">
          <input className={inp} placeholder="Título do documento" value={novoDoc.title}
            onChange={e => setNovoDoc({ ...novoDoc, title: e.target.value })} />
          <select className={inp} value={novoDoc.doc_type} onChange={e => setNovoDoc({ ...novoDoc, doc_type: e.target.value })}>
            <option value="faq">FAQ</option><option value="edital">Edital / concurso</option>
            <option value="mentoria">Mentoria</option><option value="outro">Outro</option>
          </select>
        </div>
        <textarea rows={5} className={inp} placeholder="Cole o conteúdo aqui…" value={novoDoc.raw_content}
          onChange={e => setNovoDoc({ ...novoDoc, raw_content: e.target.value })} />
        <button onClick={enviarDoc} className="bg-teal/15 text-teal border border-teal/40 font-semibold rounded-lg px-5 py-2 text-sm hover:bg-teal/25 transition">
          Enviar para a base →
        </button>
      </section>

      <section className="border border-line bg-panel/50 rounded-xl p-4 space-y-2">
        <h2 className="font-display font-semibold">Histórico de versões</h2>
        {revisoes.length === 0 && <div className="text-sm text-dim">Nenhuma alteração registrada ainda.</div>}
        {revisoes.map(r => (
          <div key={r.id} className="flex items-center gap-3 text-sm border border-line/60 bg-panel/30 rounded-lg px-3 py-2">
            <span className="font-mono text-[10px] text-dim">{fmtHora(r.created_at)}</span>
            <span className="text-dim truncate">{r.changed_by ?? '—'}</span>
            {r.old_value && (
              <button onClick={() => restaurar(r)}
                className="ml-auto text-[11px] text-gold border border-gold/40 rounded-lg px-2.5 py-1 hover:bg-gold/10 transition">
                ↩ Restaurar esta versão
              </button>
            )}
          </div>
        ))}
      </section>
    </div>
  )
}
