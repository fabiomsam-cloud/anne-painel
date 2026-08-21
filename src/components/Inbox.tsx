import { useEffect, useRef, useState } from 'react'
import { Mp3Encoder } from '@breezystack/lamejs'
import { supabase, AGENT_LABEL, STATUS_META, PIPELINE_COLS, pipelineCol, fmtHora, fmtFone } from '../lib/supabase'

type Conv = {
  id: string; status: string; current_agent_slug: string; last_message_at: string | null
  last_user_message_at: string | null; read_at: string | null
  contexto: any
  contacts: { id: string; name: string | null; phone: string; tags: string[]; client_memory: any; opted_out: boolean }
}
type Msg = {
  id: string; from_type: string; type: string; content: string | null; transcript: string | null
  status: string; created_at: string; metadata: any; agent_slug: string | null
}
type Template = { name: string; body: string; buttons: string[]; category: string }

const TEMPLATES_URL = 'https://workflows.manager03.scvpgti.com.br/webhook/anne/meta/templates'
const SEND_TPL_URL = 'https://workflows.manager03.scvpgti.com.br/webhook/anne/meta/send-template'
const JANELA_MS = 24 * 60 * 60 * 1000

// janela de 24h da Meta: aberta enquanto a ÚLTIMA mensagem do lead tem < 24h
function janela(c: Conv | null, agora: number) {
  const ts = c?.last_user_message_at ? new Date(c.last_user_message_at).getTime() : 0
  const resta = ts + JANELA_MS - agora
  if (!ts || resta <= 0) return { aberta: false, label: 'Janela fechada' }
  const h = Math.floor(resta / 3600000), m = Math.floor((resta % 3600000) / 60000)
  return { aberta: true, label: `${h}h ${String(m).padStart(2, '0')}min` }
}

// chip de etapa do pipeline na lista — humano/matriculado/dormente ficam de fora
// porque o chip de status já mostra exatamente isso
const ETAPA_CHIP: Record<string, { label: string; cls: string }> = {
  novo: { label: 'Novo', cls: 'border-line text-dim' },
  negociando: { label: 'Negociando', cls: 'border-gold/40 text-gold bg-gold/5' },
  checkout: { label: '🛒 Checkout enviado', cls: 'border-gold/50 text-gold bg-gold/15' },
}

// não lida = o lead mandou mensagem depois da última vez que alguém abriu a conversa
function naoLida(c: Conv) {
  if (!c.last_user_message_at) return false
  if (!c.read_at) return true
  return new Date(c.last_user_message_at).getTime() > new Date(c.read_at).getTime()
}

// última mensagem é de saída (você/IA respondeu por último)
function ultimaEhSaida(c: Conv) {
  if (!c.last_message_at || !c.last_user_message_at) return false
  return new Date(c.last_message_at).getTime() > new Date(c.last_user_message_at).getTime()
}

// conversa operada por gente: atendimento comum ou posse do Comercial Humano
function comHumano(status: string) {
  return status === 'human' || status === 'humano_comercial'
}

// Gravação do navegador (webm/mp4) → MP3 mono, formato que a Meta aceita por link.
// A conversão roda no envio; a prévia toca o blob original direto.
async function blobParaMp3(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext()
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
  ctx.close()
  const n = buf.length
  const mono = new Float32Array(n)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels
  }
  const pcm = new Int16Array(n)
  for (let i = 0; i < n; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(mono[i] * 32767)))
  const enc = new Mp3Encoder(1, buf.sampleRate, 64)   // 64 kbps mono: voz limpa e arquivo pequeno
  const partes: Uint8Array[] = []
  for (let i = 0; i < n; i += 1152) {
    const p = enc.encodeBuffer(pcm.subarray(i, i + 1152))
    if (p.length) partes.push(p)
  }
  const fim = enc.flush()
  if (fim.length) partes.push(fim)
  return new Blob(partes as BlobPart[], { type: 'audio/mpeg' })
}

// quem precisa de atenção fica no topo, aberta ou fechada a janela:
// 0 = não lida · 1 = com humano aguardando sua resposta · 2 = resto
function prioridade(c: Conv) {
  if (naoLida(c)) return 0
  if (comHumano(c.status) && c.last_user_message_at && !ultimaEhSaida(c)) return 1
  return 2
}

const FROM_STYLE: Record<string, string> = {
  user: 'self-start bg-panel2 border-line',
  ia: 'self-end bg-teal/10 border-teal/25',
  human: 'self-end bg-gold/10 border-gold/30',
  system: 'self-center bg-panel border-line text-dim text-xs',
}

