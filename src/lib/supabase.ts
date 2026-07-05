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
}

export const STATUS_META: Record<string, { label: string; cls: string }> = {
  ia: { label: 'IA atendendo', cls: 'text-teal border-teal/40 bg-teal/10' },
  human: { label: 'Com humano', cls: 'text-gold border-gold/40 bg-gold/10' },
  paused: { label: 'Pausada', cls: 'text-dim border-line bg-panel2' },
  won: { label: 'Matriculado 🏆', cls: 'text-win border-win/40 bg-win/10' },
  dormant: { label: 'Dormente', cls: 'text-dim border-line bg-panel2' },
  opted_out: { label: 'Opt-out', cls: 'text-danger border-danger/40 bg-danger/10' },
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
