// anne/painel/src/lib/agendamento.ts
// Lógica PURA do menu 🗓 Agendamento (sem React nem Supabase). Testes: node --test src/lib/agendamento.test.ts
// Dados: RPC fn_agendamento_painel (migration 38c). Spec: anne/specs/2026-10-02-anne-agendamento-design.md

export type StatusAg = 'sem_data' | 'agendado' | 'ativado' | 'confirmado' | 'matriculado' | 'nao_cumpriu' | 'cancelado'
export type Agendamento = {
  id: string; conversation_id: string; nome: string; phone: string; agent_slug: string; frente: string
  data: string | null; data_sugerida: string | null; status: StatusAg; origem: 'anne' | 'time' | 'qualificacao'
  criado_por: string | null; forma: string | null; obs: string | null
  remarcacoes: number; tentativas: number; templates: number; ultimo_erro: string | null
  ativado_em: string | null; confirmado_em: string | null; fechado_em: string | null; created_at: string
  liquido: number | null; valor: number | null
}
export type PainelAg = { hoje: string; ini: string; fim: string; tarifa: number; prazo_dias: number; ativo: boolean; linhas: Agendamento[] }

export const ABERTOS: StatusAg[] = ['sem_data', 'agendado', 'ativado', 'confirmado']
export const STATUS_LABEL: Record<StatusAg, string> = {
  sem_data: 'Sem data', agendado: 'Agendado', ativado: 'Template enviado', confirmado: 'Confirmou',
  matriculado: 'Matriculou', nao_cumpriu: 'Não cumpriu', cancelado: 'Cancelado',
}
export const ORIGEM_LABEL: Record<string, string> = { anne: 'Anne', time: 'Time', qualificacao: 'Qualificação diária' }

const ERROS: Record<string, string> = {
  data_fora_do_intervalo: 'A data precisa ser de amanhã até 45 dias à frente.',
  data_obrigatoria: 'Informe a data.',
  limite_remarcacoes: 'Este lead já remarcou o máximo de vezes.',
  conversa_fechada: 'Lead já matriculado ou com opt-out.',
  conversa_nao_encontrada: 'Conversa não encontrada.',
  sem_agente_venda: 'Esta conversa não tem um agente de venda para retomar na data.',
  lead_de_outro_vendedor: 'Este lead está com outro vendedor.',
  acesso_negado: 'Sem permissão.',
  'acesso negado': 'Sem permissão.',                       // texto cru levantado pela RPC fn_agendamento_painel
  'intervalo inválido': 'Período inválido (máximo de 92 dias).',
  nao_encontrado: 'Agendamento não encontrado ou já fechado.',
}
export const mensagemErro = (c?: string | null) => (c ? ERROS[c] ?? String(c) : 'Não foi possível salvar.')

export const hojeManaus = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Manaus' })
export const maisDias = (s: string, n: number) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
export const ddmm = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`

const aberto = (a: Agendamento) => ABERTOS.includes(a.status)
const porData = (x: Agendamento, y: Agendamento) => String(x.data).localeCompare(String(y.data))

/** Listas de trabalho do menu: só agendamentos em aberto. */
export function listas(linhas: Agendamento[], hoje: string) {
  const ab = linhas.filter(aberto)
  const comData = ab.filter(a => a.status !== 'sem_data' && !!a.data)
  const lim = maisDias(hoje, 7)
  return {
    hoje: comData.filter(a => a.data === hoje),
    atrasados: comData.filter(a => a.data! < hoje).sort((x, y) => porData(y, x)),
    proximos: comData.filter(a => a.data! > hoje && a.data! <= lim).sort(porData),
    semData: ab.filter(a => a.status === 'sem_data'),
  }
}

/** Coorte do período: data combinada entre ini e fim, sem cancelados nem "sem data". */
const coorteDe = (p: PainelAg) => p.linhas.filter(a => !!a.data && a.data >= p.ini && a.data <= p.fim && a.status !== 'cancelado' && a.status !== 'sem_data')

export type Placar = {
  abertos: number; paraHoje: number; atrasados: number; semData: number
  agendados: number; ativados: number; confirmaram: number; matricularam: number; naoCumpriram: number; emAberto: number
  remarcaram: number; cancelados: number; maduros: number
  taxaConfirmacao: number | null; taxaMatricula: number | null
  receitaLiquida: number; semLiquido: number; custoTemplates: number
}

export function placar(p: PainelAg): Placar {
  const l = listas(p.linhas, p.hoje)
  const coorte = coorteDe(p)
  const n = (f: (a: Agendamento) => boolean) => coorte.filter(f).length
  const ativados = n(a => !!a.ativado_em)
  const confirmaram = n(a => !!a.confirmado_em)
  const mats = coorte.filter(a => a.status === 'matriculado')
  // maduro = já passou o prazo depois da data; só eles entram na taxa (coorte em aberto não derruba o número)
  const maduros = coorte.filter(a => maisDias(a.data!, p.prazo_dias) < p.hoje)
  return {
    abertos: p.linhas.filter(aberto).length, paraHoje: l.hoje.length, atrasados: l.atrasados.length, semData: l.semData.length,
    agendados: coorte.length, ativados, confirmaram, matricularam: mats.length,
    naoCumpriram: n(a => a.status === 'nao_cumpriu'), emAberto: n(aberto), remarcaram: n(a => a.remarcacoes > 0),
    cancelados: p.linhas.filter(a => a.status === 'cancelado' && !!a.data && a.data >= p.ini && a.data <= p.fim).length,
    maduros: maduros.length,
    taxaConfirmacao: ativados ? confirmaram / ativados : null,
    taxaMatricula: maduros.length ? maduros.filter(a => a.status === 'matriculado').length / maduros.length : null,
    receitaLiquida: mats.reduce((s, a) => s + (Number(a.liquido) || 0), 0),
    semLiquido: mats.filter(a => a.liquido == null).length,
    // custo = TODO template enviado a quem tem data no período, qualquer status (cancelado já foi cobrado); o funil acima fica só na coorte
    custoTemplates: Math.round(p.linhas.filter(a => !!a.data && a.data >= p.ini && a.data <= p.fim)
      .reduce((s, a) => s + (a.templates || 0), 0) * p.tarifa * 100) / 100,
  }
}

export type Grupo = { chave: string; agendados: number; matricularam: number; naoCumpriram: number; emAberto: number; liquido: number }

export function grupos(p: PainelAg, chave: 'frente' | 'origem'): Grupo[] {
  const m = new Map<string, Grupo>()
  for (const a of coorteDe(p)) {
    const k = String(a[chave] || '—')
    const g = m.get(k) ?? { chave: k, agendados: 0, matricularam: 0, naoCumpriram: 0, emAberto: 0, liquido: 0 }
    g.agendados++
    if (a.status === 'matriculado') { g.matricularam++; g.liquido += Number(a.liquido) || 0 }
    else if (a.status === 'nao_cumpriu') g.naoCumpriram++
    else if (aberto(a)) g.emAberto++
    m.set(k, g)
  }
  return [...m.values()].sort((x, y) => y.agendados - x.agendados)
}

/** Contagem de agendamentos em aberto por dia, de hoje em diante. */
export function calendario(linhas: Agendamento[], hoje: string, dias: number): { dia: string; n: number }[] {
  const cont = new Map<string, number>()
  for (const a of linhas) if (aberto(a) && a.status !== 'sem_data' && a.data) cont.set(a.data, (cont.get(a.data) ?? 0) + 1)
  return Array.from({ length: dias }, (_, i) => { const d = maisDias(hoje, i); return { dia: d, n: cont.get(d) ?? 0 } })
}