export default function Inbox({ convInicial, aoConsumir, isAdmin = true }:
  { convInicial?: string | null; aoConsumir?: () => void; isAdmin?: boolean } = {}) {
  const [convs, setConvs] = useState<Conv[]>([])
  const [sel, setSel] = useState<Conv | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [filtroAgente, setFiltroAgente] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('')
  const [filtroJanela, setFiltroJanela] = useState<'' | 'aberta' | 'fechada'>('')
  const [filtroEtapa, setFiltroEtapa] = useState('')
  const [soNaoLidas, setSoNaoLidas] = useState(false)
  const [busca, setBusca] = useState('')
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [followup, setFollowup] = useState<any>(null)
  const [agora, setAgora] = useState(Date.now())
  const [tpls, setTpls] = useState<Template[]>([])
  const [selTplName, setSelTplName] = useState('')
  const [enviandoTpl, setEnviandoTpl] = useState(false)
  const [msgTpl, setMsgTpl] = useState('')
  const [infoAberto, setInfoAberto] = useState(false)
  const [kb, setKb] = useState<{ title: string; doc_type: string; content: string; agent: string } | null>(null)
  const [kbAgentes, setKbAgentes] = useState<{ slug: string; name: string }[]>([])
  const [kbEnviando, setKbEnviando] = useState(false)
  const fimRef = useRef<HTMLDivElement>(null)

  const buscaRef = useRef('')
  buscaRef.current = busca
  const filtroAgenteRef = useRef('')
  filtroAgenteRef.current = filtroAgente

  const carregarConvs = async () => {
    const SEL = 'id,status,current_agent_slug,last_message_at,last_user_message_at,read_at,contexto,contacts(id,name,phone,tags,client_memory,opted_out)'
    const q = buscaRef.current.trim()
    if (q) {
      // busca no BANCO (nome/telefone), não só nas 200 carregadas
      const digits = q.replace(/\D/g, '')
      const { data: cts } = await supabase.from('contacts').select('id')
        .or(digits.length >= 4 ? `name.ilike.%${q}%,phone.like.%${digits}%` : `name.ilike.%${q}%`)
        .limit(100)
      const ids = ((cts as any) ?? []).map((c: any) => c.id)
      if (!ids.length) { setConvs([]); return }
      const { data } = await supabase.from('conversations').select(SEL)
        .in('contact_id', ids)
        .order('last_message_at', { ascending: false, nullsFirst: false }).limit(100)
      setConvs((data as any) ?? [])
      return
    }
    // sem busca: 200 recentes + TODAS as human/comercial/won (não podem sumir num dia de disparo)
    // + com filtro de agente ativo: TODAS as conversas daquele agente direto do banco
    // (senão as boas-vindas antigas do onboarding saem das 200 recentes e "somem")
    const doAgente = filtroAgenteRef.current
      ? supabase.from('conversations').select(SEL).eq('current_agent_slug', filtroAgenteRef.current)
          .order('last_message_at', { ascending: false, nullsFirst: false }).limit(500)
      : Promise.resolve({ data: [] as any })
    const [rec, fixas, agn] = await Promise.all([
      supabase.from('conversations').select(SEL)
        .order('last_message_at', { ascending: false, nullsFirst: false }).limit(200),
      supabase.from('conversations').select(SEL).in('status', ['human', 'humano_comercial', 'won'])
        .order('last_message_at', { ascending: false, nullsFirst: false }).limit(200),
      doAgente,
    ])
    const vistos = new Set<string>()
    const juntos = [...((rec.data as any) ?? []), ...((fixas.data as any) ?? []), ...(((agn as any).data as any) ?? [])]
      .filter((c: any) => { if (vistos.has(c.id)) return false; vistos.add(c.id); return true })
      .sort((a: any, b: any) => String(b.last_message_at ?? '').localeCompare(String(a.last_message_at ?? '')))
    setConvs(juntos as any)
  }

  // vindo das Escalações: abre direto a conversa do lead
  useEffect(() => {
    if (!convInicial) return
    supabase.from('conversations')
      .select('id,status,current_agent_slug,last_message_at,last_user_message_at,read_at,contexto,contacts(id,name,phone,tags,client_memory,opted_out)')
      .eq('id', convInicial).single()
      .then(({ data }) => { if (data) { setSel(data as any); marcarLida(data as any) } })
    aoConsumir?.()
  }, [convInicial])

  // troca de filtro de agente recarrega do banco (traz TODAS as do agente)
  useEffect(() => { carregarConvs() }, [filtroAgente])

  useEffect(() => {
    carregarConvs()
    const ch = supabase.channel('inbox-convs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, carregarConvs)
      .subscribe()
    // relógio p/ contagem regressiva da janela 24h
    const t = setInterval(() => setAgora(Date.now()), 30000)
    return () => { supabase.removeChannel(ch); clearInterval(t) }
  }, [])

  // templates aprovados: carrega quando abrir uma conversa com janela fechada
  useEffect(() => {
    if (!sel || tpls.length) return
    if (janela(sel, agora).aberta) return
    fetch(TEMPLATES_URL).then(r => r.json())
      .then(d => setTpls(d.templates ?? []))
      .catch(() => setTpls([]))
  }, [sel?.id])

  const carregarMsgs = async (convId: string) => {
    const { data } = await supabase
      .from('messages')
      .select('id,from_type,type,content,transcript,status,created_at,metadata,agent_slug')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true })
      .limit(300)
    setMsgs((data as any) ?? [])
    const { data: fq } = await supabase
      .from('followup_queue').select('current_step,due_at,status')
      .eq('conversation_id', convId).eq('status', 'scheduled').maybeSingle()
    setFollowup(fq)
  }

  useEffect(() => {
    if (!sel) return
    carregarMsgs(sel.id)
    const ch = supabase.channel(`thread-${sel.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${sel.id}` },
        payload => {
          setMsgs(m => [...m, payload.new as Msg])
          // conversa está aberta na tela: mensagem nova do lead já nasce lida
          if ((payload.new as Msg).from_type === 'user') marcarLida(sel)
        })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [sel?.id])

  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs.length])

  // mantém a conversa aberta em sincronia com o realtime (janela 24h, status)
  useEffect(() => {
    if (!sel) return
    const fresh = convs.find(c => c.id === sel.id)
    if (fresh && (fresh.last_user_message_at !== sel.last_user_message_at || fresh.status !== sel.status))
      setSel(fresh)
  }, [convs])

  // abrir a conversa apaga o aviso de "não lida" para a equipe toda (realtime)
  const marcarLida = async (c: Conv) => {
    const ts = new Date().toISOString()
    setConvs(cs => cs.map(x => (x.id === c.id ? { ...x, read_at: ts } : x)))
    await supabase.from('conversations').update({ read_at: ts }).eq('id', c.id)
  }

  const assumir = async () => {
    if (!sel) return
    await supabase.from('conversations').update({ status: 'human' }).eq('id', sel.id)
    setSel({ ...sel, status: 'human' })
  }

  const devolverIA = async () => {
    if (!sel) return
    await supabase.from('conversations').update({ status: 'ia' }).eq('id', sel.id)
    await supabase.from('escalations').update({ status: 'resolved', resolved_at: new Date().toISOString() })
      .eq('conversation_id', sel.id).eq('status', 'open')
    setSel({ ...sel, status: 'ia' })
    // IA retoma imediatamente a partir da resposta do time (regra 13b)
    fetch('https://workflows.manager03.scvpgti.com.br/webhook/anne/painel/devolver', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: sel.id }),
    }).catch(() => {})
  }

  const apagarConversa = async () => {
    if (!sel) return
    const nome = sel.contacts?.name || fmtFone(sel.contacts?.phone)
    if (!window.confirm(
      `Apagar TODA a conversa com ${nome}?\n\n` +
      'Isso remove mensagens, follow-ups e escalações, e zera a memória que a IA construiu do lead. ' +
      'A próxima mensagem dele começa do zero, na triagem. Não dá para desfazer.')) return
    // conversa (cascade: messages, followup_queue/log, escalations) + reset da memória do contato
    await supabase.from('conversations').delete().eq('id', sel.id)
    await supabase.from('contacts').update({ client_memory: {}, tags: [], opted_out: false, opted_out_at: null })
      .eq('id', sel.contacts.id)
    setSel(null); setMsgs([]); carregarConvs()
  }

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sel || !texto.trim() || enviando) return
    setEnviando(true)
    const t = texto.trim()
    const { data: msg } = await supabase.from('messages').insert({
      conversation_id: sel.id, from_type: 'human', type: 'text', content: t, status: 'queued',
    }).select('id').single()
    await supabase.from('send_queue').insert({
      conversation_id: sel.id, message_id: msg?.id ?? null,
      phone: sel.contacts.phone, parts: [t], priority: 1,
    })
    setTexto(''); setEnviando(false)
  }

  // 🎤 áudio do atendente — grava no navegador, converte p/ MP3, sobe no bucket
  // público e enfileira a parte {type:'audio', link}: o Sender entrega pela Meta
  const [gravando, setGravando] = useState(false)
  const [gravSeg, setGravSeg] = useState(0)
  const [audioPronto, setAudioPronto] = useState<{ blob: Blob; url: string } | null>(null)
  const gravRef = useRef<MediaRecorder | null>(null)
  const gravTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const gravar = async () => {
    if (!sel || !comHumano(sel.status) || gravando) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      const chunks: Blob[] = []
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        if ((rec as any)._descartar) return
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
        setAudioPronto({ blob, url: URL.createObjectURL(blob) })
      }
      gravRef.current = rec
      rec.start()
      setGravSeg(0); setGravando(true)
      gravTimer.current = setInterval(() => setGravSeg(s => s + 1), 1000)
    } catch {
      setMsgTpl('⚠️ Não consegui acessar o microfone — libere a permissão do navegador e tente de novo.')
    }
  }

  const pararGravacao = (manter: boolean) => {
    const rec = gravRef.current
    if (rec && rec.state !== 'inactive') { (rec as any)._descartar = !manter; rec.stop() }
    if (gravTimer.current) clearInterval(gravTimer.current)
    setGravando(false)
  }

  const descartarAudio = () => {
    if (audioPronto) URL.revokeObjectURL(audioPronto.url)
    setAudioPronto(null)
  }

  const enviarAudio = async () => {
    if (!sel || !audioPronto || enviando) return
    setEnviando(true)
    try {
      const mp3 = await blobParaMp3(audioPronto.blob)
      const caminho = `${sel.id}/${Date.now()}.mp3`
      const { error: eUp } = await supabase.storage.from('inbox-audio')
        .upload(caminho, mp3, { contentType: 'audio/mpeg' })
      if (eUp) throw eUp
      const url = supabase.storage.from('inbox-audio').getPublicUrl(caminho).data.publicUrl
      const { data: msg } = await supabase.from('messages').insert({
        conversation_id: sel.id, from_type: 'human', type: 'audio',
        content: '🎙 Áudio do atendente', status: 'queued', metadata: { audio_url: url },
      }).select('id').single()
      await supabase.from('send_queue').insert({
        conversation_id: sel.id, message_id: msg?.id ?? null,
        phone: sel.contacts.phone, parts: [{ type: 'audio', link: url }], priority: 1,
      })
      descartarAudio()
    } catch (err: any) {
      setMsgTpl('⚠️ Falha ao enviar o áudio: ' + (err?.message ?? err))
    }
    setEnviando(false)
  }

  // 📚 balão → base de conhecimento: monta pergunta+resposta e abre a gaveta
  const abrirKb = async (m: Msg) => {
    if (!sel) return
    if (!kbAgentes.length) {
      const { data } = await supabase.from('agent_profiles').select('slug,name')
        .eq('active', true).neq('slug', 'roteador').order('slug')
      setKbAgentes(((data as any) ?? []))
    }
    const texto = (m.transcript || m.content || '').trim()
    let pergunta = '', resposta = ''
    if (m.from_type === 'user') { pergunta = texto }
    else {
      resposta = texto
      const anterior = [...msgs].reverse().find(x => x.from_type === 'user' && x.created_at < m.created_at)
      pergunta = (anterior?.transcript || anterior?.content || '').trim()
    }
    const agente = sel.current_agent_slug === 'roteador' ? '' : sel.current_agent_slug
    setKb({
      title: (pergunta || resposta).slice(0, 70),
      doc_type: 'faq',
      content: pergunta ? `Pergunta do lead: "${pergunta}"\n\nResposta oficial: ${resposta}` : resposta,
      agent: agente,
    })
  }

  const enviarKb = async () => {
    if (!kb || !kb.title.trim() || !kb.content.trim() || !kb.agent) return
    setKbEnviando(true)
    const { data: u } = await supabase.auth.getUser()
    const { error } = await supabase.from('knowledge_documents').insert({
      agent_slug: kb.agent, title: kb.title.trim(), doc_type: kb.doc_type,
      raw_content: kb.content.trim(), source: 'inbox', created_by: u.user?.email ?? 'painel',
    })
    setKbEnviando(false)
    if (error) return setMsgTpl('⚠️ Erro ao enviar para a base: ' + error.message)
    setKb(null)
    setMsgTpl('📚 Enviado para a base do agente — ingestão automática em andamento; a Anne já usa na próxima conversa.')
    setTimeout(() => setMsgTpl(''), 8000)
  }

  const enviarTemplate = async () => {
    if (!sel || !selTplName || enviandoTpl) return
    setEnviandoTpl(true); setMsgTpl('')
    try {
      const r = await fetch(SEND_TPL_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: sel.id, template_name: selTplName }),
      })
      const d = await r.json()
      setMsgTpl(d.ok ? '✅ Template enviado — quando o lead responder, a janela reabre por 24h.'
        : '⚠️ ' + (d.erro || 'Falha no envio.'))
      if (d.ok) setSelTplName('')
    } catch {
      setMsgTpl('⚠️ Falha de rede ao enviar o template.')
    }
    setEnviandoTpl(false)
  }

  // busca é feita no banco (carregarConvs); aqui só os filtros locais
  useEffect(() => {
    const t = setTimeout(carregarConvs, 350)
    return () => clearTimeout(t)
  }, [busca])

  const lista = convs.filter(c => {
    if (filtroAgente && c.current_agent_slug !== filtroAgente) return false
    if (filtroStatus && c.status !== filtroStatus) return false
    if (filtroEtapa && pipelineCol(c) !== filtroEtapa) return false
    if (filtroJanela && (janela(c, agora).aberta ? 'aberta' : 'fechada') !== filtroJanela) return false
    if (soNaoLidas && !naoLida(c)) return false
    return true
  }).sort((a, b) => {
    const pa = prioridade(a), pb = prioridade(b)
    if (pa !== pb) return pa - pb
    return String(b.last_message_at ?? '').localeCompare(String(a.last_message_at ?? ''))
  })
  const totalNaoLidas = convs.filter(naoLida).length

  const mem = sel?.contacts?.client_memory ?? {}
  const jan = janela(sel, agora)
  const primeiroNome = (sel?.contacts?.name ?? '').trim().split(/\s+/)[0] || 'concurseiro(a)'

  return (
    <div className="h-full flex">
      {/* Lista de conversas — no mobile some quando uma conversa está aberta */}
      <div className={`${sel ? 'hidden lg:flex' : 'flex'} w-full lg:w-80 shrink-0 border-r border-line flex-col`}>
        <div className="p-3 border-b border-line space-y-2">
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar nome ou telefone…"
            className="w-full bg-panel border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold/60 placeholder:text-dim/50" />
          <div className="flex gap-2">
            <select value={filtroAgente} onChange={e => setFiltroAgente(e.target.value)}
              className="flex-1 bg-panel border border-line rounded-lg px-2 py-1.5 text-xs text-dim focus:outline-none">
              <option value="">Todas mentorias</option>
              {Object.entries(AGENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
              className="flex-1 bg-panel border border-line rounded-lg px-2 py-1.5 text-xs text-dim focus:outline-none">
              <option value="">Todos status</option>
              {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <select value={filtroEtapa} onChange={e => setFiltroEtapa(e.target.value)}
            className="w-full bg-panel border border-line rounded-lg px-2 py-1.5 text-xs text-dim focus:outline-none">
            <option value="">Todas etapas do pipeline</option>
            {PIPELINE_COLS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <div className="flex gap-1.5 items-center">
            <span className="text-[10px] font-mono text-dim uppercase tracking-widest mr-1">Janela 24h</span>
            {([['', 'Todas'], ['aberta', '🟢 Aberta'], ['fechada', '🔴 Fechada']] as const).map(([v, lbl]) => (
              <button key={v} onClick={() => setFiltroJanela(v)}
                className={`text-[11px] px-2.5 py-1 rounded-lg border transition
                  ${filtroJanela === v ? 'border-gold/60 bg-gold/10 text-cream' : 'border-line text-dim hover:text-cream'}`}>
                {lbl}
              </button>
            ))}
            <button onClick={() => setSoNaoLidas(v => !v)}
              className={`ml-auto text-[11px] px-2.5 py-1 rounded-lg border transition
                ${soNaoLidas ? 'border-teal/60 bg-teal/10 text-teal' : 'border-line text-dim hover:text-cream'}`}
              title="Só conversas com resposta do lead que ninguém abriu ainda">
              🔔{totalNaoLidas > 0 ? ` ${totalNaoLidas}` : ''}
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {lista.map(c => {
            const etapa = ETAPA_CHIP[pipelineCol(c)]
            const unread = naoLida(c)
            // conversa com humano: a última mensagem é de saída = você já respondeu
            const vcRespondeu = comHumano(c.status) && ultimaEhSaida(c)
            return (
            <button key={c.id} onClick={() => { setSel(c); marcarLida(c) }}
              className={`w-full text-left px-4 py-3 border-b border-line/50 hover:bg-panel2/50 transition-colors
                ${sel?.id === c.id ? 'bg-panel2' : unread ? 'bg-teal/5' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <span className={`text-sm truncate ${unread ? 'font-semibold text-cream' : 'font-medium'}`}>
                  {unread && <span className="text-teal mr-1.5">●</span>}
                  {c.contacts?.name || fmtFone(c.contacts?.phone)}
                </span>
                <span className="font-mono text-[10px] text-dim shrink-0">{fmtHora(c.last_message_at)}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${STATUS_META[c.status]?.cls ?? ''}`}>
                  {STATUS_META[c.status]?.label ?? c.status}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-line text-dim">
                  {AGENT_LABEL[c.current_agent_slug] ?? c.current_agent_slug}
                </span>
                {etapa && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${etapa.cls}`}>{etapa.label}</span>
                )}
                {unread ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-teal/50 text-teal bg-teal/10">💬 lead respondeu</span>
                ) : comHumano(c.status) && c.last_user_message_at ? (
                  vcRespondeu
                    ? <span className="text-[10px] px-1.5 py-0.5 rounded border border-win/40 text-win bg-win/5">✓ você respondeu</span>
                    : <span className="text-[10px] px-1.5 py-0.5 rounded border border-gold/50 text-gold bg-gold/10">✋ falta responder</span>
                ) : null}
                <span title={janela(c, agora).aberta ? `Janela aberta · resta ${janela(c, agora).label}` : 'Janela de 24h fechada'}
                  className="text-[10px] ml-auto">{janela(c, agora).aberta ? '🟢' : '🔴'}</span>
              </div>
            </button>
            )
          })}
          {lista.length === 0 && <div className="p-6 text-center text-dim text-sm">Nenhuma conversa.</div>}
        </div>
      </div>

      {/* Thread */}
      <div className={`${sel ? 'flex' : 'hidden lg:flex'} flex-1 min-w-0 flex-col`}>
        {!sel ? (
          <div className="flex-1 grid place-items-center text-dim">
            <div className="text-center">
              <div className="text-4xl mb-3">💬</div>
              <div className="text-sm">Selecione uma conversa</div>
            </div>
          </div>
        ) : (
          <>
            <div className="px-3 md:px-5 py-3 border-b border-line flex items-center gap-2 md:gap-3">
              <button onClick={() => setSel(null)} className="lg:hidden text-dim hover:text-cream text-lg px-1 shrink-0">←</button>
              <div className="min-w-0">
                <div className="font-display font-semibold truncate">{sel.contacts?.name || 'Sem nome'}</div>
                <div className="font-mono text-[11px] text-dim">{fmtFone(sel.contacts?.phone)}</div>
              </div>
              <span className={`text-[11px] font-mono px-2 py-1 rounded-lg border shrink-0 ${
                jan.aberta ? 'text-win border-win/40 bg-win/10' : 'text-danger border-danger/40 bg-danger/10'}`}
                title={jan.aberta ? 'Tempo restante da janela de 24h (conversa livre)' : 'Sem conversa livre — envie um template p/ reabrir'}>
                {jan.aberta ? `🕐 ${jan.label}` : '🔒 Janela fechada'}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <button onClick={() => setInfoAberto(true)} title="Dados do lead"
                  className="xl:hidden text-xs text-dim border border-line rounded-lg px-2.5 py-1.5 hover:text-cream transition">ℹ️</button>
                {sel.status === 'humano_comercial' ? (
                  <span className="text-[11px] font-mono px-2.5 py-1.5 rounded-lg border border-gold/50 text-gold bg-gold/10"
                    title="Lead de posse de um vendedor do Comercial Humano — devolução e registro de ligações na aba ☎️ Comercial">
                    ☎️ Comercial Humano
                  </span>
                ) : sel.status === 'human' ? (
                  <button onClick={devolverIA}
                    className="text-xs font-semibold bg-teal/15 text-teal border border-teal/40 rounded-lg px-3 py-1.5 hover:bg-teal/25 transition">
                    ↩ Devolver para a IA
                  </button>
                ) : (
                  <button onClick={assumir}
                    className="text-xs font-semibold bg-gold/15 text-gold border border-gold/40 rounded-lg px-3 py-1.5 hover:bg-gold/25 transition">
                    ✋ Assumir conversa
                  </button>
                )}
                <button onClick={apagarConversa} title="Apagar conversa e zerar memória do lead"
                  className="text-xs text-danger/80 border border-danger/30 rounded-lg px-2.5 py-1.5 hover:bg-danger/10 hover:text-danger transition">
                  🗑
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-2">
              {msgTpl && !kb && (
                <div className="rise self-center text-xs rounded-lg border border-win/40 bg-win/10 text-win px-3 py-2">{msgTpl}</div>
              )}
              {msgs.map(m => (
                <div key={m.id} className={`rise max-w-[78%] border rounded-2xl px-3.5 py-2 ${FROM_STYLE[m.from_type] ?? FROM_STYLE.system}`}>
                  {m.metadata?.followup_step && (
                    <div className="text-[10px] font-mono text-gold/80 mb-1">⏰ follow-up · toque {m.metadata.followup_step}</div>
                  )}
                  {m.type === 'audio' && (
                    <div className="text-[10px] font-mono text-dim mb-1">
                      🎙 {m.from_type === 'human' ? 'áudio do atendente' : 'áudio transcrito'}
                    </div>
                  )}
                  {m.metadata?.audio_url && (
                    <audio controls preload="none" src={m.metadata.audio_url} className="my-1 h-9 max-w-full" />
                  )}
                  {m.type === 'template' && (
                    <div className="text-[10px] font-mono text-teal/80 mb-1">
                      📨 template{m.metadata?.janela_reaberta ? ' · reabertura de janela' : m.metadata?.broadcast ? ' · disparo' : ''}
                    </div>
                  )}
                  <div className="text-sm whitespace-pre-wrap break-words">{m.transcript || m.content}</div>
                  <div className="text-[10px] font-mono text-dim/70 mt-1 text-right flex items-center justify-end gap-2">
                    {/* KB é conhecimento permanente de TODAS as conversas — inclusão só de admin (migration 20; RLS bloqueia por qualquer via) */}
                    {isAdmin && (
                      <button onClick={() => abrirKb(m)} title="Adicionar à base de conhecimento do agente"
                        className="opacity-40 hover:opacity-100 transition">📚</button>
                    )}
                    <span>{m.from_type === 'ia' ? '🤖 ' : m.from_type === 'human' ? '👤 ' : ''}{fmtHora(m.created_at)}</span>
                  </div>
                </div>
              ))}
              <div ref={fimRef} />
            </div>

            {jan.aberta ? (
              audioPronto ? (
                <div className="p-4 border-t border-line flex items-center gap-2">
                  <audio controls src={audioPronto.url} className="flex-1 h-10 min-w-0" />
                  <button onClick={descartarAudio} title="Descartar gravação"
                    className="text-sm text-danger/80 border border-danger/30 rounded-xl px-3 py-2.5 hover:bg-danger/10 transition">🗑</button>
                  <button onClick={enviarAudio} disabled={enviando}
                    className="bg-gold text-ink font-semibold rounded-xl px-4 py-2.5 text-sm disabled:opacity-40 hover:brightness-110 transition">
                    {enviando ? 'Enviando…' : '🎤 Enviar áudio'}
                  </button>
                </div>
              ) : gravando ? (
                <div className="p-4 border-t border-line flex items-center gap-3">
                  <span className="text-danger text-sm font-semibold pulse-danger">● Gravando</span>
                  <span className="font-mono text-sm text-dim">
                    {Math.floor(gravSeg / 60)}:{String(gravSeg % 60).padStart(2, '0')}
                  </span>
                  <div className="ml-auto flex gap-2">
                    <button onClick={() => pararGravacao(false)}
                      className="text-sm text-dim border border-line rounded-xl px-4 py-2.5 hover:text-danger hover:border-danger/40 transition">✕ Cancelar</button>
                    <button onClick={() => pararGravacao(true)}
                      className="bg-gold text-ink font-semibold rounded-xl px-4 py-2.5 text-sm hover:brightness-110 transition">✔ Parar e ouvir</button>
                  </div>
                </div>
              ) : (
              <form onSubmit={enviar} className="p-4 border-t border-line flex gap-2">
                <input value={texto} onChange={e => setTexto(e.target.value)}
                  placeholder={comHumano(sel.status) ? 'Responder como humano…' : 'Assuma a conversa para responder (IA está atendendo)'}
                  disabled={!comHumano(sel.status)}
                  className="flex-1 bg-panel border border-line rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-gold/60 disabled:opacity-40 placeholder:text-dim/50" />
                <button type="button" onClick={gravar} disabled={!comHumano(sel.status)}
                  title="Gravar áudio para o lead (vira nota de voz no WhatsApp)"
                  className="border border-line text-dim rounded-xl px-3.5 text-lg disabled:opacity-30 hover:text-gold hover:border-gold/40 transition">🎤</button>
                <button disabled={!comHumano(sel.status) || !texto.trim() || enviando}
                  className="bg-gold text-ink font-semibold rounded-xl px-5 text-sm disabled:opacity-30 hover:brightness-110 transition">
                  Enviar
                </button>
              </form>
              )
            ) : (
              <div className="p-4 border-t border-line space-y-2">
                {msgTpl && <div className="rise text-xs rounded-lg border border-line bg-panel px-3 py-2">{msgTpl}</div>}
                {!comHumano(sel.status) ? (
                  <div className="text-xs text-dim text-center py-1">
                    🔒 Janela de 24h fechada — <b className="text-cream">assuma a conversa</b> para reabrir com um template aprovado.
                  </div>
                ) : (
                  <>
                    <div className="text-[11px] text-dim">
                      🔒 Janela fechada (o lead não manda mensagem há mais de 24h). A Meta só permite <b className="text-cream">template
                      aprovado</b> — escolha um abaixo para reabrir a conversa:
                    </div>
                    <div className="flex gap-2">
                      <select value={selTplName} onChange={e => setSelTplName(e.target.value)}
                        className="flex-1 bg-panel border border-line rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gold/60">
                        <option value="">{tpls.length ? 'Escolha o template…' : 'Carregando templates…'}</option>
                        {tpls.map(t => <option key={t.name} value={t.name}>[{t.category}] {t.name}</option>)}
                      </select>
                      <button onClick={enviarTemplate} disabled={!selTplName || enviandoTpl}
                        className="bg-gold text-ink font-semibold rounded-xl px-5 text-sm disabled:opacity-30 hover:brightness-110 transition">
                        {enviandoTpl ? 'Enviando…' : '📨 Enviar template'}
                      </button>
                    </div>
                    {selTplName && (
                      <div className="text-[11px] text-dim border border-teal/25 bg-teal/5 rounded-lg px-3 py-2 whitespace-pre-wrap">
                        {(tpls.find(t => t.name === selTplName)?.body ?? '').split('{{1}}').join(primeiroNome)}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Gaveta: adicionar balão à base de conhecimento */}
      {kb && (
        <>
          <div className="fixed inset-0 z-40 bg-ink/60" onClick={() => setKb(null)} />
          <div className="fixed inset-y-0 right-0 z-50 w-[26rem] max-w-[92vw] bg-panel border-l border-line shadow-2xl overflow-y-auto p-5 space-y-3">
            <div className="flex items-center">
              <h2 className="font-display font-semibold">📚 Adicionar à base de conhecimento</h2>
              <button onClick={() => setKb(null)} className="ml-auto text-dim hover:text-cream text-xl leading-none">✕</button>
            </div>
            <p className="text-[11px] text-dim leading-relaxed">
              Revise o conteúdo antes de enviar — vira conhecimento permanente e a Anne passa a usar em TODAS as conversas do agente.
            </p>
            <label className="block text-xs text-dim">Agente de destino
              <select className="w-full mt-1 bg-panel2 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold/60"
                value={kb.agent} onChange={e => setKb({ ...kb, agent: e.target.value })}>
                <option value="">Selecione…</option>
                {kbAgentes.map(a => <option key={a.slug} value={a.slug}>{a.name}</option>)}
              </select>
            </label>
            <label className="block text-xs text-dim">Título do documento
              <input className="w-full mt-1 bg-panel2 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold/60"
                value={kb.title} onChange={e => setKb({ ...kb, title: e.target.value })} />
            </label>
            <label className="block text-xs text-dim">Tipo da informação
              <select className="w-full mt-1 bg-panel2 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold/60"
                value={kb.doc_type} onChange={e => setKb({ ...kb, doc_type: e.target.value })}>
                <option value="faq">FAQ</option><option value="mentoria">Mentoria</option>
                <option value="edital">Edital / concurso</option><option value="outro">Outro</option>
              </select>
            </label>
            <label className="block text-xs text-dim">Conteúdo
              <textarea rows={12} className="w-full mt-1 bg-panel2 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold/60"
                value={kb.content} onChange={e => setKb({ ...kb, content: e.target.value })} />
            </label>
            <button onClick={enviarKb} disabled={kbEnviando || !kb.title.trim() || !kb.content.trim() || !kb.agent}
              className="w-full bg-teal/15 text-teal border border-teal/40 font-semibold rounded-lg py-2.5 text-sm hover:bg-teal/25 transition disabled:opacity-40">
              {kbEnviando ? 'Enviando…' : 'Enviar para a base →'}
            </button>
          </div>
        </>
      )}

      {/* Painel do lead — fixo no desktop largo; slide-over nas telas menores */}
      {sel && infoAberto && (
        <div className="xl:hidden fixed inset-0 z-40 bg-ink/60" onClick={() => setInfoAberto(false)} />
      )}
      {sel && (
        <div className={`${infoAberto
            ? 'fixed inset-y-0 right-0 z-50 w-80 max-w-[85vw] bg-panel shadow-2xl'
            : 'hidden'} xl:static xl:block xl:w-72 xl:z-auto xl:shadow-none xl:bg-transparent shrink-0 border-l border-line overflow-y-auto p-4 space-y-4`}>
          <button onClick={() => setInfoAberto(false)}
            className="xl:hidden text-dim hover:text-cream text-lg float-right leading-none">✕</button>
          <div>
            <div className="text-[10px] font-mono text-dim uppercase tracking-widest mb-2">Lead</div>
            <div className="font-display font-semibold text-lg">{sel.contacts?.name || '—'}</div>
            <div className="font-mono text-xs text-dim mt-0.5">{fmtFone(sel.contacts?.phone)}</div>
          </div>
          {followup && (
            <div className="border border-gold/25 bg-gold/5 rounded-xl p-3">
              <div className="text-[10px] font-mono text-gold uppercase tracking-widest">Follow-up armado</div>
              <div className="text-sm mt-1">Toque <b>{followup.current_step}</b> · {fmtHora(followup.due_at)}</div>
            </div>
          )}
          {(sel.contacts?.tags?.length ?? 0) > 0 && (
            <div>
              <div className="text-[10px] font-mono text-dim uppercase tracking-widest mb-2">Tags</div>
              <div className="flex flex-wrap gap-1.5">
                {sel.contacts.tags.map(t => (
                  <span key={t} className="text-[11px] px-2 py-0.5 rounded-full border border-teal/30 text-teal bg-teal/5">{t}</span>
                ))}
              </div>
            </div>
          )}
          {mem.fase_venda && (
            <div className="border border-teal/25 bg-teal/5 rounded-xl p-3">
              <div className="text-[10px] font-mono text-teal uppercase tracking-widest">Fase de venda</div>
              <div className="text-sm mt-1 font-medium">
                {['1 · Situação', '2 · Problema', '3 · Valor', '4 · Oferta'][mem.fase_venda - 1] ?? mem.fase_venda}
              </div>
            </div>
          )}
          {mem.lead_stage && (
            <div>
              <div className="text-[10px] font-mono text-dim uppercase tracking-widest mb-1">Estágio</div>
              <div className="text-sm text-gold font-medium">{mem.lead_stage}</div>
            </div>
          )}
          {(mem.interesses?.length ?? 0) > 0 && (
            <div>
              <div className="text-[10px] font-mono text-dim uppercase tracking-widest mb-1">Interesses</div>
              <div className="text-sm text-dim">{mem.interesses.join(', ')}</div>
            </div>
          )}
          {(mem.objections?.length ?? 0) > 0 && (
            <div>
              <div className="text-[10px] font-mono text-dim uppercase tracking-widest mb-1">Objeções</div>
              <div className="text-sm text-dim">{mem.objections.join(', ')}</div>
            </div>
          )}
          {mem.notas && (
            <div>
              <div className="text-[10px] font-mono text-dim uppercase tracking-widest mb-1">Notas da IA</div>
              <div className="text-sm text-dim leading-relaxed">{mem.notas}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
