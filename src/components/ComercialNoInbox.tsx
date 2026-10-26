import { useEffect, useState } from 'react'
import { supabase, fmtHora } from '../lib/supabase'
import { MOTIVOS, MOTIVOS_RECUPERACAO, ATIV_LABEL, ESTRATO_CLS, diasRestantes } from '../lib/comercial'

// ============================================================
// ☎️ Comercial Humano DENTRO do Inbox (itens 1 e 6 do PDF da equipe, 16/10/2026)
//  · sem card: closer "puxa para o meu pipeline" / admin "envia para o Comercial" —
//    RPC fn_enviar_conversa_para_comercial (migration 43). BOTÃO, nunca automático.
//    Aparece só com a conversa em human/dormant/paused (em 'ia' a Anne trabalha: assuma antes).
//  · com card ativo: barra com posse, estrato, dias restantes, último registro e os mesmos
//    botões do card do pipeline (📞 Atendida · 📵 Não atendeu · 🗓 Agendar ligação · ↩ Devolver).
//    💳 Agendar matrícula já existe no cabeçalho do Inbox (🗓 Agendar) — não duplica.
//  Quem opera: o dono do card ou admin; outros só veem a posse.
//  26/10: barra ÚNICA para toda conversa com humano, com ou sem card — os mesmos botões nas duas telas:
//    ⏹ Encerrar (motivo obrigatório; fecha o card se houver; conversa adormece; motivos de venda → recuperação)
//    ↩ Devolver para a Anne (a Anne retoma a cadência; fecha o card se houver)
//    ☎️ Puxar / Enviar para o Comercial (sem card). RPCs fn_inbox_encerrar / fn_inbox_devolver_anne (migration 51).
// ============================================================

type Vend = { id: string; nome: string; email: string; tipo: string; ativo: boolean }
type Card = {
  id: string; vendedor_id: string; estrato: string; status: string; assigned_at: string; expires_at: string
  proxima_acao: string | null; proxima_acao_em: string | null; gatilho: string | null
  vendedores: { nome: string; email: string } | null
}
type Ativ = { id: string; tipo: string; nota: string | null; agendada_para: string | null; created_at: string }

const inp = 'bg-panel border border-line rounded-lg px-3 py-2 text-sm text-cream focus:outline-none focus:border-gold/60 placeholder:text-dim/40'

