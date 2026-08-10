import { useEffect, useMemo, useState } from 'react'
import { supabase, AGENT_LABEL, fmtFone, fmtHora } from '../lib/supabase'

// ============================================================
// Comercial Humano — vendedores por telefone assumem leads que a
// IA não converteu. Distribuição/expiração/matrícula são do motor
// n8n (ANNE · Comercial Humano); aqui é o pipeline + gestão.
// A ligação acontece FORA do painel (plataforma de telefonia) —
// o card entrega o dossiê do lead e registra cada tentativa.
// ============================================================

type Vendedor = { id: string; nome: string; email: string; telefone: string | null; tipo: string; ativo: boolean }
type Corte = { id: string; inicio: string; fim: string; teto_padrao: number; overrides: Record<string, number>; status: string }
type Assignment = {
  id: string; corte_id: string; vendedor_id: string; contact_id: string; conversation_id: string | null
  estrato: string; status: string; motivo_perda: string | null; venda_valor: number | null
  assigned_at: string; expires_at: string; closed_at: string | null
  contacts: { name: string | null; phone: string; source_first: any } | null
  conversations: { current_agent_slug: string } | null
}
type Atividade = { id: string; assignment_id: string; tipo: string; nota: string | null; agendada_para: string | null; created_at: string }
type DadosLead = { a: Assignment; ct: { name: string | null; phone: string; tags: string[]; client_memory: any; source_first: any } }

const MOTIVOS = ['sem_interesse', 'sem_dinheiro_agora', 'preco', 'vai_pensar', 'concorrente', 'sem_contato', 'telefone_invalido', 'outro']
const OBJECOES = ['preço', 'sem tempo p/ estudar', 'vai pensar', 'cônjuge/família', 'concorrente', 'medo de não passar', 'espera o edital']
const ATIV_LABEL: Record<string, string> = {
  ligacao_atendida: '📞 Atendida', ligacao_nao_atendida: '📵 Não atendeu',
  ligacao_agendada: '🗓 Agendada', whatsapp: '💬 WhatsApp', nota: '📝 Nota',
}
const ESTRATO_CLS: Record<string, string> = {
  A: 'border-gold/60 text-gold bg-gold/10', B: 'border-teal/50 text-teal bg-teal/10', C: 'border-line text-dim',
}
const FASE_LABEL = ['1 · Situação', '2 · Problema', '3 · Valor', '4 · Oferta']

// espelho SIMPLIFICADO do canal_map do Data Core — só para exibição
function canalDoLead(sf: any): string {
  const s = String(sf?.utm_source ?? '').toLowerCase().replace(/\+/g, ' ')
  const o = String(sf?.origem ?? '').toLowerCase()
  if (s) {
    if (/lead.?ads/.test(s) || /^(instagram|facebook|threads|messenger)_/.test(s) || s === 'facebook' || /^\[p[a-z]\]/.test(s)) return 'meta_ads'
    if (/youtube/.test(s)) return /ads/.test(s) ? 'youtube_ads' : 'youtube_org'
    if (/bio|beacons|manychat|^instagram$|^ig$/.test(s)) return 'insta_org'
    if (/whatsapp/.test(s)) return 'whatsapp'
    if (/^site|banner/.test(s)) return 'site'
    return s.slice(0, 12)
  }
  if (/^hubla/.test(o)) return 'comprou_low'
  if (/^quiz/.test(o)) return 'quiz'
  if (o === 'anne_whatsapp') return 'wpp_direto'
  if (o && o !== 'nao_encontrado') return o.slice(0, 12)
  return '—'
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

function diasRestantes(expiresAt: string) {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000))
}

