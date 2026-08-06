import { createClient } from '@supabase/supabase-js'

// Chave publishable (pública por design). A segurança do painel vem do
// Supabase Auth (magic link) + RLS fn_is_operator() no banco.
export const supabase = createClient(
  'https://blwbbdcwdcwitsnskplk.supabase.co',
  'sb_publishable_kfJ3pGohrm4tr_gn5KffCQ_flMg1aYr',
)

export const AGENT_LABEL: Record<string, string> = {
  roteador: 'Triagem',
  elite_prf: 'Elite PRF',
  elite_tjam: 'Elite TJ-AM',
  elite_prf_adm: 'Elite PRF Adm',
}

// Completa o AGENT_LABEL com os agentes cadastrados no banco — agente novo
// aparece nos filtros sem precisar mexer no código. Os apelidos acima têm
// prioridade; para os demais, deriva um rótulo curto a partir do name.
export async function carregarAgentLabels() {
  const { data } = await supabase.from('agent_profiles').select('slug,name')
  for (const a of data ?? []) {
    if (!AGENT_LABEL[a.slug]) AGENT_LABEL[a.slug] = (a.name ?? a.slug).replace(/^Especialista\s+/i, '')
  }
}

export const STATUS_META: Record<string, { label: string; cls: string }> = {
  ia: { label: 'IA atendendo', cls: 'text-teal border-teal/40 bg-teal/10' },
  human: { label: 'Com humano', cls: 'text-gold border-gold/40 bg-gold/10' },
  humano_comercial: { label: '☎️ Comercial Humano', cls: 'text-gold border-gold/50 bg-gold/15' },
  paused: { label: 'Pausada', cls: 'text-dim border-line bg-panel2' },
  won: { label: 'Matriculado 🏆', cls: 'text-win border-win/40 bg-win/10' },
  dormant: { label: 'Dormente', cls: 'text-dim border-line bg-panel2' },
  opted_out: { label: 'Opt-out', cls: 'text-danger border-danger/40 bg-danger/10' },
}

// etapas do Pipeline (Kanban) — mesma derivação usada no filtro do Inbox
export const PIPELINE_COLS = [
  { id: 'novo', label: 'Novos', hint: 'sem checkout, em triagem/conversa', cor: 'border-t-teal' },
  { id: 'negociando', label: 'Negociando', hint: 'qualificado pela IA', cor: 'border-t-gold' },
  { id: 'checkout', label: 'Checkout enviado', hint: 'link de matrícula na mão', cor: 'border-t-gold' },
  { id: 'humano', label: 'Com humano', hint: 'escalados', cor: 'border-t-danger' },
  { id: 'matriculado', label: 'Matriculados 🏆', hint: 'venda confirmada', cor: 'border-t-win' },
  { id: 'dormente', label: 'Dormentes', hint: 'cadência esgotada / opt-out', cor: 'border-t-line' },
]

// coluna manual (arrastada pelo humano) vence a derivação automática
export function pipelineCol(c: { status: string; contacts?: { tags?: string[] | null; client_memory?: any } | null }): string {
  const override = c.contacts?.client_memory?.kanban_override
  if (override && PIPELINE_COLS.some(col => col.id === override)) return override
  if (c.status === 'won') return 'matriculado'
  if (c.status === 'human' || c.status === 'humano_comercial') return 'humano'
  if (c.status === 'dormant' || c.status === 'opted_out') return 'dormente'
  if ((c.contacts?.tags ?? []).includes('checkout_enviado')) return 'checkout'
  const stage = c.contacts?.client_memory?.lead_stage
  if (stage === 'negociando' || stage === 'quase_fechando' || stage === 'qualificado') return 'negociando'
  return 'novo'
}

export function fmtHora(ts?: string | null) {
  if (!ts) return ''
  return new Date(ts).toLocaleString('pt-BR', {
    timeZone: 'America/Manaus', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export function fmtFone(p?: string | null) {
  const d = String(p || '').replace(/\D/g, '')
  if (d.length >= 12) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, -4)}-${d.slice(-4)}`
  return p || ''
}
