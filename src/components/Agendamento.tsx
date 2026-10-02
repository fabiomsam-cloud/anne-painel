// anne/painel/src/components/Agendamento.tsx
import { useEffect, useMemo, useState } from 'react'
import { supabase, AGENT_LABEL, fmtFone } from '../lib/supabase'
import { FRENTE_LABEL } from '../lib/folha'
import {
  listas, placar, grupos, calendario, mensagemErro, ddmm, hojeManaus, maisDias, STATUS_LABEL, ORIGEM_LABEL,
  type PainelAg, type Agendamento as Ag, type Grupo,
} from '../lib/agendamento'
import AgendarModal from './AgendarModal'

// 🗓 Agendamento — leads que combinaram uma data para a matrícula. Dados: RPC fn_agendamento_painel (migration 38c).
// Listas = o que está em aberto agora. Placar e funil = coorte pela data combinada dentro do período.

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)}%`)
type Aba = 'hoje' | 'atrasados' | 'proximos' | 'semData'
const ABAS: { id: Aba; label: string }[] = [
  { id: 'hoje', label: 'Hoje' }, { id: 'atrasados', label: 'Atrasados' },
  { id: 'proximos', label: 'Próximos 7 dias' }, { id: 'semData', label: 'Sem data' },
]

function Kpi({ label, valor, hint, destaque }: { label: string; valor: string; hint?: string; destaque?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${destaque ? 'border-gold/50 bg-gold/10' : 'border-line bg-panel'}`}>
      <div className="text-[11px] text-dim">{label}</div>
      <div className={`font-display font-bold text-xl ${destaque ? 'text-gold' : 'text-cream'}`}>{valor}</div>
      {hint && <div className="text-[10px] text-dim mt-0.5">{hint}</div>}
    </div>
  )
}

