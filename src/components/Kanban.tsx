import { useEffect, useState } from 'react'
import { supabase, AGENT_LABEL, fmtHora, fmtFone } from '../lib/supabase'

type Conv = {
  id: string; status: string; current_agent_slug: string; last_message_at: string | null; created_at: string
  contacts: { name: string | null; phone: string; tags: string[]; client_memory: any }
}

const COLS = [
  { id: 'novo', label: 'Novos', hint: 'sem checkout, em triagem/conversa', cor: 'border-t-teal' },
  { id: 'negociando', label: 'Negociando', hint: 'qualificado pela IA', cor: 'border-t-gold' },
  { id: 'checkout', label: 'Checkout enviado', hint: 'link de matrícula na mão', cor: 'border-t-gold' },
  { id: 'humano', label: 'Com humano', hint: 'escalados', cor: 'border-t-danger' },
  { id: 'matriculado', label: 'Matriculados 🏆', hint: 'venda confirmada', cor: 'border-t-win' },
  { id: 'dormente', label: 'Dormentes', hint: 'cadência esgotada / opt-out', cor: 'border-t-line' },
]

function coluna(c: Conv): string {
  if (c.status === 'won') return 'matriculado'
  if (c.status === 'human') return 'humano'
  if (c.status === 'dormant' || c.status === 'opted_out') return 'dormente'
  if ((c.contacts?.tags ?? []).includes('checkout_enviado')) return 'checkout'
  const stage = c.contacts?.client_memory?.lead_stage
  if (stage === 'negociando' || stage === 'quase_fechando' || stage === 'qualificado') return 'negociando'
  return 'novo'
}

export default function Kanban() {
  const [convs, setConvs] = useState<Conv[]>([])
  const carregar = async () => {
    const { data } = await supabase
      .from('conversations')
      .select('id,status,current_agent_slug,last_message_at,created_at,contacts(name,phone,tags,client_memory)')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(400)
    setConvs((data as any) ?? [])
  }
  useEffect(() => {
    carregar()
    const ch = supabase.channel('kanban')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, carregar)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  return (
    <div className="h-full overflow-x-auto p-6">
      <h1 className="font-display font-bold text-2xl mb-5">Pipeline</h1>
      <div className="flex gap-4 min-h-[70vh]">
        {COLS.map(col => {
          const items = convs.filter(c => coluna(c) === col.id)
          return (
            <div key={col.id} className={`w-64 shrink-0 bg-panel/50 border border-line ${col.cor} border-t-2 rounded-xl flex flex-col`}>
              <div className="px-3.5 py-3 border-b border-line">
                <div className="flex items-baseline justify-between">
                  <span className="font-display font-semibold text-sm">{col.label}</span>
                  <span className="font-mono text-xs text-dim">{items.length}</span>
                </div>
                <div className="text-[10px] text-dim/70 mt-0.5">{col.hint}</div>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {items.map(c => (
                  <div key={c.id} className="rise bg-panel2 border border-line rounded-lg p-3">
                    <div className="font-medium text-sm truncate">{c.contacts?.name || fmtFone(c.contacts?.phone)}</div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-line text-dim">
                        {AGENT_LABEL[c.current_agent_slug] ?? c.current_agent_slug}
                      </span>
                      <span className="font-mono text-[10px] text-dim/70">{fmtHora(c.last_message_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
