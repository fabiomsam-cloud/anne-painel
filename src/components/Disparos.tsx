import { useEffect, useState } from 'react'
import { supabase, AGENT_LABEL, fmtHora } from '../lib/supabase'

type Stats = {
  campaign_id: string; name: string; agent_slug: string; status: string
  total: number; pendentes: number; enviados: number; pulados: number; falhas: number; respostas: number
}
type Recipient = { id: string; name: string | null; phone: string; status: string; sent_at: string | null }
type Template = { name: string; body: string; buttons: string[]; category: string }

const TEMPLATES_URL = 'https://workflows.manager03.scvpgti.com.br/webhook/anne/meta/templates'

export default function Disparos() {
  const [stats, setStats] = useState<Stats[]>([])
  const [profiles, setProfiles] = useState<{ slug: string; name: string }[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [selTpl, setSelTpl] = useState<string[]>([])
  const [criando, setCriando] = useState(false)
  const [detalhe, setDetalhe] = useState<string | null>(null)
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [form, setForm] = useState({ name: '', agent_slug: '', csv: '',
    interval_min_s: 60, interval_max_s: 180, daily_cap: 200 })
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState('')

  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(''), 8000) }

  const carregar = async () => {
    const { data } = await supabase.from('vw_broadcast_stats').select('*').order('name')
    setStats((data as any) ?? [])
    const { data: p } = await supabase.from('agent_profiles').select('slug,name')
      .eq('active', true).neq('slug', 'roteador').order('slug')
    setProfiles((p as any) ?? [])
  }
  useEffect(() => {
    carregar()
    fetch(TEMPLATES_URL).then(r => r.json())
      .then(d => setTemplates((d.templates ?? []).filter((t: Template) => t.category === 'MARKETING')))
      .catch(() => setTemplates([]))
    const t = setInterval(carregar, 20000)
    return () => clearInterval(t)
  }, [])

  const verDetalhe = async (id: string) => {
    setDetalhe(detalhe === id ? null : id)
    if (detalhe !== id) {
      const { data } = await supabase.from('broadcast_recipients')
        .select('id,name,phone,status,sent_at').eq('campaign_id', id)
        .order('created_at').limit(100)
      setRecipients((data as any) ?? [])
    }
  }

  const criar = async () => {
    const variants = templates.filter(t => selTpl.includes(t.name)).map(t => ({ name: t.name, body: t.body }))
    const linhas = form.csv.split('\n').map(l => l.trim()).filter(Boolean)
    if (!form.name || !form.agent_slug) return flash('Preencha nome e agente.')
    if (variants.length < 1) return flash('Selecione ao menos 1 template aprovado (ideal: 2-3, rotacionados).')
    if (!linhas.length) return flash('Cole a lista de leads (Nome;Telefone — um por linha).')
    setSalvando(true)
    const { data: u } = await supabase.auth.getUser()
    const { data: camp, error } = await supabase.from('broadcast_campaigns').insert({
      name: form.name, agent_slug: form.agent_slug, message_variants: variants,
      interval_min_s: form.interval_min_s, interval_max_s: form.interval_max_s,
      daily_cap: form.daily_cap, created_by: u.user?.email ?? 'painel',
    }).select('id').single()
    if (error || !camp) { setSalvando(false); return flash('Erro: ' + error?.message) }

    let ok = 0, invalidos = 0
    const rows: any[] = []
    for (const ln of linhas) {
      const partes = ln.split(/[;,\t]/).map(s => s.trim())
      const [nome, fone] = partes.length >= 2 ? [partes[0], partes[1]] : ['', partes[0]]
      const digits = (fone || '').replace(/\D/g, '')
      if (digits.length < 10) { invalidos++; continue }
      rows.push({ campaign_id: camp.id, name: nome || null, phone: digits })
      ok++
    }
    // insere em lotes de 200; dedup por (campanha, phone_norm) via upsert-ignore
    let inseridos = 0
    for (let i = 0; i < rows.length; i += 200) {
      const { count } = await supabase.from('broadcast_recipients')
        .upsert(rows.slice(i, i + 200), { onConflict: 'campaign_id,phone_norm', ignoreDuplicates: true, count: 'exact' })
      inseridos += count ?? 0
    }
    setSalvando(false); setCriando(false)
    setForm({ ...form, name: '', csv: '' })
    flash(`Campanha criada como RASCUNHO: ${inseridos} leads válidos (${invalidos} inválidos, ${ok - inseridos} duplicados). Revise e clique ▶ Iniciar.`)
    carregar()
  }

  const mudarStatus = async (id: string, novo: string) => {
    const extra: any = novo === 'running' ? { started_at: new Date().toISOString() } : {}
    await supabase.from('broadcast_campaigns').update({ status: novo, ...extra }).eq('id', id)
    flash(novo === 'running' ? 'Campanha INICIADA — envios no ritmo configurado, dentro da janela 8h–21h.' : 'Campanha pausada.')
    carregar()
  }

  const inp = 'w-full bg-panel border border-line rounded-lg px-3 py-2 text-sm text-cream focus:outline-none focus:border-gold/60 placeholder:text-dim/40'
  const STATUS_CAMP: Record<string, string> = {
    draft: 'text-dim border-line', running: 'text-win border-win/40 bg-win/10',
    paused: 'text-gold border-gold/40 bg-gold/10', done: 'text-teal border-teal/40 bg-teal/10',
    cancelled: 'text-danger border-danger/40',
  }

  return (
    <div className="h-full overflow-y-auto p-6 max-w-4xl space-y-5">
      {msg && <div className="rise border border-win/40 bg-win/10 text-win text-sm rounded-xl px-4 py-3">{msg}</div>}

      <div className="flex items-center justify-between">
        <h1 className="font-display font-bold text-2xl">Disparo Não Oficial</h1>
        <button onClick={() => setCriando(!criando)}
          className="bg-gold text-ink font-semibold rounded-lg px-4 py-2 text-sm hover:brightness-110 transition">
          {criando ? 'Fechar' : '＋ Nova campanha'}
        </button>
      </div>

      <div className="border border-teal/30 bg-teal/5 rounded-xl p-4 text-xs text-dim leading-relaxed">
        ✅ <b className="text-teal">Disparo OFICIAL (Meta Cloud API)</b> — templates aprovados, sem risco de banimento.
        A Meta cobra por mensagem de marketing (~R$ 0,35–0,60). O lead que responder (ou tocar num botão) cai direto
        no agente da campanha. Boas práticas: 2–3 templates rotacionados, listas de leads que conhecem o Grupo SOU,
        e taxa de resposta baixa (&lt;10%) = pause e melhore o template — protege a qualidade (selo verde) do número.
      </div>

      {criando && (
        <div className="rise border border-line bg-panel/50 rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-dim">Nome da campanha
              <input className={inp + ' mt-1'} placeholder="TJ-AM · Lista pesquisa junho" value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="block text-xs text-dim">Agente que assume as conversas
              <select className={inp + ' mt-1'} value={form.agent_slug}
                onChange={e => setForm({ ...form, agent_slug: e.target.value })}>
                <option value="">Selecione…</option>
                {profiles.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
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
          <div className="grid grid-cols-3 gap-3">
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
          <p className="text-[11px] text-dim/70">Na API oficial o ritmo pode ser maior (padrão: 60–180s, 200/dia). O limite real é o tier da Meta (começa em 250 conversas/dia e sobe com o uso saudável) e a qualidade do número.</p>
          <button onClick={criar} disabled={salvando}
            className="bg-gold text-ink font-semibold rounded-lg px-6 py-2.5 text-sm hover:brightness-110 transition disabled:opacity-50">
            {salvando ? 'Criando…' : 'Criar campanha (rascunho)'}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {stats.map(s => (
          <div key={s.campaign_id} className="border border-line bg-panel/50 rounded-xl p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`text-[10px] px-2 py-0.5 rounded border uppercase font-mono ${STATUS_CAMP[s.status] ?? ''}`}>{s.status}</span>
              <span className="font-semibold">{s.name}</span>
              <span className="text-[11px] px-1.5 py-0.5 rounded border border-line text-dim">{AGENT_LABEL[s.agent_slug] ?? s.agent_slug}</span>
              <div className="ml-auto flex items-center gap-2">
                {(s.status === 'draft' || s.status === 'paused') && (
                  <button onClick={() => mudarStatus(s.campaign_id, 'running')}
                    className="text-xs font-semibold bg-win/15 text-win border border-win/40 rounded-lg px-3 py-1.5 hover:bg-win/25 transition">▶ Iniciar</button>
                )}
                {s.status === 'running' && (
                  <button onClick={() => mudarStatus(s.campaign_id, 'paused')}
                    className="text-xs font-semibold bg-gold/15 text-gold border border-gold/40 rounded-lg px-3 py-1.5 hover:bg-gold/25 transition">⏸ Pausar</button>
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
        ))}
        {stats.length === 0 && <div className="text-center py-12 text-dim text-sm">Nenhuma campanha ainda.</div>}
      </div>
    </div>
  )
}