export default function ComercialNoInbox({ convId, status, nome, optedOut, isAdmin, meuEmail, vendedores, responsavel, aoMudarStatus, aoDevolvidoAnne }: {
  convId: string; status: string; nome: string; optedOut: boolean; isAdmin: boolean; meuEmail: string
  vendedores: Vend[]; responsavel: string | null
  aoMudarStatus: (status: string, responsavel: string | null) => void
  aoDevolvidoAnne: () => void     // Inbox avisa o n8n para a Anne retomar na hora
}) {
  const [card, setCard] = useState<Card | null>(null)
  const [ativs, setAtivs] = useState<Ativ[]>([])
  const [msg, setMsg] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [escolhendo, setEscolhendo] = useState(false)     // admin: modal p/ escolher o closer
  const [vendSel, setVendSel] = useState('')
  const [devolvendo, setDevolvendo] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [notaDev, setNotaDev] = useState('')
  const [agendando, setAgendando] = useState(false)
  const [dtAgenda, setDtAgenda] = useState('')
  const [proxModal, setProxModal] = useState(false)       // Comercial v2 (24/10): próxima ação + data, obrigatória
  const [proxTxt, setProxTxt] = useState('')
  const [proxDt, setProxDt] = useState('')
  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(''), 7000) }

  const meuVend = vendedores.find(v => v.email.toLowerCase() === meuEmail.toLowerCase()) ?? null
  const closers = vendedores.filter(v => v.tipo === 'closer' && v.ativo)

  const carregar = async () => {
    const { data } = await supabase.from('lead_assignments')
      .select('id,vendedor_id,estrato,status,assigned_at,expires_at,proxima_acao,proxima_acao_em,gatilho,vendedores(nome,email)')
      .eq('conversation_id', convId).eq('status', 'ativo').maybeSingle()
    const c = (data as any) ?? null
    setCard(c)
    if (c) {
      const { data: at } = await supabase.from('atividades_comercial')
        .select('id,tipo,nota,agendada_para,created_at')
        .eq('assignment_id', c.id).order('created_at', { ascending: false }).limit(200)
      setAtivs((at as any) ?? [])
    } else setAtivs([])
  }
  useEffect(() => {
    setCard(null); setAtivs([]); setMsg('')
    carregar()
    // card criado/devolvido/expirado por outra tela (pipeline, motor) reflete aqui na hora
    const ch = supabase.channel(`com-inbox-${convId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lead_assignments', filter: `conversation_id=eq.${convId}` }, carregar)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [convId])

  const podeOperar = !!card && (isAdmin || (!!meuVend && card.vendedor_id === meuVend.id))
  const podeEnviar = !card && !optedOut && ['human', 'dormant', 'paused'].includes(status)
    && (isAdmin || meuVend?.tipo === 'closer')
  // 26/10: ações comuns às duas telas (conversa com humano, com ou sem card)
  const comHumano = ['human', 'humano_comercial'].includes(status)
  const souDono = !!responsavel && responsavel.toLowerCase() === meuEmail.toLowerCase()
  const podeEncerrar = comHumano && (card ? podeOperar : (isAdmin || souDono || !responsavel))
  const podeAnne = podeEncerrar
  const nomeDono = (email: string | null) => {
    if (!email) return ''
    const v = vendedores.find(v => v.email.toLowerCase() === email.toLowerCase())
    return v ? v.nome : email.split('@')[0]
  }

  // ---- item 1: puxar/enviar para o Comercial (RPC atômica; regras no banco) ----
  const enviar = async (vendedorId: string) => {
    if (ocupado) return
    setOcupado(true)
    const { data, error } = await supabase.rpc('fn_enviar_conversa_para_comercial', { p_conversation_id: convId, p_vendedor_id: vendedorId })
    setOcupado(false)
    if (error) return flash('⚠️ ' + error.message)
    if (!data?.ok) return flash('⚠️ ' + (data?.erro ?? 'Não foi possível enviar.'))
    setEscolhendo(false)
    aoMudarStatus('humano_comercial', data.vendedor_email ?? null)
    flash(`☎️ Lead no pipeline de ${data.vendedor} (estrato ${data.estrato}) — está em "Recebidos" na aba Comercial.`)
    carregar()
  }
  const puxar = () => {
    if (isAdmin && !(meuVend?.tipo === 'closer')) { setVendSel(closers[0]?.id ?? ''); setEscolhendo(true); return }
    if (!meuVend) return
    if (!window.confirm(`Puxar ${nome} para o SEU pipeline do Comercial?\n\nO lead entra em "Recebidos" por 14 dias, conta na sua métrica e a Anne deixa de agir nele.`)) return
    enviar(meuVend.id)
  }

  // ---- item 6: mesmos registros do card do pipeline (o histórico acumula, nada substitui) ----
  const registrar = async (tipo: string, nota = '', agendadaPara: string | null = null) => {
    if (!card) return
    const { error } = await supabase.from('atividades_comercial').insert({
      assignment_id: card.id, vendedor_id: card.vendedor_id, tipo, nota: nota || null, agendada_para: agendadaPara,
    })
    if (error) return flash('⚠️ ' + error.message)
    carregar()
  }
  const salvarAgenda = async () => {
    if (!dtAgenda) return
    await registrar('ligacao_agendada', '', new Date(dtAgenda).toISOString())
    setAgendando(false); setDtAgenda('')
    flash('🗓 Ligação agendada — está na sua régua no topo da aba Comercial.')
  }
  const salvarProxima = async () => {
    if (!card || !proxTxt.trim() || !proxDt) return
    setOcupado(true)
    const { data, error } = await supabase.rpc('fn_cv2_proxima_acao', { p_assignment_id: card.id, p_acao: proxTxt.trim(), p_em: new Date(proxDt).toISOString() })
    setOcupado(false)
    if (error) return flash('⚠️ ' + error.message)
    if (!data?.ok) return flash('⚠️ ' + (data?.erro ?? 'Não foi possível salvar.'))
    setProxModal(false); setProxTxt(''); setProxDt('')
    flash('✅ Próxima ação registrada.')
    carregar()
  }
  // ⏹ Encerrar: RPC atômica (card devolvido com motivo + conversa dormant + recuperação quando o motivo é de venda)
  const encerrar = async () => {
    if (!motivo || ocupado) return
    setOcupado(true)
    const { data, error } = await supabase.rpc('fn_inbox_encerrar', { p_conversation_id: convId, p_motivo: motivo, p_nota: notaDev.trim() || null })
    setOcupado(false)
    if (error) return flash('⚠️ ' + error.message)
    if (!data?.ok) return flash('⚠️ ' + (data?.erro ?? 'Não foi possível encerrar.'))
    aoMudarStatus('dormant', null)
    setDevolvendo(false); setMotivo(''); setNotaDev('')
    flash(data.recuperacao ? '⏹ Conversa encerrada — o lead entrou na recuperação (desconto e nutrição).' : '⏹ Conversa encerrada — saiu do inbox.')
    carregar()
  }
  // ↩ Devolver para a Anne: ela retoma a cadência de onde parou (fecha o card, se houver)
  const devolverAnne = async () => {
    if (ocupado) return
    if (!window.confirm(`Devolver ${nome} para a Anne?\n\nEla retoma a cadência de onde parou e volta a mandar mensagens.${card ? ' O card do Comercial é fechado.' : ''}`)) return
    setOcupado(true)
    const { data, error } = await supabase.rpc('fn_inbox_devolver_anne', { p_conversation_id: convId })
    setOcupado(false)
    if (error) return flash('⚠️ ' + error.message)
    if (!data?.ok) return flash('⚠️ ' + (data?.erro ?? 'Não foi possível devolver.'))
    aoMudarStatus('ia', responsavel)
    aoDevolvidoAnne()
    flash('↩ Devolvido para a Anne — ela retoma a cadência agora.')
    carregar()
  }

  const contar = (tipo: string) => ativs.filter(a => a.tipo === tipo).length
  const ult = ativs[0]
  const proxAgendada = ativs
    .filter(a => a.tipo === 'ligacao_agendada' && a.agendada_para && new Date(a.agendada_para).getTime() > Date.now() - 3600000)
    .sort((x, y) => String(x.agendada_para).localeCompare(String(y.agendada_para)))[0]
  const nAt = contar('ligacao_atendida'), nNao = contar('ligacao_nao_atendida')
  const btn = 'text-[11px] border rounded-lg px-2 py-1 transition disabled:opacity-40'

  if (!card && !podeEnviar && !comHumano && !msg) return null
  const acoes = (
    <div className="ml-auto flex gap-1 flex-wrap">
      {podeOperar && card && (
        <>
          <button onClick={() => registrar('ligacao_atendida')} disabled={ocupado}
            className={btn + ' border-line text-dim hover:text-win hover:border-win/40'}>📞 Atendida{nAt > 0 ? ` ×${nAt}` : ''}</button>
          <button onClick={() => registrar('ligacao_nao_atendida')} disabled={ocupado}
            className={btn + ' border-line text-dim hover:text-danger hover:border-danger/40'}>📵 Não atendeu{nNao > 0 ? ` ×${nNao}` : ''}</button>
          <button onClick={() => { setProxTxt(card.proxima_acao ?? ''); setProxDt(''); setProxModal(true) }}
            className={btn + (card.proxima_acao_em && new Date(card.proxima_acao_em).getTime() > Date.now() ? ' border-line text-dim hover:text-gold hover:border-gold/40' : ' border-gold/60 text-gold bg-gold/10')}>▶ Próxima ação</button>
          <button onClick={() => { setDtAgenda(''); setAgendando(true) }}
            className={btn + ' border-line text-dim hover:text-gold hover:border-gold/40'}>🗓 Agendar ligação</button>
        </>
      )}
      {podeEnviar && (
        <button onClick={puxar} disabled={ocupado}
          title={meuVend?.tipo === 'closer'
            ? 'Puxa o lead para o SEU pipeline: registra ligações, conta na sua métrica e a Anne não mexe mais nele'
            : 'Envia o lead para o pipeline de um closer do Comercial Humano'}
          className={btn + ' border-gold/40 text-gold bg-gold/10 hover:bg-gold/20 font-semibold'}>
          {ocupado ? 'Enviando…' : meuVend?.tipo === 'closer' ? '☎️ Puxar para meu pipeline' : '☎️ Enviar para o Comercial'}
        </button>
      )}
      {podeAnne && (
        <button onClick={devolverAnne} disabled={ocupado} title="A Anne retoma a cadência deste lead de onde parou"
          className={btn + ' border-teal/40 text-teal bg-teal/10 hover:bg-teal/20 font-semibold'}>↩ Devolver para a Anne</button>
      )}
      {podeEncerrar && (
        <button onClick={() => { setMotivo(''); setNotaDev(''); setDevolvendo(true) }} disabled={ocupado}
          title="Tira a conversa do inbox com um motivo (fecha o card do Comercial, se houver)"
          className={btn + ' border-danger/40 text-danger bg-danger/10 hover:bg-danger/20 font-semibold'}>⏹ Encerrar</button>
      )}
    </div>
  )
  return (
    <>
      {msg && <div className="rise mx-4 mt-2 text-xs rounded-lg border border-win/40 bg-win/10 text-win px-3 py-2">{msg}</div>}

      {(card || podeEnviar || comHumano) && (
        <div className={`px-3 md:px-5 py-2 border-b border-line flex items-center gap-2 flex-wrap text-[11px] ${card ? 'bg-gold/5' : ''}`}>
          {card ? (
            <>
              <span className="font-mono px-2 py-1 rounded-lg border border-gold/50 text-gold bg-gold/10"
                title="Lead de posse de um vendedor do Comercial Humano (14 dias)">
                ☎️ Posse de {card.vendedores?.nome ?? 'vendedor'} · ⏳{diasRestantes(card.expires_at)}d
              </span>
              <span className={`font-mono px-1.5 py-0.5 rounded border ${ESTRATO_CLS[card.estrato] ?? ESTRATO_CLS.C}`} title="Classe do Jev (A quente · B morno · C frio)">{card.estrato}</span>
              {nNao > 0 && <span className="font-mono px-1.5 py-0.5 rounded border border-danger/30 text-danger/90 bg-danger/5">📵 ×{nNao}</span>}
              {nAt > 0 && <span className="font-mono px-1.5 py-0.5 rounded border border-win/40 text-win bg-win/5">📞 ×{nAt}</span>}
              {card.proxima_acao_em ? (
                <span className={new Date(card.proxima_acao_em).getTime() < Date.now() ? 'text-amber' : 'text-gold'}
                  title="Próxima ação combinada (Comercial v2)">
                  ▶ {card.proxima_acao} · {fmtHora(card.proxima_acao_em)}{new Date(card.proxima_acao_em).getTime() < Date.now() ? ' · VENCIDA' : ''}
                </span>
              ) : (
                <span className="text-amber" title="Todo lead em posse precisa de próxima ação com data (24 h após a atribuição)">▶ sem próxima ação</span>
              )}
              {proxAgendada ? (
                <span className="text-gold">🗓 Ligação marcada · {fmtHora(proxAgendada.agendada_para)}</span>
              ) : ult ? (
                <span className="text-dim">{ATIV_LABEL[ult.tipo] ?? ult.tipo} · {fmtHora(ult.created_at)}{ult.nota ? ` — ${ult.nota}` : ''}</span>
              ) : (
                <span className="text-dim">sem tentativa registrada — ligue hoje</span>
              )}
            </>
          ) : comHumano ? (
            <span className={`font-mono px-2 py-1 rounded-lg border ${responsavel ? 'border-line text-dim' : 'border-amber/50 text-amber bg-amber/10'}`}
              title={responsavel ? 'Conversa com humano — responsável no seletor 👤 acima' : 'Conversa com humano sem responsável: assuma pelo seletor 👤 ou encerre'}>
              👤 Com humano · {responsavel ? nomeDono(responsavel) : 'sem dono'}
            </span>
          ) : (
            <span className="text-dim">Lead adormecido — a Anne atende se ele escrever.</span>
          )}
          {acoes}
        </div>
      )}

      {/* Modal admin: escolher o closer */}
      {escolhendo && (
        <>
          <div className="fixed inset-0 z-40 bg-ink/60" onClick={() => setEscolhendo(false)} />
          <div className="fixed z-50 inset-x-4 top-24 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[22rem] bg-panel border border-line rounded-2xl shadow-2xl p-5 space-y-3">
            <h2 className="font-display font-semibold">☎️ Enviar para o Comercial</h2>
            <p className="text-[11px] text-dim">{nome} vira card ativo (14 dias) no pipeline do vendedor escolhido, fora da roleta.</p>
            <select value={vendSel} onChange={e => setVendSel(e.target.value)} className={inp + ' w-full'}>
              {closers.map(v => <option key={v.id} value={v.id}>{v.nome}</option>)}
            </select>
            <div className="flex gap-2">
              <button onClick={() => setEscolhendo(false)} className="flex-1 text-sm border border-line text-dim rounded-lg py-2 hover:text-cream transition">Cancelar</button>
              <button onClick={() => enviar(vendSel)} disabled={!vendSel || ocupado}
                className="flex-1 text-sm font-semibold bg-gold text-ink rounded-lg py-2 disabled:opacity-40 hover:brightness-110 transition">
                {ocupado ? 'Enviando…' : 'Enviar'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Modal: próxima ação com data (Comercial v2) */}
      {proxModal && (
        <>
          <div className="fixed inset-0 z-40 bg-ink/60" onClick={() => setProxModal(false)} />
          <div className="fixed z-50 inset-x-4 top-24 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[24rem] bg-panel border border-line rounded-2xl shadow-2xl p-5 space-y-3">
            <h2 className="font-display font-semibold">▶ Próxima ação</h2>
            <p className="text-[11px] text-dim">{nome} — o que você vai fazer e quando. Sem próxima ação registrada o lead aparece como "esquecido" para o Fábio.</p>
            <input className={inp + ' w-full'} placeholder="Ex.: ligar e mandar proposta no cartão" value={proxTxt} onChange={e => setProxTxt(e.target.value)} />
            <input type="datetime-local" className={inp + ' w-full'} value={proxDt}
              min={new Date(Date.now() + 5 * 60000).toISOString().slice(0, 16)}
              onChange={e => setProxDt(e.target.value)} />
            <div className="flex gap-2">
              <button onClick={() => setProxModal(false)} className="flex-1 text-sm border border-line text-dim rounded-lg py-2 hover:text-cream transition">Cancelar</button>
              <button onClick={salvarProxima} disabled={!proxTxt.trim() || !proxDt || ocupado}
                className="flex-1 text-sm font-semibold bg-gold text-ink rounded-lg py-2 disabled:opacity-40 hover:brightness-110 transition">Salvar</button>
            </div>
          </div>
        </>
      )}

      {/* Modal: agendar ligação */}
      {agendando && (
        <>
          <div className="fixed inset-0 z-40 bg-ink/60" onClick={() => setAgendando(false)} />
          <div className="fixed z-50 inset-x-4 top-24 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[22rem] bg-panel border border-line rounded-2xl shadow-2xl p-5 space-y-3">
            <h2 className="font-display font-semibold">🗓 Agendar ligação</h2>
            <p className="text-[11px] text-dim">{nome} — o compromisso entra na sua régua no topo da aba Comercial.</p>
            <input type="datetime-local" className={inp + ' w-full'} value={dtAgenda}
              min={new Date(Date.now() + 5 * 60000).toISOString().slice(0, 16)}
              onChange={e => setDtAgenda(e.target.value)} />
            <div className="flex gap-2">
              <button onClick={() => setAgendando(false)} className="flex-1 text-sm border border-line text-dim rounded-lg py-2 hover:text-cream transition">Cancelar</button>
              <button onClick={salvarAgenda} disabled={!dtAgenda}
                className="flex-1 text-sm font-semibold bg-gold text-ink rounded-lg py-2 disabled:opacity-40 hover:brightness-110 transition">Marcar ligação</button>
            </div>
          </div>
        </>
      )}

      {/* Modal: encerrar com motivo obrigatório (26/10 — vale com e sem card) */}
      {devolvendo && (
        <>
          <div className="fixed inset-0 z-40 bg-ink/60" onClick={() => setDevolvendo(false)} />
          <div className="fixed z-50 inset-x-4 top-24 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[26rem] bg-panel border border-line rounded-2xl shadow-2xl p-5 space-y-3">
            <h2 className="font-display font-semibold">⏹ Encerrar conversa</h2>
            <p className="text-[11px] text-dim">
              {nome} sai do inbox{card ? ' e o card do Comercial é devolvido com este motivo' : ''}. Motivos de venda (sem interesse, preço, vai pensar…) mandam o lead
              para a recuperação (desconto e nutrição); "já é aluno" e "telefone inválido" só encerram. Se ele escrever de novo, a Anne atende.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {MOTIVOS.map(m => (
                <button key={m} onClick={() => setMotivo(m)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border transition ${motivo === m ? 'border-gold/60 bg-gold/10 text-cream' : 'border-line text-dim hover:text-cream'}`}>
                  {m.replace(/_/g, ' ')}{MOTIVOS_RECUPERACAO.includes(m) ? ' ↻' : ''}
                </button>
              ))}
            </div>
            <div className="text-[10px] text-dim">↻ = vai para a recuperação</div>
            <input className={inp + ' w-full'} placeholder="Observação (opcional)" value={notaDev} onChange={e => setNotaDev(e.target.value)} />
            <div className="flex gap-2">
              <button onClick={() => setDevolvendo(false)} className="flex-1 text-sm border border-line text-dim rounded-lg py-2 hover:text-cream transition">Cancelar</button>
              <button onClick={encerrar} disabled={!motivo || ocupado}
                className="flex-1 text-sm font-semibold bg-danger/15 text-danger border border-danger/40 rounded-lg py-2 disabled:opacity-40 hover:bg-danger/25 transition">{ocupado ? 'Encerrando…' : 'Encerrar'}</button>
            </div>
          </div>
        </>
      )}
    </>
  )
}
