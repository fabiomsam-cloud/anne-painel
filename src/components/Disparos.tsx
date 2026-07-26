import { useEffect, useState } from 'react'
import { supabase, AGENT_LABEL, fmtHora } from '../lib/supabase'

type Stats = {
  campaign_id: string; name: string; agent_slug: string; status: string
  scheduled_at: string | null; interval_min_s: number; interval_max_s: number; daily_cap: number
  created_at: string; archived_at: string | null
  total: number; pendentes: number; enviados: number; pulados: number; falhas: number; respostas: number
}
type Recipient = { id: string; name: string | null; phone: string; status: string; sent_at: string | null }
type Template = { name: string; body: string; buttons: string[]; category: string }

const TEMPLATES_URL = 'https://workflows.manager03.scvpgti.com.br/webhook/anne/meta/templates'

// datetime-local (hora do navegador) → ISO; e o inverso p/ preencher o input
const toIso = (local: string) => (local ? new Date(local).toISOString() : null)
const toLocal = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

const FORM_VAZIO = { name: '', agent_slug: '', csv: '', interval_min_s: 5, interval_max_s: 10, daily_cap: 1000 }

export default function Disparos() {
  const [stats, setStats] = useState<Stats[]>([])
  const [profiles, setProfiles] = useState<{ slug: string; name: string }[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [selTpl, setSelTpl] = useState<string[]>([])
  const [criando, setCriando] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [launch, setLaunch] = useState<'now' | 'schedule' | 'draft'>('draft')
  const [schedAt, setSchedAt] = useState('')
  const [detalhe, setDetalhe] = useState<string | null>(null)
  const [verArquivadas, setVerArquivadas] = useState(false)
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [form, setForm] = useState({ ...FORM_VAZIO })
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState('')

  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(''), 8000) }

  const carregar = async () => {
    const { data } = await supabase.from('vw_broadcast_stats').select('*').order('name')
    setStats((data as any) ?? [])
    const { data: p } = await supabase.from('agent_profiles').select('slug,name')
      .eq('active', true).order('slug')
    // roteador primeiro: disparo de triagem (a IA descobre o concurso na conversa)
    const lista = ((p as any) ?? []) as { slug: string; name: string }[]
    setProfiles([...lista.filter(x => x.slug === 'roteador'), ...lista.filter(x => x.slug !== 'roteador')])
  }
  useEffect(() => {
    carregar()
    fetch(TEMPLATES_URL).then(r => r.json())
      .then(d => setTemplates((d.templates ?? []).filter((t: Template) => t.category === 'MARKETING')))
      .catch(() => setTemplates([]))
    const t = setInterval(carregar, 20000)
    return () => clearInterval(t)
  }, [])

  const fecharForm = () => {
    setCriando(false); setEditId(null); setSelTpl([]); setLaunch('draft'); setSchedAt('')
    setForm({ ...FORM_VAZIO })
  }

  const abrirEdicao = async (id: string) => {
    const { data: camp } = await supabase.from('broadcast_campaigns')
      .select('name,agent_slug,message_variants,interval_min_s,interval_max_s,daily_cap,status,scheduled_at')
      .eq('id', id).single()
    if (!camp) return flash('Não consegui carregar a campanha.')
    // pagina de 1000 em 1000: o Supabase corta respostas em 1000 linhas e um
    // load parcial aqui já truncou uma campanha de 2.437 p/ 1.000 no save (24/07)
    const recs: any[] = []
    for (let ini = 0; ; ini += 1000) {
      const { data: pag } = await supabase.from('broadcast_recipients')
        .select('name,phone').eq('campaign_id', id).order('created_at')
        .range(ini, ini + 999)
      recs.push(...((pag as any) ?? []))
      if (!pag || pag.length < 1000) break
    }
    const variants = (camp.message_variants ?? []) as { name: string }[]
    setForm({
      name: camp.name, agent_slug: camp.agent_slug, interval_min_s: camp.interval_min_s,
      interval_max_s: camp.interval_max_s, daily_cap: camp.daily_cap,
      csv: ((recs as any) ?? []).map((r: any) => `${r.name ?? ''};${r.phone}`).join('\n'),
    })
    setSelTpl(variants.map(v => v.name))
    setLaunch(camp.status === 'scheduled' ? 'schedule' : 'draft')
    setSchedAt(toLocal(camp.scheduled_at))
    setEditId(id); setCriando(true); setDetalhe(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const salvar = async () => {
    const variants = templates.filter(t => selTpl.includes(t.name)).map(t => ({ name: t.name, body: t.body }))
    const linhas = form.csv.split('\n').map(l => l.trim()).filter(Boolean)
    if (!form.name || !form.agent_slug) return flash('Preencha nome e agente.')
    if (variants.length < 1) return flash('Selecione ao menos 1 template aprovado (ideal: 2-3, rotacionados).')
    if (!linhas.length) return flash('Cole a lista de leads (Nome;Telefone — um por linha).')
    if (launch === 'schedule' && !schedAt) return flash('Escolha data e hora do disparo programado.')
    setSalvando(true)

    // salva como draft e só muda p/ running/scheduled DEPOIS de inserir os leads:
    // o worker marca campanha running sem pendentes como 'done' — sem isso, uma
    // campanha "disparar agora" poderia ser concluída vazia antes dos inserts.
    const campos: any = {
      name: form.name, agent_slug: form.agent_slug, message_variants: variants,
      interval_min_s: form.interval_min_s, interval_max_s: form.interval_max_s,
      daily_cap: form.daily_cap, status: 'draft', scheduled_at: null,
    }

    let campId = editId
    if (editId) {
      const { error } = await supabase.from('broadcast_campaigns').update(campos).eq('id', editId)
      if (error) { setSalvando(false); return flash('Erro: ' + error.message) }
      // rascunho/programada: nada foi enviado ainda — recria a lista inteira
      await supabase.from('broadcast_recipients').delete().eq('campaign_id', editId)
    } else {
      const { data: u } = await supabase.auth.getUser()
      const { data: camp, error } = await supabase.from('broadcast_campaigns')
        .insert({ ...campos, created_by: u.user?.email ?? 'painel' }).select('id').single()
      if (error || !camp) { setSalvando(false); return flash('Erro: ' + error?.message) }
      campId = camp.id
    }

    let ok = 0, invalidos = 0
    const rows: any[] = []
    for (const ln of linhas) {
      const partes = ln.split(/[;,\t]/).map(s => s.trim())
      const [nome, fone] = partes.length >= 2 ? [partes[0], partes[1]] : ['', partes[0]]
      const digits = (fone || '').replace(/\D/g, '')
      if (digits.length < 10) { invalidos++; continue }
      rows.push({ campaign_id: campId, name: nome || null, phone: digits })
      ok++
    }
    // insere em lotes de 200; dedup por (campanha, phone_norm) via upsert-ignore
    let inseridos = 0
    for (let i = 0; i < rows.length; i += 200) {
      const { count } = await supabase.from('broadcast_recipients')
        .upsert(rows.slice(i, i + 200), { onConflict: 'campaign_id,phone_norm', ignoreDuplicates: true, count: 'exact' })
      inseridos += count ?? 0
    }
    if (launch === 'now') {
      await supabase.from('broadcast_campaigns')
        .update({ status: 'running', started_at: new Date().toISOString() }).eq('id', campId)
    } else if (launch === 'schedule') {
      await supabase.from('broadcast_campaigns')
        .update({ status: 'scheduled', scheduled_at: toIso(schedAt) }).eq('id', campId)
    }

    setSalvando(false)
    const resumo = `${inseridos} leads válidos (${invalidos} inválidos, ${ok - inseridos} duplicados)`
    flash(launch === 'now'
      ? `Campanha ${editId ? 'atualizada e' : ''} INICIADA: ${resumo}. Envios no ritmo configurado, janela 8h–21h.`
      : launch === 'schedule'
        ? `Campanha PROGRAMADA para ${fmtHora(toIso(schedAt))}: ${resumo}.`
        : `Campanha salva como RASCUNHO: ${resumo}. Revise e clique ▶ Iniciar.`)
    fecharForm()
    carregar()
  }

  const verDetalhe = async (id: string) => {
    setDetalhe(detalhe === id ? null : id)
    if (detalhe !== id) {
      const { data } = await supabase.from('broadcast_recipients')
        .select('id,name,phone,status,sent_at').eq('campaign_id', id)
        .order('created_at').limit(100)
      setRecipients((data as any) ?? [])
    }
  }

  const mudarStatus = async (id: string, novo: string) => {
    const extra: any = novo === 'running' ? { started_at: new Date().toISOString(), scheduled_at: null }
      : novo === 'draft' ? { scheduled_at: null } : {}
    await supabase.from('broadcast_campaigns').update({ status: novo, ...extra }).eq('id', id)
    flash(novo === 'running' ? 'Campanha INICIADA — envios no ritmo configurado, dentro da janela 8h–21h.'
      : novo === 'draft' ? 'Programação cancelada — campanha voltou a rascunho.' : 'Campanha pausada.')
    carregar()
  }

  const arquivar = async (id: string, on: boolean) => {
    await supabase.from('broadcast_campaigns')
      .update({ archived_at: on ? new Date().toISOString() : null }).eq('id', id)
    flash(on ? 'Campanha arquivada — os números continuam disponíveis em "Arquivadas".'
      : 'Campanha desarquivada — voltou para a lista principal.')
    carregar()
  }

  // o banco também bloqueia (trigger): só rascunho/cancelada e sem envios
  const excluir = async (s: Stats) => {
    if (!window.confirm(`Excluir o rascunho "${s.name}"${s.total ? ` e seus ${s.total} leads` : ''}? Essa ação não tem volta.`)) return
    const { error } = await supabase.from('broadcast_campaigns').delete().eq('id', s.campaign_id)
    if (error) return flash('Erro ao excluir: ' + error.message)
    if (detalhe === s.campaign_id) setDetalhe(null)
    flash(`Rascunho "${s.name}" excluído.`)
    carregar()
  }

  const inp = 'w-full bg-panel border border-line rounded-lg px-3 py-2 text-sm text-cream focus:outline-none focus:border-gold/60 placeholder:text-dim/40'
  const STATUS_CAMP: Record<string, string> = {
    draft: 'text-dim border-line', scheduled: 'text-teal border-teal/40 bg-teal/10',
    running: 'text-win border-win/40 bg-win/10',
    paused: 'text-gold border-gold/40 bg-gold/10', done: 'text-teal border-teal/40 bg-teal/10',
    cancelled: 'text-danger border-danger/40',
  }
  const LAUNCH_OPTS: { key: typeof launch; label: string; hint: string }[] = [
    { key: 'now', label: '🚀 Disparar agora', hint: 'começa assim que salvar' },
    { key: 'schedule', label: '🕐 Programar', hint: 'começa na data/hora escolhida' },
    { key: 'draft', label: '📝 Salvar rascunho', hint: 'você inicia depois' },
  ]

  // rascunhos e programadas no topo (pedem ação), depois ativas; concluídas por último
  const ORDEM_STATUS: Record<string, number> = { draft: 0, scheduled: 1, running: 2, paused: 3, done: 4, cancelled: 5 }
  const ativas = stats.filter(s => !s.archived_at).sort((a, b) =>
    (ORDEM_STATUS[a.status] ?? 9) - (ORDEM_STATUS[b.status] ?? 9)
    || (b.created_at ?? '').localeCompare(a.created_at ?? ''))
  const arquivadas = stats.filter(s => s.archived_at).sort((a, b) =>
    (b.archived_at ?? '').localeCompare(a.archived_at ?? ''))

  const cardCampanha = (s: Stats) => (
    <div key={s.campaign_id} className={`border border-line bg-panel/50 rounded-xl p-4 ${s.archived_at ? 'opacity-70' : ''}`}>
      <div className="flex items-center gap-3 flex-wrap">
        <span className={`text-[10px] px-2 py-0.5 rounded border uppercase font-mono ${STATUS_CAMP[s.status] ?? ''}`}>
          {s.status === 'scheduled' ? 'programada' : s.status}
        </span>
        <span className="font-semibold">{s.name}</span>
        <span className="text-[11px] px-1.5 py-0.5 rounded border border-line text-dim">{AGENT_LABEL[s.agent_slug] ?? s.agent_slug}</span>
        {s.status === 'scheduled' && s.scheduled_at && (
          <span className="text-[11px] font-mono text-teal">🕐 {fmtHora(s.scheduled_at)}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {(s.status === 'draft' || s.status === 'scheduled') && (
            <button onClick={() => abrirEdicao(s.campaign_id)}
              className="text-xs text-dim border border-line rounded-lg px-3 py-1.5 hover:text-cream transition">✎ Editar</button>
          )}
          {(s.status === 'draft' || s.status === 'paused') && (
            <button onClick={() => mudarStatus(s.campaign_id, 'running')}
              className="text-xs font-semibold bg-win/15 text-win border border-win/40 rounded-lg px-3 py-1.5 hover:bg-win/25 transition">▶ Iniciar</button>
          )}
          {s.status === 'scheduled' && (
            <button onClick={() => mudarStatus(s.campaign_id, 'draft')}
              className="text-xs font-semibold bg-gold/15 text-gold border border-gold/40 rounded-lg px-3 py-1.5 hover:bg-gold/25 transition">✕ Cancelar programação</button>
          )}
          {s.status === 'running' && (
            <button onClick={() => mudarStatus(s.campaign_id, 'paused')}
              className="text-xs font-semibold bg-gold/15 text-gold border border-gold/40 rounded-lg px-3 py-1.5 hover:bg-gold/25 transition">⏸ Pausar</button>
          )}
          {(s.status === 'done' || s.status === 'cancelled') && (s.archived_at ? (
            <button onClick={() => arquivar(s.campaign_id, false)}
              className="text-xs text-dim border border-line rounded-lg px-3 py-1.5 hover:text-cream transition">↩ Desarquivar</button>
          ) : (
            <button onClick={() => arquivar(s.campaign_id, true)}
              className="text-xs text-dim border border-line rounded-lg px-3 py-1.5 hover:text-cream transition">📦 Arquivar</button>
          ))}
          {s.status === 'draft' && (
            <button onClick={() => excluir(s)}
              className="text-xs text-danger border border-danger/40 rounded-lg px-3 py-1.5 hover:bg-danger/10 transition">🗑 Excluir</button>
          )}
          <button onClick={() => verDetalhe(s.campaign_id)}
            className="text-xs text-dim border border-line rounded-lg px-3 py-1.5 hover:text-cream transition">
            {detalhe === s.campaign_id ? 'Fechar' : 'Detalhes'}
          </button>
        </div>
      </div>
      <div className="flex gap-4 mt-3 font-mono text-[11px] text-dim flex-wrap">
        <span>total <b className="text-cream">{s.total}</b></span>
        <span>enviados <b className="text-cream">{s.enviados}</b></span>
        <span>pendentes <b className="text-cream">{s.pendentes}</b></span>
        <span>respostas <b className="text-win">{s.respostas}</b>
          {s.enviados > 0 && <span className="text-win"> ({Math.round((s.respostas / s.enviados) * 100)}%)</span>}</span>
        {s.pulados > 0 && <span>pulados <b>{s.pulados}</b></span>}
        {s.falhas > 0 && <span className="text-danger">falhas <b>{s.falhas}</b></span>}
      </div>
      {detalhe === s.campaign_id && (
        <div className="rise mt-3 border-t border-line pt-3 max-h-64 overflow-y-auto space-y-1">
          {recipients.map(r => (
            <div key={r.id} className="flex items-center gap-3 text-xs">
              <span className={`font-mono text-[10px] w-28 shrink-0 ${
                r.status === 'sent' ? 'text-win' : r.status === 'pending' ? 'text-dim'
                : r.status.startsWith('skipped') ? 'text-gold' : 'text-danger'}`}>{r.status}</span>
              <span className="truncate">{r.name || '—'}</span>
              <span className="font-mono text-dim">{r.phone}</span>
              <span className="ml-auto font-mono text-[10px] text-dim/60">{r.sent_at ? fmtHora(r.sent_at) : ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 max-w-4xl space-y-5">
      {msg && <div className="rise border border-win/40 bg-win/10 text-win text-sm rounded-xl px-4 py-3">{msg}</div>}

      <div className="flex items-center justify-between">
        <h1 className="font-display font-bold text-2xl">Disparo Oficial</h1>
        <button onClick={() => (criando ? fecharForm() : setCriando(true))}
          className="bg-gold text-ink font-semibold rounded-lg px-4 py-2 text-sm hover:brightness-110 transition">
          {criando ? 'Fechar' : '＋ Nova campanha'}
        </button>
      </div>

      <div className="border border-teal/30 bg-teal/5 rounded-xl p-4 text-xs text-dim leading-relaxed">
        ✅ <b className="text-teal">Disparo OFICIAL (Meta Cloud API)</b> — templates aprovados, sem risco de banimento.
        A Meta cobra por mensagem de marketing (~R$ 0,35–0,60). O lead que responder (ou tocar num botão) cai direto
        no agente da campanha — escolha <b className="text-cream">Triagem (roteador)</b> quando a lista for mista e a
        Anne deva descobrir o concurso na conversa. Boas práticas: 2–3 templates rotacionados, listas de leads que
        conhecem o Grupo SOU, e taxa de resposta baixa (&lt;10%) = pause e melhore o template — protege a qualidade
        (selo verde) do número.
      </div>

      {criando && (
        <div className="rise border border-line bg-panel/50 rounded-xl p-4 space-y-3">
          {editId && <div className="text-xs text-gold font-semibold">✎ Editando campanha — a lista de leads será substituída pela caixa abaixo.</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-xs text-dim">Nome da campanha
              <input className={inp + ' mt-1'} placeholder="TJ-AM · Lista pesquisa junho" value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="block text-xs text-dim">Agente que assume as conversas
              <select className={inp + ' mt-1'} value={form.agent_slug}
                onChange={e => setForm({ ...form, agent_slug: e.target.value })}>
                <option value="">Selecione…</option>
                {profiles.map(p => (
                  <option key={p.slug} value={p.slug}>
                    {p.slug === 'roteador' ? '🧭 Triagem (roteador) — descobre o concurso na conversa' : p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="block text-xs text-dim">
            Templates aprovados (selecione 2–3 — rotacionados automaticamente; {'{{1}}'} vira o nome do lead)
            <div className="mt-1 space-y-2 max-h-56 overflow-y-auto">
              {templates.length === 0 && <div className="text-dim/60 text-xs py-2">Carregando templates aprovados…</div>}
              {templates.map(t => (
                <label key={t.name} className={`flex gap-3 items-start border rounded-lg p-3 cursor-pointer transition
                  ${selTpl.includes(t.name) ? 'border-gold/50 bg-gold/5' : 'border-line bg-panel'}`}>
                  <input type="checkbox" className="accent-[#f5b942] mt-0.5" checked={selTpl.includes(t.name)}
                    onChange={e => setSelTpl(e.target.checked ? [...selTpl, t.name] : selTpl.filter(n => n !== t.name))} />
                  <div className="min-w-0">
                    <div className="font-mono text-[11px] text-gold">{t.name}</div>
                    <div className="text-[11px] text-dim leading-relaxed whitespace-pre-wrap">{t.body}</div>
                    {t.buttons.length > 0 && (
                      <div className="flex gap-1.5 mt-1.5 flex-wrap">
                        {t.buttons.map(b => <span key={b} className="text-[10px] px-2 py-0.5 rounded-full border border-teal/30 text-teal">{b}</span>)}
                      </div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>
          <label className="block text-xs text-dim">Leads — um por linha, formato Nome;Telefone (aceita vírgula/tab)
            <textarea rows={6} className={inp + ' mt-1 font-mono text-xs'} placeholder={'Maria Silva;5592988887777\nJoão Souza;5592977776666'}
              value={form.csv} onChange={e => setForm({ ...form, csv: e.target.value })} />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block text-xs text-dim">Intervalo mín. (s)
              <input type="number" className={inp + ' mt-1'} value={form.interval_min_s}
                onChange={e => setForm({ ...form, interval_min_s: +e.target.value })} />
            </label>
            <label className="block text-xs text-dim">Intervalo máx. (s)
              <input type="number" className={inp + ' mt-1'} value={form.interval_max_s}
                onChange={e => setForm({ ...form, interval_max_s: +e.target.value })} />
            </label>
            <label className="block text-xs text-dim">Teto diário
              <input type="number" className={inp + ' mt-1'} value={form.daily_cap}
                onChange={e => setForm({ ...form, daily_cap: +e.target.value })} />
            </label>
          </div>
          <p className="text-[11px] text-dim/70">Intervalo de 5s ≈ 12 envios/min ≈ 700/hora. O limite REAL é o tier diário da Meta (veja em WhatsApp Manager → seu número → "Limite de mensagens") e a qualidade do número: NUNCA configure o teto diário acima do seu tier. Espalhar uma lista grande ao longo do dia continua sendo bom para a qualidade — respostas chegam aos poucos e a IA atende com calma.</p>

          <div className="border-t border-line pt-3">
            <div className="text-xs text-dim mb-2">Quando disparar?</div>
            <div className="flex gap-2 flex-wrap">
              {LAUNCH_OPTS.map(o => (
                <button key={o.key} onClick={() => setLaunch(o.key)}
                  className={`text-xs rounded-lg px-3 py-2 border transition text-left
                    ${launch === o.key ? 'border-gold/60 bg-gold/10 text-cream' : 'border-line text-dim hover:text-cream'}`}>
                  <div className="font-semibold">{o.label}</div>
                  <div className="text-[10px] text-dim/70">{o.hint}</div>
                </button>
              ))}
              {launch === 'schedule' && (
                <input type="datetime-local" className={inp + ' !w-auto'} value={schedAt}
                  onChange={e => setSchedAt(e.target.value)} />
              )}
            </div>
            {launch === 'schedule' && (
              <p className="text-[11px] text-dim/70 mt-2">Horário de Manaus (o do seu computador). Se cair fora da janela 8h–21h, a campanha inicia mas os envios aguardam a janela abrir.</p>
            )}
          </div>

          <button onClick={salvar} disabled={salvando}
            className="bg-gold text-ink font-semibold rounded-lg px-6 py-2.5 text-sm hover:brightness-110 transition disabled:opacity-50">
            {salvando ? 'Salvando…'
              : launch === 'now' ? (editId ? 'Salvar e disparar agora' : 'Criar e disparar agora')
              : launch === 'schedule' ? (editId ? 'Salvar programação' : 'Criar campanha programada')
              : (editId ? 'Salvar rascunho' : 'Criar campanha (rascunho)')}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {ativas.map(cardCampanha)}
        {stats.length === 0 && <div className="text-center py-12 text-dim text-sm">Nenhuma campanha ainda.</div>}
        {stats.length > 0 && ativas.length === 0 && (
          <div className="text-center py-12 text-dim text-sm">Todas as campanhas estão arquivadas.</div>
        )}
      </div>

      {arquivadas.length > 0 && (
        <div className="space-y-2 pb-6">
          <button onClick={() => setVerArquivadas(!verArquivadas)}
            className="text-xs text-dim border border-line rounded-lg px-3 py-1.5 hover:text-cream transition">
            {verArquivadas ? '▾' : '▸'} 📦 Arquivadas ({arquivadas.length})
          </button>
          {verArquivadas && arquivadas.map(cardCampanha)}
        </div>
      )}
    </div>
  )
}