export default function Comercial({ irParaInbox, isAdmin = true, meuVendedorId = null, meuTipo = null }:
  { irParaInbox: (convId: string) => void; isAdmin?: boolean; meuVendedorId?: string | null; meuTipo?: string | null }) {
  const [subTab, setSubTab] = useState<'pipeline' | 'gestao'>('pipeline')
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [meuEmail, setMeuEmail] = useState('')
  const [vendSel, setVendSel] = useState('')
  const [cards, setCards] = useState<Assignment[]>([])
  const [ativs, setAtivs] = useState<Record<string, Atividade[]>>({})
  const [devolvendo, setDevolvendo] = useState<Assignment | null>(null)
  const [motivo, setMotivo] = useState('')
  const [notaDev, setNotaDev] = useState('')
  const [agendando, setAgendando] = useState<Assignment | null>(null)
  const [dtAgenda, setDtAgenda] = useState('')
  const [dados, setDados] = useState<DadosLead | null>(null)
  const [notaNova, setNotaNova] = useState('')
  const [trocaSenha, setTrocaSenha] = useState(false)
  const [senha, setSenha] = useState({ a: '', b: '' })
  const [msg, setMsg] = useState('')
  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(''), 6000) }

  const salvarSenha = async () => {
    if (senha.a.length < 8) return flash('A senha precisa ter pelo menos 8 caracteres.')
    if (senha.a !== senha.b) return flash('As senhas não conferem.')
    const { error } = await supabase.auth.updateUser({ password: senha.a })
    if (error) return flash('Erro ao salvar a senha: ' + error.message)
    setTrocaSenha(false); setSenha({ a: '', b: '' })
    flash('✅ Senha salva — no próximo login use e-mail + senha.')
  }

  const carregarVendedores = async () => {
    const { data } = await supabase.from('vendedores').select('*').order('nome')
    setVendedores((data as any) ?? [])
    const { data: u } = await supabase.auth.getUser()
    const email = u.user?.email ?? ''
    setMeuEmail(email)
    // vendedor fica TRAVADO no próprio pipeline; admin navega por todos
    if (!isAdmin && meuVendedorId) setVendSel(meuVendedorId)
    else {
      const eu = ((data as any) ?? []).find((v: Vendedor) => v.email === email)
      setVendSel(sel => sel || eu?.id || ((data as any) ?? [])[0]?.id || '')
    }
  }
  useEffect(() => { carregarVendedores() }, [])

  const carregarCards = async () => {
    if (!vendSel) { setCards([]); return }
    // ativos + fechados dos últimos 45 dias (histórico recente do vendedor)
    const { data } = await supabase.from('lead_assignments')
      .select('*,contacts(name,phone,source_first),conversations(current_agent_slug)')
      .eq('vendedor_id', vendSel)
      .or(`status.eq.ativo,closed_at.gte.${new Date(Date.now() - 45 * 86400000).toISOString()}`)
      .order('assigned_at', { ascending: false }).limit(400)
    const cs = (data as any) ?? []
    setCards(cs)
    const ids = cs.map((c: Assignment) => c.id)
    if (ids.length) {
      const { data: at } = await supabase.from('atividades_comercial')
        .select('id,assignment_id,tipo,nota,agendada_para,created_at')
        .in('assignment_id', ids).order('created_at', { ascending: false }).limit(1000)
      const map: Record<string, Atividade[]> = {}
      for (const a of ((at as any) ?? [])) (map[a.assignment_id] ??= []).push(a)
      setAtivs(map)
    } else setAtivs({})
  }
  useEffect(() => { carregarCards() }, [vendSel])
  useEffect(() => {
    const ch = supabase.channel('comercial-cards')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lead_assignments' }, carregarCards)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [vendSel])

  // cada clique REGISTRA uma nova atividade — o histórico acumula, nada substitui
  const registrar = async (a: Assignment, tipo: string, nota = '', agendadaPara: string | null = null) => {
    await supabase.from('atividades_comercial').insert({
      assignment_id: a.id, vendedor_id: a.vendedor_id, tipo,
      nota: nota || null, agendada_para: agendadaPara,
    })
    carregarCards()
  }

  const salvarAgenda = async () => {
    if (!agendando || !dtAgenda) return
    await registrar(agendando, 'ligacao_agendada', '', new Date(dtAgenda).toISOString())
    setAgendando(null); setDtAgenda('')
    flash('🗓 Ligação agendada — está na sua régua no topo da tela.')
  }

  const devolver = async () => {
    if (!devolvendo || !motivo) return
    await supabase.from('lead_assignments').update({
      status: 'devolvido', motivo_perda: motivo + (notaDev.trim() ? ` — ${notaDev.trim()}` : ''),
      closed_at: new Date().toISOString(),
    }).eq('id', devolvendo.id)
    if (devolvendo.conversation_id) {
      await supabase.from('conversations').update({ status: 'dormant' })
        .eq('id', devolvendo.conversation_id).eq('status', 'humano_comercial')
    }
    setDevolvendo(null); setMotivo(''); setNotaDev('')
    flash('Lead devolvido para a base — motivo registrado.')
    carregarCards()
  }

  const abrirDados = async (a: Assignment) => {
    const { data } = await supabase.from('contacts')
      .select('name,phone,tags,client_memory,source_first')
      .eq('id', a.contact_id).single()
    if (data) setDados({ a, ct: data as any })
  }

  const contar = (a: Assignment, tipo: string) => (ativs[a.id] ?? []).filter(x => x.tipo === tipo).length
  const proxAgendada = (a: Assignment): Atividade | null =>
    (ativs[a.id] ?? [])
      .filter(x => x.tipo === 'ligacao_agendada' && x.agendada_para && new Date(x.agendada_para).getTime() > Date.now() - 3600000)
      .sort((x, y) => String(x.agendada_para).localeCompare(String(y.agendada_para)))[0] ?? null

  // colunas do pipeline: agendamento futuro vence; qualquer atividade = em cadência
  const colunaDoCard = (a: Assignment): string => {
    if (a.status === 'matriculado') return 'matriculado'
    if (a.status === 'devolvido' || a.status === 'expirado') return 'perdido'
    if (proxAgendada(a)) return 'agendado'
    return (ativs[a.id] ?? []).length ? 'cadencia' : 'recebido'
  }
  const COLS = [
    { id: 'recebido', label: 'Recebidos', hint: 'ainda sem tentativa — ligue hoje', cor: 'border-t-danger' },
    { id: 'cadencia', label: 'Em cadência', hint: 'trabalhando o lead', cor: 'border-t-teal' },
    { id: 'agendado', label: 'Ligação agendada', hint: 'compromisso marcado', cor: 'border-t-gold' },
    { id: 'matriculado', label: 'Matriculados 🏆', hint: 'venda confirmada', cor: 'border-t-win' },
    { id: 'perdido', label: 'Devolvidos', hint: 'com motivo registrado', cor: 'border-t-line' },
  ]
  const porColuna = useMemo(() => {
    const m: Record<string, Assignment[]> = {}
    for (const c of COLS) m[c.id] = []
    for (const a of cards) m[colunaDoCard(a)]?.push(a)
    return m
  }, [cards, ativs])

  // régua do vendedor: TODAS as ligações agendadas pendentes (atrasada = vermelha)
  const agenda = useMemo(() => {
    const out: { at: Atividade; a: Assignment }[] = []
    for (const a of cards) {
      if (a.status !== 'ativo') continue
      for (const at of (ativs[a.id] ?? [])) {
        if (at.tipo === 'ligacao_agendada' && at.agendada_para &&
            new Date(at.agendada_para).getTime() > Date.now() - 86400000) out.push({ at, a })
      }
    }
    return out.sort((x, y) => String(x.at.agendada_para).localeCompare(String(y.at.agendada_para)))
  }, [cards, ativs])

  const mem = dados?.ct?.client_memory ?? {}
  const notasVendedor = dados ? (ativs[dados.a.id] ?? []).filter(x => x.tipo === 'nota' && x.nota) : []
  const inp = 'bg-panel border border-line rounded-lg px-3 py-2 text-sm text-cream focus:outline-none focus:border-gold/60 placeholder:text-dim/40'

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 md:px-6 pt-4 pb-3 border-b border-line flex items-center gap-3 flex-wrap">
        <h1 className="font-display font-bold text-xl">☎️ Comercial Humano</h1>
        <div className="flex gap-1 ml-auto">
          {([['pipeline', '📋 Pipeline'], ['gestao', '📊 Gestão']] as const)
            .filter(([id]) => isAdmin || id !== 'gestao')
            .map(([id, lbl]) => (
            <button key={id} onClick={() => setSubTab(id)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition
                ${subTab === id ? 'border-gold/60 bg-gold/10 text-cream' : 'border-line text-dim hover:text-cream'}`}>
              {lbl}
            </button>
          ))}
        </div>
      </div>
      {msg && <div className="rise mx-4 mt-3 border border-win/40 bg-win/10 text-win text-sm rounded-xl px-4 py-2.5">{msg}</div>}

      {subTab === 'pipeline' ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="px-4 md:px-6 py-3 flex items-center gap-3 flex-wrap">
            {isAdmin ? (
              <select value={vendSel} onChange={e => setVendSel(e.target.value)} className={inp + ' min-w-52'}>
                {vendedores.filter(v => v.tipo === 'closer').map(v => (
                  <option key={v.id} value={v.id}>{v.nome}{v.email === meuEmail ? ' (você)' : ''}</option>
                ))}
              </select>
            ) : (
              <span className="text-sm font-medium border border-gold/40 bg-gold/10 text-gold rounded-lg px-3 py-2">
                {vendedores.find(v => v.id === meuVendedorId)?.nome ?? 'Meu pipeline'}
              </span>
            )}
            <span className="text-[11px] text-dim">
              {porColuna.recebido.length + porColuna.cadencia.length + porColuna.agendado.length} em posse ·
              abra 📇 Dados do lead antes de ligar · registre CADA tentativa
            </span>
            {!isAdmin && (
              <button onClick={() => setTrocaSenha(true)} title="Definir minha senha de acesso"
                className="ml-auto text-[11px] text-dim border border-line rounded-lg px-2.5 py-1.5 hover:text-cream transition">🔑 senha</button>
            )}
          </div>

          {!isAdmin && meuTipo === 'escalacao' && (
            <div className="mx-4 md:mx-6 mb-2 text-[11px] text-dim border border-teal/25 bg-teal/5 rounded-xl px-3 py-2">
              Seu perfil é <b className="text-teal">escalação</b>: seu trabalho vive nas abas 🚨 Escalações e 💬 Inbox
              (atender e devolver para a IA). A roleta de leads é só para vendedores closer.
            </div>
          )}

          {/* régua de ligações agendadas — o vendedor não pode esquecer */}
          {agenda.length > 0 && (
            <div className="mx-4 md:mx-6 mb-2 border border-gold/30 bg-gold/5 rounded-xl px-3 py-2">
              <div className="text-[10px] font-mono text-gold uppercase tracking-widest mb-1.5">🗓 Suas ligações agendadas</div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {agenda.map(({ at, a }) => {
                  const atrasada = new Date(at.agendada_para!).getTime() < Date.now()
                  return (
                    <button key={at.id} onClick={() => abrirDados(a)}
                      className={`shrink-0 text-left text-xs border rounded-lg px-2.5 py-1.5 transition hover:brightness-110
                        ${atrasada ? 'border-danger/50 bg-danger/10 text-danger' : 'border-line bg-panel text-cream'}`}>
                      <div className="font-mono text-[10px]">{atrasada ? '⚠️ atrasada · ' : ''}{fmtHora(at.agendada_para)}</div>
                      <div className="font-medium">{a.contacts?.name || fmtFone(a.contacts?.phone)}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {!vendedores.filter(v => v.tipo === 'closer').length ? (
            <div className="flex-1 grid place-items-center text-dim text-sm p-8 text-center">
              Nenhum vendedor closer cadastrado ainda.<br />Cadastre na aba 📊 Gestão — e crie o primeiro corte semanal para a roleta distribuir.
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-x-auto px-4 md:px-6 pb-4">
              <div className="h-full flex gap-3 min-w-max">
                {COLS.map(col => (
                  <div key={col.id} className={`w-72 shrink-0 flex flex-col bg-panel/40 border border-line rounded-xl border-t-2 ${col.cor}`}>
                    <div className="px-3 py-2.5 border-b border-line/60">
                      <div className="text-sm font-semibold flex items-center gap-2">
                        {col.label}
                        <span className="text-[10px] font-mono text-dim">{porColuna[col.id].length}</span>
                      </div>
                      <div className="text-[10px] text-dim mt-0.5">{col.hint}</div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-2">
                      {porColuna[col.id].map(a => {
                        const ult = (ativs[a.id] ?? [])[0]
                        const dias = diasRestantes(a.expires_at)
                        const nAt = contar(a, 'ligacao_atendida'), nNao = contar(a, 'ligacao_nao_atendida')
                        const agendaCard = proxAgendada(a)
                        return (
                          <div key={a.id} className="bg-panel border border-line rounded-xl p-3 space-y-2">
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${ESTRATO_CLS[a.estrato]}`}>{a.estrato}</span>
                              <span className="text-sm font-medium truncate">{a.contacts?.name || fmtFone(a.contacts?.phone)}</span>
                              {a.status === 'ativo' && (
                                <span className={`ml-auto text-[10px] font-mono ${dias <= 3 ? 'text-danger' : 'text-dim'}`}
                                  title="Dias restantes de posse (14 no total)">⏳{dias}d</span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px] text-dim font-mono flex-wrap">
                              <span>{fmtFone(a.contacts?.phone)}</span>
                              <span className="px-1.5 py-0.5 rounded border border-line">{canalDoLead(a.contacts?.source_first)}</span>
                            </div>
                            {/* contadores de tentativas — o histórico acumula, nada substitui */}
                            {(nAt > 0 || nNao > 0) && (
                              <div className="flex gap-1.5 text-[10px] font-mono">
                                {nNao > 0 && <span className="px-1.5 py-0.5 rounded border border-danger/30 text-danger/90 bg-danger/5">📵 ×{nNao}</span>}
                                {nAt > 0 && <span className="px-1.5 py-0.5 rounded border border-win/40 text-win bg-win/5">📞 ×{nAt}</span>}
                              </div>
                            )}
                            {agendaCard && (
                              <div className="text-[11px] text-gold">🗓 Ligação marcada · {fmtHora(agendaCard.agendada_para)}</div>
                            )}
                            {ult && !agendaCard && (
                              <div className="text-[10px] text-dim">{ATIV_LABEL[ult.tipo]} · {fmtHora(ult.created_at)}{ult.nota ? ` — ${ult.nota}` : ''}</div>
                            )}
                            {a.status === 'matriculado' && (
                              <div className="text-[11px] text-win">🏆 Matriculado · {a.venda_valor ? `R$ ${Number(a.venda_valor).toLocaleString('pt-BR')}` : ''} · {fmtHora(a.closed_at)}</div>
                            )}
                            {(a.status === 'devolvido' || a.status === 'expirado') && (
                              <div className="text-[10px] text-dim">↩ {a.motivo_perda ?? a.status} · {fmtHora(a.closed_at)}</div>
                            )}
                            {a.status === 'ativo' && (
                              <>
                                <div className="flex gap-1.5">
                                  <button onClick={() => abrirDados(a)}
                                    className="flex-1 text-xs font-semibold bg-gold/15 text-gold border border-gold/40 rounded-lg py-1.5 hover:bg-gold/25 transition">📇 Dados do lead</button>
                                  {a.conversation_id && (
                                    <button onClick={() => irParaInbox(a.conversation_id!)}
                                      className="flex-1 text-xs font-semibold bg-teal/10 text-teal border border-teal/40 rounded-lg py-1.5 hover:bg-teal/20 transition">💬 Inbox</button>
                                  )}
                                </div>
                                <div className="flex gap-1 flex-wrap">
                                  <button onClick={() => registrar(a, 'ligacao_atendida')}
                                    className="text-[10px] border border-line text-dim rounded-lg px-2 py-1 hover:text-win hover:border-win/40 transition">
                                    📞 Atendida{nAt > 0 ? ` ×${nAt}` : ''}
                                  </button>
                                  <button onClick={() => registrar(a, 'ligacao_nao_atendida')}
                                    className="text-[10px] border border-line text-dim rounded-lg px-2 py-1 hover:text-danger hover:border-danger/40 transition">
                                    📵 Não atendeu{nNao > 0 ? ` ×${nNao}` : ''}
                                  </button>
                                  <button onClick={() => { setAgendando(a); setDtAgenda('') }}
                                    className="text-[10px] border border-line text-dim rounded-lg px-2 py-1 hover:text-gold hover:border-gold/40 transition">🗓 Agendar</button>
                                  <button onClick={() => setDevolvendo(a)}
                                    className="text-[10px] border border-danger/30 text-danger/80 rounded-lg px-2 py-1 hover:bg-danger/10 transition">↩ Devolver</button>
                                </div>
                              </>
                            )}
                          </div>
                        )
                      })}
                      {porColuna[col.id].length === 0 && (
                        <div className="text-center text-[11px] text-dim/60 py-6">vazio</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <Gestao vendedores={vendedores} recarregarVendedores={carregarVendedores} flash={flash} />
      )}

      {/* Gaveta: 📇 Dados do lead — dossiê da Anne + notas do vendedor */}
      {dados && (
        <>
          <div className="fixed inset-0 z-40 bg-ink/60" onClick={() => setDados(null)} />
          <div className="fixed inset-y-0 right-0 z-50 w-[26rem] max-w-[94vw] bg-panel border-l border-line shadow-2xl overflow-y-auto p-5 space-y-4">
            <div className="flex items-center">
              <h2 className="font-display font-semibold">📇 Dados do lead</h2>
              <button onClick={() => setDados(null)} className="ml-auto text-dim hover:text-cream text-xl leading-none">✕</button>
            </div>

            <div>
              <div className="font-display font-semibold text-lg">{dados.ct.name || '—'}</div>
              <div className="font-mono text-xs text-dim mt-0.5">{fmtFone(dados.ct.phone)}</div>
              <div className="flex gap-1.5 mt-2 flex-wrap">
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${ESTRATO_CLS[dados.a.estrato]}`}>estrato {dados.a.estrato}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-line text-dim">{canalDoLead(dados.ct.source_first)}</span>
                {dados.a.conversations?.current_agent_slug && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-teal/30 text-teal">
                    {AGENT_LABEL[dados.a.conversations.current_agent_slug] ?? dados.a.conversations.current_agent_slug}
                  </span>
                )}
              </div>
            </div>

            {/* resumo de bater o olho — o que a Anne coletou */}
            <div className="border border-teal/25 bg-teal/5 rounded-xl p-3 space-y-2">
              <div className="text-[10px] font-mono text-teal uppercase tracking-widest">🤖 O que a Anne descobriu</div>
              {(dados.ct.tags ?? []).includes('checkout_enviado') && (
                <div className="text-xs text-gold">🛒 Já recebeu o link de matrícula e NÃO pagou — retome daí.</div>
              )}
              {mem.fase_venda && (
                <div className="text-xs"><span className="text-dim">Fase da venda: </span>
                  <b>{FASE_LABEL[mem.fase_venda - 1] ?? mem.fase_venda}</b></div>
              )}
              {mem.lead_stage && <div className="text-xs"><span className="text-dim">Estágio: </span><b className="text-gold">{mem.lead_stage}</b></div>}
              {(mem.interesses?.length ?? 0) > 0 && (
                <div className="text-xs"><span className="text-dim">Interesses: </span>{mem.interesses.join(', ')}</div>
              )}
              {(mem.objections?.length ?? 0) > 0 && (
                <div className="text-xs"><span className="text-dim">Objeções que a IA encontrou: </span><b className="text-danger/90">{mem.objections.join(', ')}</b></div>
              )}
              {mem.notas && <div className="text-xs leading-relaxed"><span className="text-dim">Notas da Anne: </span>{mem.notas}</div>}
              {!mem.fase_venda && !mem.lead_stage && !mem.notas && !(mem.interesses?.length) && (
                <div className="text-xs text-dim">A IA ainda não estruturou dados deste lead — leia a conversa no 💬 Inbox.</div>
              )}
              {dados.a.conversation_id && (
                <button onClick={() => { irParaInbox(dados.a.conversation_id!); setDados(null) }}
                  className="w-full text-xs font-semibold bg-teal/10 text-teal border border-teal/40 rounded-lg py-1.5 hover:bg-teal/20 transition">
                  💬 Ler a conversa completa no Inbox
                </button>
              )}
            </div>

            {/* objeção em 1 clique */}
            <div>
              <div className="text-[10px] font-mono text-dim uppercase tracking-widest mb-1.5">Objeção que você ouviu (1 clique)</div>
              <div className="flex flex-wrap gap-1.5">
                {OBJECOES.map(o => (
                  <button key={o} onClick={() => { registrar(dados.a, 'nota', `objeção: ${o}`); flash('Objeção registrada.') }}
                    className="text-[11px] px-2 py-1 rounded-lg border border-line text-dim hover:text-danger hover:border-danger/40 transition">
                    {o}
                  </button>
                ))}
              </div>
            </div>

            {/* notas do vendedor */}
            <div className="space-y-2">
              <div className="text-[10px] font-mono text-dim uppercase tracking-widest">Suas anotações</div>
              <div className="flex gap-2">
                <input className={inp + ' flex-1'} placeholder="Ex.: prefere ligação depois das 18h"
                  value={notaNova} onChange={e => setNotaNova(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && notaNova.trim()) { registrar(dados.a, 'nota', notaNova.trim()); setNotaNova('') } }} />
                <button onClick={() => { if (notaNova.trim()) { registrar(dados.a, 'nota', notaNova.trim()); setNotaNova('') } }}
                  className="bg-gold text-ink font-semibold rounded-lg px-3 text-sm hover:brightness-110 transition">＋</button>
              </div>
              <div className="space-y-1.5">
                {notasVendedor.map(n => (
                  <div key={n.id} className="text-xs border border-line rounded-lg px-2.5 py-1.5">
                    <span className="text-dim font-mono text-[10px] mr-2">{fmtHora(n.created_at)}</span>{n.nota}
                  </div>
                ))}
                {!notasVendedor.length && <div className="text-[11px] text-dim/60">Nenhuma anotação sua ainda.</div>}
              </div>
            </div>

            {/* histórico completo de tentativas */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-mono text-dim uppercase tracking-widest">Histórico de tentativas</div>
              {(ativs[dados.a.id] ?? []).filter(x => x.tipo !== 'nota').map(x => (
                <div key={x.id} className="text-[11px] text-dim flex gap-2">
                  <span className="font-mono text-[10px]">{fmtHora(x.created_at)}</span>
                  <span>{ATIV_LABEL[x.tipo]}{x.agendada_para ? ` → ${fmtHora(x.agendada_para)}` : ''}</span>
                </div>
              ))}
              {!(ativs[dados.a.id] ?? []).filter(x => x.tipo !== 'nota').length && (
                <div className="text-[11px] text-dim/60">Nenhuma tentativa registrada.</div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Modal: minha senha (vendedor não tem acesso à aba Equipe) */}
      {trocaSenha && (
        <>
          <div className="fixed inset-0 z-40 bg-ink/60" onClick={() => setTrocaSenha(false)} />
          <div className="fixed z-50 inset-x-4 top-24 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[22rem] bg-panel border border-line rounded-2xl shadow-2xl p-5 space-y-3">
            <h2 className="font-display font-semibold">🔑 Minha senha</h2>
            <p className="text-[11px] text-dim">Vale junto com o link mágico — no próximo login entre com e-mail + senha.</p>
            <input type="password" className={inp + ' w-full'} placeholder="Nova senha (mín. 8)" value={senha.a}
              onChange={e => setSenha({ ...senha, a: e.target.value })} autoComplete="new-password" />
            <input type="password" className={inp + ' w-full'} placeholder="Repetir a nova senha" value={senha.b}
              onChange={e => setSenha({ ...senha, b: e.target.value })} autoComplete="new-password"
              onKeyDown={e => e.key === 'Enter' && salvarSenha()} />
            <div className="flex gap-2">
              <button onClick={() => setTrocaSenha(false)} className="flex-1 text-sm border border-line text-dim rounded-lg py-2 hover:text-cream transition">Cancelar</button>
              <button onClick={salvarSenha} disabled={!senha.a || !senha.b}
                className="flex-1 text-sm font-semibold bg-gold text-ink rounded-lg py-2 disabled:opacity-40 hover:brightness-110 transition">Salvar senha</button>
            </div>
          </div>
        </>
      )}

      {/* Modal: agendar ligação (data + hora) */}
      {agendando && (
        <>
          <div className="fixed inset-0 z-40 bg-ink/60" onClick={() => setAgendando(null)} />
          <div className="fixed z-50 inset-x-4 top-24 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[22rem] bg-panel border border-line rounded-2xl shadow-2xl p-5 space-y-3">
            <h2 className="font-display font-semibold">🗓 Agendar ligação</h2>
            <p className="text-[11px] text-dim">
              {agendando.contacts?.name || fmtFone(agendando.contacts?.phone)} — o compromisso entra na sua régua no topo da tela.
            </p>
            <input type="datetime-local" className={inp + ' w-full'} value={dtAgenda}
              min={new Date(Date.now() + 5 * 60000).toISOString().slice(0, 16)}
              onChange={e => setDtAgenda(e.target.value)} />
            <div className="flex gap-2">
              <button onClick={() => setAgendando(null)} className="flex-1 text-sm border border-line text-dim rounded-lg py-2 hover:text-cream transition">Cancelar</button>
              <button onClick={salvarAgenda} disabled={!dtAgenda}
                className="flex-1 text-sm font-semibold bg-gold text-ink rounded-lg py-2 disabled:opacity-40 hover:brightness-110 transition">
                Marcar ligação
              </button>
            </div>
          </div>
        </>
      )}

      {/* Modal: devolver com motivo obrigatório */}
      {devolvendo && (
        <>
          <div className="fixed inset-0 z-40 bg-ink/60" onClick={() => setDevolvendo(null)} />
          <div className="fixed z-50 inset-x-4 top-24 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[26rem] bg-panel border border-line rounded-2xl shadow-2xl p-5 space-y-3">
            <h2 className="font-display font-semibold">↩ Devolver lead para a base</h2>
            <p className="text-[11px] text-dim">
              {devolvendo.contacts?.name || fmtFone(devolvendo.contacts?.phone)} sai da sua posse e volta a receber campanhas.
              O motivo é obrigatório — ele alimenta a evolução da Anne e as métricas do time.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {MOTIVOS.map(m => (
                <button key={m} onClick={() => setMotivo(m)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border transition
                    ${motivo === m ? 'border-gold/60 bg-gold/10 text-cream' : 'border-line text-dim hover:text-cream'}`}>
                  {m.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
            <input className={inp + ' w-full'} placeholder="Observação (opcional)" value={notaDev} onChange={e => setNotaDev(e.target.value)} />
            <div className="flex gap-2">
              <button onClick={() => setDevolvendo(null)} className="flex-1 text-sm border border-line text-dim rounded-lg py-2 hover:text-cream transition">Cancelar</button>
              <button onClick={devolver} disabled={!motivo}
                className="flex-1 text-sm font-semibold bg-danger/15 text-danger border border-danger/40 rounded-lg py-2 disabled:opacity-40 hover:bg-danger/25 transition">
                Confirmar devolução
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ============================================================
// 📊 Gestão — vendedores, corte semanal, taxa por coorte mensal
// ============================================================
function Gestao({ vendedores, recarregarVendedores, flash }:
  { vendedores: Vendedor[]; recarregarVendedores: () => void; flash: (t: string) => void }) {
  const [corte, setCorte] = useState<Corte | null>(null)
  const [novoV, setNovoV] = useState({ nome: '', email: '', telefone: '', tipo: 'closer' })
  const [novoCorte, setNovoCorte] = useState({ inicio: '', fim: '', teto: 50 })
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7))
  const [assMes, setAssMes] = useState<Assignment[]>([])
  const [ativosCount, setAtivosCount] = useState<Record<string, number>>({})
  const [trabalhados, setTrabalhados] = useState<Set<string>>(new Set())

  const carregarCorte = async () => {
    const { data } = await supabase.from('cortes_comercial').select('*')
      .eq('status', 'ativo').order('created_at', { ascending: false }).limit(1).maybeSingle()
    setCorte((data as any) ?? null)
  }
  useEffect(() => { carregarCorte() }, [])

  // coorte do mês: TODOS os assignments com assigned_at no mês selecionado
  const carregarMes = async () => {
    const ini = `${mes}-01`
    const fim = new Date(new Date(ini).getFullYear(), new Date(ini).getMonth() + 1, 1).toISOString().slice(0, 10)
    const rows = await fetchAll<Assignment>((de, ate) =>
      supabase.from('lead_assignments').select('*,contacts(name,phone,source_first),conversations(current_agent_slug)')
        .gte('assigned_at', ini).lt('assigned_at', fim)
        .order('assigned_at').range(de, ate))
    setAssMes(rows)
    const ids = rows.map(r => r.id)
    const trab = new Set<string>()
    for (let i = 0; i < ids.length; i += 150) {
      const { data } = await supabase.from('atividades_comercial')
        .select('assignment_id').in('assignment_id', ids.slice(i, i + 150)).limit(1000)
      for (const a of ((data as any) ?? [])) trab.add(a.assignment_id)
    }
    setTrabalhados(trab)
    const cnt: Record<string, number> = {}
    const { data: at } = await supabase.from('lead_assignments')
      .select('vendedor_id').eq('status', 'ativo').limit(1000)
    for (const a of ((at as any) ?? [])) cnt[a.vendedor_id] = (cnt[a.vendedor_id] ?? 0) + 1
    setAtivosCount(cnt)
  }
  useEffect(() => { carregarMes() }, [mes])

  const [salvandoV, setSalvandoV] = useState(false)
  const addVendedor = async () => {
    if (salvandoV) return
    if (!novoV.nome.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(novoV.email.trim())) return flash('Nome e e-mail válido são obrigatórios.')
    const email = novoV.email.trim().toLowerCase()
    setSalvandoV(true)
    const { error } = await supabase.from('vendedores').insert({
      nome: novoV.nome.trim(), email,
      telefone: novoV.telefone.trim() || null, tipo: novoV.tipo,
    })
    if (error) {
      setSalvandoV(false)
      return flash(/duplicate|23505/.test(error.message + (error as any).code)
        ? `⚠️ ${email} já está cadastrado como vendedor — veja a lista abaixo.`
        : 'Erro: ' + error.message)
    }
    // acesso do vendedor = estar nesta tabela (migration 18); manda o link de entrada já
    const { error: errLink } = await supabase.auth.signInWithOtp({
      email, options: { emailRedirectTo: 'https://fabiomsam-cloud.github.io/anne-painel/', shouldCreateUser: true },
    })
    flash(errLink
      ? `✅ ${novoV.nome} cadastrado como vendedor, mas o e-mail de acesso falhou (${errLink.message}) — a pessoa pode pedir o link mágico na tela de login.`
      : `✅ ${novoV.nome} cadastrado — link de acesso enviado por e-mail. Ele verá só Inbox, Escalações e Comercial.`)
    setNovoV({ nome: '', email: '', telefone: '', tipo: 'closer' })
    setSalvandoV(false)
    recarregarVendedores()
  }

  const toggleAtivo = async (v: Vendedor) => {
    await supabase.from('vendedores').update({ ativo: !v.ativo }).eq('id', v.id)
    recarregarVendedores()
  }

  const mudarTipo = async (v: Vendedor) => {
    const novo = v.tipo === 'closer' ? 'escalacao' : 'closer'
    const { count } = await supabase.from('lead_assignments')
      .select('*', { count: 'exact', head: true }).eq('vendedor_id', v.id).eq('status', 'ativo')
    if (novo === 'escalacao' && (count ?? 0) > 0 &&
        !window.confirm(`${v.nome} ainda tem ${count} lead(s) em posse.\n\nAo virar ESCALAÇÃO ele sai da roleta imediatamente, mas os cards atuais continuam com ele até fechar/devolver. Continuar?`)) return
    await supabase.from('vendedores').update({ tipo: novo }).eq('id', v.id)
    flash(`${v.nome} agora é ${novo === 'closer' ? '☎ closer (entra na roleta)' : '🚨 escalação (bônus sobre vendas da IA)'}.`)
    recarregarVendedores()
  }

  const deletarVendedor = async (v: Vendedor) => {
    const { count } = await supabase.from('lead_assignments')
      .select('*', { count: 'exact', head: true }).eq('vendedor_id', v.id)
    const aviso = (count ?? 0) > 0
      ? `\n\n⚠️ Isso APAGA também os ${count} card(s) e todas as atividades dele — o histórico sai das métricas de coorte. Leads em posse voltam para a base (recebem campanhas de novo).`
      : ''
    if (!window.confirm(`Excluir ${v.nome} PERMANENTEMENTE?${aviso}\n\nNão dá para desfazer. Para pausar sem perder histórico, use "Desativar".`)) return
    // 1) leads em posse voltam para a base
    const { data: ativos } = await supabase.from('lead_assignments')
      .select('conversation_id').eq('vendedor_id', v.id).eq('status', 'ativo')
    const convIds = (((ativos as any) ?? []) as { conversation_id: string | null }[])
      .map(a => a.conversation_id).filter(Boolean) as string[]
    if (convIds.length) await supabase.from('conversations')
      .update({ status: 'dormant' }).in('id', convIds).eq('status', 'humano_comercial')
    // 2) cards (atividades caem em cascata) e depois o vendedor
    await supabase.from('lead_assignments').delete().eq('vendedor_id', v.id)
    const { error } = await supabase.from('vendedores').delete().eq('id', v.id)
    if (error) return flash('Erro ao excluir: ' + error.message)
    flash(`${v.nome} excluído por completo.`)
    recarregarVendedores()
  }

  const criarCorte = async () => {
    if (!novoCorte.inicio || !novoCorte.fim) return flash('Defina início e fim do corte.')
    const { data: u } = await supabase.auth.getUser()
    const { error } = await supabase.from('cortes_comercial').insert({
      inicio: novoCorte.inicio, fim: novoCorte.fim, teto_padrao: novoCorte.teto,
      created_by: u.user?.email ?? 'painel',
    })
    if (error) return flash('Erro: ' + error.message)
    flash('✅ Corte criado — a roleta distribui em até 15 minutos (motor ANNE · Comercial Humano).')
    carregarCorte()
  }

  const encerrarCorte = async () => {
    if (!corte) return
    if (!window.confirm('Encerrar o corte ativo? A distribuição para de completar tetos imediatamente.')) return
    await supabase.from('cortes_comercial').update({ status: 'encerrado' }).eq('id', corte.id)
    flash('Corte encerrado.')
    carregarCorte()
  }

  const setOverride = async (vendId: string, valor: string) => {
    if (!corte) return
    const ov = { ...(corte.overrides ?? {}) }
    if (valor === '' || isNaN(Number(valor))) delete ov[vendId]
    else ov[vendId] = Math.max(0, parseInt(valor))
    await supabase.from('cortes_comercial').update({ overrides: ov }).eq('id', corte.id)
    setCorte({ ...corte, overrides: ov })
  }

  // ---- métricas da coorte mensal ----
  const porVendedor = useMemo(() => {
    const m: Record<string, { recebidos: number; matriculados: number; devolvidos: number; expirados: number; semTrabalho: number; abertos: number; receita: number; trabalhados: number }> = {}
    for (const a of assMes) {
      const x = (m[a.vendedor_id] ??= { recebidos: 0, matriculados: 0, devolvidos: 0, expirados: 0, semTrabalho: 0, abertos: 0, receita: 0, trabalhados: 0 })
      x.recebidos++
      if (trabalhados.has(a.id)) x.trabalhados++
      if (a.status === 'matriculado') { x.matriculados++; x.receita += Number(a.venda_valor) || 0 }
      else if (a.status === 'devolvido') x.devolvidos++
      else if (a.status === 'expirado') { x.expirados++; if (a.motivo_perda === 'expirado_sem_trabalho') x.semTrabalho++ }
      else x.abertos++
    }
    return m
  }, [assMes, trabalhados])

  const porCanal = useMemo(() => {
    const m: Record<string, { recebidos: number; matriculados: number }> = {}
    for (const a of assMes) {
      const c = canalDoLead(a.contacts?.source_first)
      const x = (m[c] ??= { recebidos: 0, matriculados: 0 })
      x.recebidos++
      if (a.status === 'matriculado') x.matriculados++
    }
    return Object.entries(m).sort((a, b) => b[1].recebidos - a[1].recebidos)
  }, [assMes])

  const pct = (n: number, d: number) => (d ? `${(100 * n / d).toFixed(1)}%` : '—')
  const inp = 'bg-panel border border-line rounded-lg px-3 py-2 text-sm text-cream focus:outline-none focus:border-gold/60 placeholder:text-dim/40'

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 max-w-5xl">
      {/* ---- corte semanal ---- */}
      <section className="border border-line bg-panel/50 rounded-xl p-4 space-y-3">
        <h2 className="font-display font-semibold">🎯 Corte semanal (roleta)</h2>
        {corte ? (
          <>
            <div className="text-sm">
              Corte ativo: <b className="text-cream">{corte.inicio.split('-').reverse().join('/')} → {corte.fim.split('-').reverse().join('/')}</b>
              <span className="text-dim"> · teto padrão </span><b className="text-gold">{corte.teto_padrao} leads/vendedor</b>
              <button onClick={encerrarCorte} className="ml-3 text-xs text-danger/80 border border-danger/30 rounded-lg px-2.5 py-1 hover:bg-danger/10 transition">Encerrar corte</button>
            </div>
            <div className="text-[11px] text-dim">Teto individual (vazio = padrão; 0 = fora deste corte, ex.: férias):</div>
            <div className="flex flex-wrap gap-2">
              {vendedores.filter(v => v.tipo === 'closer').map(v => (
                <label key={v.id} className="flex items-center gap-2 text-xs border border-line rounded-lg px-2.5 py-1.5">
                  <span className={v.ativo ? '' : 'line-through text-dim'}>{v.nome}</span>
                  <input type="number" min={0} className="w-16 bg-panel2 border border-line rounded px-1.5 py-0.5 text-xs font-mono"
                    defaultValue={corte.overrides?.[v.id] ?? ''} placeholder={String(corte.teto_padrao)}
                    onBlur={e => setOverride(v.id, e.target.value)} />
                </label>
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-dim">Início<br />
              <input type="date" className={inp} value={novoCorte.inicio} onChange={e => setNovoCorte({ ...novoCorte, inicio: e.target.value })} /></label>
            <label className="text-xs text-dim">Fim<br />
              <input type="date" className={inp} value={novoCorte.fim} onChange={e => setNovoCorte({ ...novoCorte, fim: e.target.value })} /></label>
            <label className="text-xs text-dim">Teto/vendedor<br />
              <input type="number" min={1} className={inp + ' w-24'} value={novoCorte.teto} onChange={e => setNovoCorte({ ...novoCorte, teto: parseInt(e.target.value) || 50 })} /></label>
            <button onClick={criarCorte} className="bg-gold text-ink font-semibold rounded-lg px-5 py-2 text-sm hover:brightness-110 transition">Criar corte</button>
            <div className="w-full text-[11px] text-dim">
              Sem corte ativo — a roleta está parada. O ciclo padrão é quarta → terça. A distribuição é estratificada
              (A quente / B morno / C frio) e cada vendedor recebe a mesma proporção de cada estrato.
            </div>
          </div>
        )}
      </section>

      {/* ---- vendedores ---- */}
      <section className="border border-line bg-panel/50 rounded-xl p-4 space-y-3">
        <h2 className="font-display font-semibold">👤 Vendedores</h2>
        <div className="flex flex-wrap gap-2">
          <input className={inp + ' flex-1 min-w-36'} placeholder="Nome" value={novoV.nome} onChange={e => setNovoV({ ...novoV, nome: e.target.value })} />
          <input className={inp + ' flex-1 min-w-48'} placeholder="email@grupo.com" value={novoV.email} onChange={e => setNovoV({ ...novoV, email: e.target.value })} />
          <input className={inp + ' w-40'} placeholder="Telefone (opcional)" value={novoV.telefone} onChange={e => setNovoV({ ...novoV, telefone: e.target.value })} />
          <select className={inp} value={novoV.tipo} onChange={e => setNovoV({ ...novoV, tipo: e.target.value })}>
            <option value="closer">Closer (recebe leads da roleta)</option>
            <option value="escalacao">Escalação (devolve p/ IA)</option>
          </select>
          <button onClick={addVendedor} disabled={salvandoV}
            className="bg-gold text-ink font-semibold rounded-lg px-4 text-sm disabled:opacity-40 hover:brightness-110 transition">
            {salvandoV ? '…' : '＋ Cadastrar'}
          </button>
        </div>
        <div className="space-y-1.5">
          {vendedores.map(v => (
            <div key={v.id} className="flex items-center gap-3 border border-line rounded-lg px-3 py-2 text-sm">
              <span className={v.ativo ? 'font-medium' : 'line-through text-dim'}>{v.nome}</span>
              <span className="font-mono text-[11px] text-dim truncate">{v.email}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${v.tipo === 'closer' ? 'border-gold/40 text-gold' : 'border-teal/40 text-teal'}`}>
                {v.tipo === 'closer' ? '☎ closer' : '🚨 escalação'}
              </span>
              {v.tipo === 'closer' && <span className="text-[10px] font-mono text-dim">{ativosCount[v.id] ?? 0} em posse</span>}
              <div className="ml-auto flex items-center gap-1.5">
                <button onClick={() => mudarTipo(v)}
                  title={v.tipo === 'closer' ? 'Mover para escalação (sai da roleta)' : 'Mover para closer (entra na roleta)'}
                  className="text-xs border border-line text-dim rounded-lg px-2.5 py-1 hover:text-cream hover:border-gold/40 transition">
                  ↔ {v.tipo === 'closer' ? 'virar escalação' : 'virar closer'}
                </button>
                <button onClick={() => toggleAtivo(v)}
                  className={`text-xs border rounded-lg px-2.5 py-1 transition ${v.ativo
                    ? 'border-line text-dim hover:text-danger hover:border-danger/40' : 'border-win/40 text-win hover:bg-win/10'}`}>
                  {v.ativo ? 'Desativar' : 'Reativar'}
                </button>
                <button onClick={() => deletarVendedor(v)} title="Excluir permanentemente (apaga cards e histórico)"
                  className="text-xs border border-danger/30 text-danger/80 rounded-lg px-2.5 py-1 hover:bg-danger/10 hover:text-danger transition">
                  🗑
                </button>
              </div>
            </div>
          ))}
          {!vendedores.length && <div className="text-dim text-sm py-3 text-center">Nenhum vendedor cadastrado.</div>}
        </div>
        <p className="text-[11px] text-dim/70">O acesso ao painel é separado: cadastre o MESMO e-mail na aba 👥 Equipe.</p>
      </section>

      {/* ---- coorte mensal ---- */}
      <section className="border border-line bg-panel/50 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="font-display font-semibold">📈 Coorte mensal (comissão)</h2>
          <input type="month" className={inp} value={mes} onChange={e => setMes(e.target.value)} />
          <span className="text-[11px] text-dim">taxa = matrículas da coorte ÷ recebidos no mês · coorte madura no dia 14 do mês seguinte · apuração dia 15</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] font-mono text-dim uppercase tracking-wider text-left border-b border-line">
                <th className="py-2 pr-3">Vendedor</th><th className="py-2 px-2">Recebidos</th>
                <th className="py-2 px-2">Trabalhados</th><th className="py-2 px-2">Matrículas</th>
                <th className="py-2 px-2 text-gold">Taxa</th><th className="py-2 px-2">Devolvidos</th>
                <th className="py-2 px-2">Expirados</th><th className="py-2 px-2 text-danger">Sem trabalho</th>
                <th className="py-2 px-2">Em aberto</th><th className="py-2 px-2">Receita</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(porVendedor).map(([vid, x]) => {
                const v = vendedores.find(vv => vv.id === vid)
                return (
                  <tr key={vid} className="border-b border-line/40">
                    <td className="py-2 pr-3 font-medium">{v?.nome ?? '?'}</td>
                    <td className="py-2 px-2 font-mono">{x.recebidos}</td>
                    <td className="py-2 px-2 font-mono">{x.trabalhados} <span className="text-[10px] text-dim">({pct(x.trabalhados, x.recebidos)})</span></td>
                    <td className="py-2 px-2 font-mono text-win">{x.matriculados}</td>
                    <td className="py-2 px-2 font-mono text-gold font-semibold">{pct(x.matriculados, x.recebidos)}</td>
                    <td className="py-2 px-2 font-mono">{x.devolvidos}</td>
                    <td className="py-2 px-2 font-mono">{x.expirados}</td>
                    <td className="py-2 px-2 font-mono text-danger">{x.semTrabalho}</td>
                    <td className="py-2 px-2 font-mono">{x.abertos}</td>
                    <td className="py-2 px-2 font-mono">{x.receita ? `R$ ${x.receita.toLocaleString('pt-BR')}` : '—'}</td>
                  </tr>
                )
              })}
              {!assMes.length && (
                <tr><td colSpan={10} className="py-6 text-center text-dim text-sm">Nenhum lead distribuído neste mês.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- canal de origem ---- */}
      {assMes.length > 0 && (
        <section className="border border-line bg-panel/50 rounded-xl p-4 space-y-3">
          <h2 className="font-display font-semibold">🛰 Conversão por canal de origem <span className="text-[11px] text-dim font-normal">(quais canais fecham por telefone)</span></h2>
          <div className="flex flex-wrap gap-2">
            {porCanal.map(([canal, x]) => (
              <div key={canal} className="border border-line rounded-xl px-3 py-2 text-center">
                <div className="text-[10px] font-mono text-dim">{canal}</div>
                <div className="text-sm font-semibold">{x.matriculados}/{x.recebidos}</div>
                <div className="text-[10px] font-mono text-gold">{pct(x.matriculados, x.recebidos)}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
