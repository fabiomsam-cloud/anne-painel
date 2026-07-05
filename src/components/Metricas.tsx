import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Num = number | null

function Card({ titulo, valor, sub, destaque }: { titulo: string; valor: string; sub?: string; destaque?: boolean }) {
  return (
    <div className={`rise border rounded-xl p-4 ${destaque ? 'border-gold/40 bg-gold/5' : 'border-line bg-panel/50'}`}>
      <div className="text-[10px] font-mono text-dim uppercase tracking-widest">{titulo}</div>
      <div className={`font-display font-bold text-3xl mt-1.5 ${destaque ? 'text-gold' : ''}`}>{valor}</div>
      {sub && <div className="text-[11px] text-dim mt-1">{sub}</div>}
    </div>
  )
}

export default function Metricas() {
  const [m, setM] = useState<Record<string, Num>>({})
  const [dias, setDias] = useState(7)

  useEffect(() => {
    const desde = new Date(Date.now() - dias * 86400000).toISOString()
    const count = async (tabela: string, filtro: (q: any) => any): Promise<Num> => {
      const { count } = await filtro(supabase.from(tabela).select('*', { count: 'exact', head: true }))
      return count
    }
    ;(async () => {
      const [leads, msgsIn, msgsIa, escAbertas, escTotal, checkouts, vendas, fuEnviados, fuRespondidos, matriculados] =
        await Promise.all([
          count('contacts', q => q.gte('created_at', desde)),
          count('messages', q => q.eq('from_type', 'user').gte('created_at', desde)),
          count('messages', q => q.eq('from_type', 'ia').gte('created_at', desde)),
          count('escalations', q => q.eq('status', 'open')),
          count('escalations', q => q.gte('created_at', desde)),
          count('events_outbox', q => q.eq('event_type', 'checkout_enviado').gte('created_at', desde)),
          count('sales', q => q.neq('matched_by', 'unmatched').gte('created_at', desde)),
          count('followup_log', q => q.gte('sent_at', desde)),
          count('followup_log', q => q.eq('replied', true).gte('sent_at', desde)),
          count('conversations', q => q.eq('status', 'won')),
        ])
      setM({ leads, msgsIn, msgsIa, escAbertas, escTotal, checkouts, vendas, fuEnviados, fuRespondidos, matriculados })
    })()
  }, [dias])

  const pct = (a: Num, b: Num) => (b && a != null ? `${Math.round((a / b) * 100)}%` : '—')
  const n = (v: Num) => (v == null ? '…' : String(v))

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6 max-w-4xl">
        <h1 className="font-display font-bold text-2xl">Métricas</h1>
        <div className="flex gap-1 border border-line rounded-lg p-1">
          {[1, 7, 30].map(d => (
            <button key={d} onClick={() => setDias(d)}
              className={`text-xs px-3 py-1 rounded-md transition ${dias === d ? 'bg-gold text-ink font-semibold' : 'text-dim hover:text-cream'}`}>
              {d === 1 ? 'Hoje' : `${d} dias`}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-w-4xl">
        <Card titulo="Leads novos" valor={n(m.leads)} />
        <Card titulo="Msgs recebidas" valor={n(m.msgsIn)} />
        <Card titulo="Respostas da IA" valor={n(m.msgsIa)} sub={`taxa de resposta ${pct(m.msgsIa, m.msgsIn)}`} />
        <Card titulo="Escalações abertas" valor={n(m.escAbertas)} sub={`${n(m.escTotal)} no período`} />
        <Card titulo="Checkouts enviados" valor={n(m.checkouts)} destaque />
        <Card titulo="Vendas confirmadas" valor={n(m.vendas)} sub={`conversão ${pct(m.vendas, m.leads)} dos leads`} destaque />
        <Card titulo="Matriculados (total)" valor={n(m.matriculados)} destaque />
        <Card titulo="Follow-ups enviados" valor={n(m.fuEnviados)} sub={`recuperados ${pct(m.fuRespondidos, m.fuEnviados)}`} />
      </div>

      <p className="text-[11px] text-dim/60 mt-6 max-w-xl leading-relaxed">
        Vendas confirmadas dependem da integração com a Hubla (fase F8). Métricas agregadas por mentoria
        e histórico diário entram com o housekeeping (F10).
      </p>
    </div>
  )
}