function TabelaGrupo({ titulo, linhas, rotulo }: { titulo: string; linhas: Grupo[]; rotulo: (k: string) => string }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-3 overflow-x-auto">
      <div className="text-xs font-semibold text-cream mb-2">{titulo}</div>
      <table className="w-full text-xs">
        <thead><tr className="text-dim text-left">
          <th className="py-1 pr-2 font-normal"> </th><th className="px-2 font-normal text-right">Agendados</th>
          <th className="px-2 font-normal text-right">Matricularam</th><th className="px-2 font-normal text-right">Não cumpriram</th>
          <th className="px-2 font-normal text-right">Em aberto</th><th className="pl-2 font-normal text-right">Receita líquida</th>
        </tr></thead>
        <tbody>
          {linhas.map(g => (
            <tr key={g.chave} className="border-t border-line">
              <td className="py-1.5 pr-2 text-cream">{rotulo(g.chave)}</td>
              <td className="px-2 text-right font-mono">{g.agendados}</td>
              <td className="px-2 text-right font-mono text-win">{g.matricularam}</td>
              <td className="px-2 text-right font-mono">{g.naoCumpriram}</td>
              <td className="px-2 text-right font-mono">{g.emAberto}</td>
              <td className="pl-2 text-right font-mono">{brl(g.liquido)}</td>
            </tr>
          ))}
          {!linhas.length && <tr><td colSpan={6} className="py-3 text-dim">Nenhum agendamento com data neste período.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

export default function Agendamento({ irParaInbox }: { irParaInbox: (convId: string) => void }) {
  const [ini, setIni] = useState(() => maisDias(hojeManaus(), -30))
  const [fim, setFim] = useState(() => hojeManaus())
  const [dados, setDados] = useState<PainelAg | null>(null)
  const [erro, setErro] = useState('')
  const [aba, setAba] = useState<Aba>('hoje')
  const [editando, setEditando] = useState<Ag | null>(null)

  const carregar = async () => {
    const { data, error } = await supabase.rpc('fn_agendamento_painel', { p_ini: ini, p_fim: fim })
    if (error) { setErro(error.message); return }
    setErro(''); setDados(data as PainelAg)
  }
  useEffect(() => { carregar(); const t = setInterval(carregar, 60_000); return () => clearInterval(t) }, [ini, fim])

  const l = useMemo(() => (dados ? listas(dados.linhas, dados.hoje) : null), [dados])
  const p = useMemo(() => (dados ? placar(dados) : null), [dados])
  const frentes = useMemo(() => (dados ? grupos(dados, 'frente') : []), [dados])
  const origens = useMemo(() => (dados ? grupos(dados, 'origem') : []), [dados])
  const cal = useMemo(() => (dados ? calendario(dados.linhas, dados.hoje, 30) : []), [dados])

  const cancelar = async (a: Ag) => {
    const motivo = window.prompt(`Cancelar o agendamento de ${a.nome || fmtFone(a.phone)}? Informe o motivo:`)
    if (motivo == null) return
    const { data, error } = await supabase.rpc('fn_agendamento_cancelar', { p_id: a.id, p_motivo: motivo })
    const r = (data as any) ?? {}
    if (error || !r.ok) { setErro(mensagemErro(error?.message || r.erro)); return }
    carregar()
  }

  if (!dados || !l || !p) return <div className="h-full grid place-items-center text-dim font-mono text-sm">{erro || 'carregando…'}</div>
  const linhas = l[aba]
  const conta: Record<Aba, number> = { hoje: l.hoje.length, atrasados: l.atrasados.length, proximos: l.proximos.length, semData: l.semData.length }
  const maxCal = Math.max(1, ...cal.map(c => c.n))

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="font-display font-bold text-xl">🗓 Agendamento</h1>
        <span className={`text-[11px] font-mono px-2 py-1 rounded-lg border ${dados.ativo ? 'text-win border-win/40 bg-win/10' : 'text-dim border-line bg-panel2'}`}>
          {dados.ativo ? 'régua ligada' : 'régua desligada'}</span>
        <div className="ml-auto flex items-center gap-2 text-xs text-dim">
          período da coorte
          <input type="date" value={ini} max={fim} onChange={e => setIni(e.target.value)} className="bg-panel2 border border-line rounded-lg px-2 py-1 text-cream" />
          até
          <input type="date" value={fim} min={ini} onChange={e => setFim(e.target.value)} className="bg-panel2 border border-line rounded-lg px-2 py-1 text-cream" />
          <button onClick={carregar} className="border border-line rounded-lg px-2.5 py-1 hover:text-cream transition">↻ Atualizar</button>
        </div>
      </div>
      {erro && <div className="text-sm text-danger">⚠️ {erro}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <Kpi label="Agendados em aberto" valor={String(p.abertos)} hint={`${p.semData} sem data`} />
        <Kpi label="Para hoje" valor={String(p.paraHoje)} />
        <Kpi label="Atrasados" valor={String(p.atrasados)} hint="data passou e segue em aberto" />
        <Kpi label="Taxa de confirmação" valor={pct(p.taxaConfirmacao)} hint={`${p.confirmaram} de ${p.ativados} ativados`} />
        <Kpi label="Taxa de matrícula" valor={pct(p.taxaMatricula)} hint={`${p.maduros} maduros (data + ${dados.prazo_dias} dias)`} />
        <Kpi label="Receita líquida" valor={brl(p.receitaLiquida)} destaque
          hint={p.semLiquido ? `${p.semLiquido} matrícula(s) ainda sem o líquido` : `${p.matricularam} matrícula(s)`} />
        <Kpi label="Custo dos templates" valor={brl(p.custoTemplates)} />
      </div>

      <div className="rounded-xl border border-line bg-panel">
        <div className="flex gap-1 p-2 border-b border-line flex-wrap">
          {ABAS.map(t => (
            <button key={t.id} onClick={() => setAba(t.id)}
              className={`text-xs rounded-lg px-3 py-1.5 border transition ${aba === t.id ? 'border-gold/50 bg-gold/15 text-gold' : 'border-transparent text-dim hover:text-cream'}`}>
              {t.label} <span className="font-mono">{conta[t.id]}</span>
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-dim text-left">
              <th className="px-3 py-2 font-normal">Lead</th><th className="px-2 font-normal">Concurso</th><th className="px-2 font-normal">Data</th>
              <th className="px-2 font-normal">Situação</th><th className="px-2 font-normal">Quem agendou</th><th className="px-2 font-normal">Combinado</th>
              <th className="px-3 font-normal text-right">Ações</th>
            </tr></thead>
            <tbody>
              {linhas.map(a => (
                <tr key={a.id} className="border-t border-line align-top">
                  <td className="px-3 py-2">
                    <div className="text-cream">{a.nome || 'Sem nome'}</div>
                    <div className="font-mono text-[10px] text-dim">{fmtFone(a.phone)}</div>
                  </td>
                  <td className="px-2 py-2">{AGENT_LABEL[a.agent_slug] ?? a.agent_slug}</td>
                  <td className="px-2 py-2 font-mono">
                    {a.data ? ddmm(a.data) : a.data_sugerida ? <span className="text-dim">sugerida {ddmm(a.data_sugerida)}</span> : '—'}
                    {a.remarcacoes > 0 && <div className="text-[10px] text-dim">remarcou ×{a.remarcacoes}</div>}
                  </td>
                  <td className="px-2 py-2">
                    {STATUS_LABEL[a.status]}
                    {a.ultimo_erro && <div className="text-[10px] text-danger" title={a.ultimo_erro}>⚠️ {a.ultimo_erro.slice(0, 40)}</div>}
                  </td>
                  <td className="px-2 py-2">{ORIGEM_LABEL[a.origem] ?? a.origem}{a.criado_por && <div className="text-[10px] text-dim">{a.criado_por.split('@')[0]}</div>}</td>
                  <td className="px-2 py-2 max-w-[260px]">{[a.forma, a.obs].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1 justify-end flex-wrap">
                      <button onClick={() => irParaInbox(a.conversation_id)} className="border border-line text-dim rounded-lg px-2 py-1 hover:text-cream transition">💬 Inbox</button>
                      <button onClick={() => setEditando(a)} className="border border-gold/40 text-gold rounded-lg px-2 py-1 hover:bg-gold/10 transition">
                        {a.status === 'sem_data' ? '🗓 Definir data' : '✏️ Data'}</button>
                      <button onClick={() => cancelar(a)} className="border border-danger/30 text-danger/80 rounded-lg px-2 py-1 hover:bg-danger/10 transition">✕</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!linhas.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-dim">Nada nesta lista.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-panel p-3">
        <div className="text-xs font-semibold text-cream mb-2">Funil do período · coorte pela data combinada ({ddmm(dados.ini)} a {ddmm(dados.fim)})</div>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2 text-center">
          {[['Agendados', p.agendados], ['Template enviado', p.ativados], ['Confirmaram', p.confirmaram], ['Matricularam', p.matricularam],
            ['Remarcaram', p.remarcaram], ['Não cumpriram', p.naoCumpriram], ['Em aberto', p.emAberto], ['Cancelados', p.cancelados]].map(([k, v]) => (
            <div key={k as string} className="rounded-lg border border-line bg-panel2 py-2">
              <div className="font-display font-bold text-lg text-cream">{v}</div>
              <div className="text-[10px] text-dim">{k}</div>
            </div>
          ))}
        </div>
        <div className="text-[10px] text-dim mt-2">Matrícula antes da data conta como matriculado mesmo sem template. Remarcaram = já remarcaram ao menos uma vez.</div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <TabelaGrupo titulo="Por frente" linhas={frentes} rotulo={k => FRENTE_LABEL[k] ?? k} />
        <TabelaGrupo titulo="Por origem" linhas={origens} rotulo={k => ORIGEM_LABEL[k] ?? k} />
      </div>

      <div className="rounded-xl border border-line bg-panel p-3">
        <div className="text-xs font-semibold text-cream mb-2">Próximos 30 dias · agendamentos em aberto por dia</div>
        <div className="flex items-end gap-1 h-24">
          {cal.map(c => (
            <div key={c.dia} className="flex-1 flex flex-col items-center justify-end h-full" title={`${ddmm(c.dia)}: ${c.n}`}>
              {c.n > 0 && <div className="text-[9px] font-mono text-dim">{c.n}</div>}
              <div className={`w-full rounded-sm ${c.n ? 'bg-gold/60' : 'bg-line'}`} style={{ height: `${c.n ? Math.max(8, (c.n / maxCal) * 100) : 2}%` }} />
              <div className="text-[8px] font-mono text-dim mt-1">{c.dia.slice(8, 10)}</div>
            </div>
          ))}
        </div>
      </div>

      {editando && (
        <AgendarModal conversationId={editando.conversation_id} nome={editando.nome || fmtFone(editando.phone)}
          dataInicial={editando.data ?? editando.data_sugerida}
          onClose={() => setEditando(null)} onOk={() => { setEditando(null); carregar() }} />
      )}
    </div>
  )
}
