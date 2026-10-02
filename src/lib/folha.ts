// Lógica PURA da folha da Anne (aba 📅 Histórico) — mesmo padrão da folha semanal do webinário.
// Sem React nem Supabase aqui: dá para testar com `node --test src/lib/folha.test.ts`.

export type DiaFolha = {
  dia: string
  templates: number; custo_templates: number; falaram: number; novas_sem_disparo: number
  resp_s: number | null; escalacoes: number
  esquentaram: number | null; esfriaram: number | null; estoque_quentes: number | null; orfaos: number | null
  links: number; prometeram: number | null; travas: number | null
  matriculas: number; receita_liquida: number | null; sem_liquido: number; quentes_compraram: number | null
}

export type Fmt = 'int' | 'brl' | 'pct' | 'seg'
// soma = total dos dias fechados · ultimo = retrato do último dia fechado · media = média dos dias com dado · calc = derivada
export type Linha = { secao: string; cor: string; key: string; label: string; fmt: Fmt; agg: 'soma' | 'ultimo' | 'media' | 'calc'; dst?: boolean }

export const LINHAS: Linha[] = [
  { secao: 'ENTRADA', cor: '#4F6F9C', key: 'templates', label: 'Templates enviados (disparos)', fmt: 'int', agg: 'soma' },
  { secao: 'ENTRADA', cor: '#4F6F9C', key: 'custo_templates', label: 'Custo dos templates (R$)', fmt: 'brl', agg: 'soma' },
  { secao: 'ENTRADA', cor: '#4F6F9C', key: 'novas_sem_disparo', label: 'Conversas novas sem disparo', fmt: 'int', agg: 'soma' },
  { secao: 'ENTRADA', cor: '#4F6F9C', key: 'falaram', label: 'Leads que falaram com a Anne', fmt: 'int', agg: 'soma', dst: true },
  { secao: 'CONVERSA', cor: '#2F7D62', key: 'resp_s', label: 'Tempo de resposta (mediana)', fmt: 'seg', agg: 'media' },
  { secao: 'CONVERSA', cor: '#2F7D62', key: 'escalacoes', label: 'Escalações para humano', fmt: 'int', agg: 'soma' },
  { secao: 'QUALIFICAÇÃO', cor: '#6A58A6', key: 'esquentaram', label: 'Esquentaram (viraram quentes)', fmt: 'int', agg: 'soma', dst: true },
  { secao: 'QUALIFICAÇÃO', cor: '#6A58A6', key: 'esfriaram', label: 'Esfriaram (saíram de quente)', fmt: 'int', agg: 'soma' },
  { secao: 'QUALIFICAÇÃO', cor: '#6A58A6', key: 'estoque_quentes', label: 'Estoque de quentes (fim do dia)', fmt: 'int', agg: 'ultimo' },
  { secao: 'QUALIFICAÇÃO', cor: '#6A58A6', key: 'orfaos', label: 'Quentes órfãos (sem humano nem follow-up)', fmt: 'int', agg: 'ultimo', dst: true },
  { secao: 'OFERTA', cor: '#C7742B', key: 'links', label: 'Links de matrícula enviados', fmt: 'int', agg: 'soma' },
  { secao: 'OFERTA', cor: '#C7742B', key: 'prometeram', label: 'Prometeram pagar numa data', fmt: 'int', agg: 'soma' },
  { secao: 'OFERTA', cor: '#C7742B', key: 'travas', label: 'Travaram na forma de pagamento', fmt: 'int', agg: 'soma' },
  { secao: 'RESULTADO', cor: '#2B6A45', key: 'matriculas', label: 'Matrículas da Anne', fmt: 'int', agg: 'soma', dst: true },
  { secao: 'RESULTADO', cor: '#2B6A45', key: 'conv_link', label: 'Conversão link → matrícula (%)', fmt: 'pct', agg: 'calc' },
  { secao: 'RESULTADO', cor: '#2B6A45', key: 'receita_liquida', label: 'Receita líquida (R$)', fmt: 'brl', agg: 'soma', dst: true },
  { secao: 'RESULTADO', cor: '#2B6A45', key: 'ticket', label: 'Ticket médio líquido (R$)', fmt: 'brl', agg: 'calc' },
  { secao: 'RESULTADO', cor: '#2B6A45', key: 'quentes_compraram', label: 'Quentes que compraram', fmt: 'int', agg: 'soma' },
]

const iso = (d: Date) => d.toISOString().slice(0, 10)
const maisDias = (s: string, n: number) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d) }

export type Semana = { seg: string; dom: string; dias: string[] }

/** Semanas da folha, da mais recente para a mais antiga. A corrente é a que contém ONTEM (dias fechados). */
export function semanasDaFolha(hoje: string, n: number): Semana[] {
  const ontem = maisDias(hoje, -1)
  const dow = new Date(ontem + 'T12:00:00Z').getUTCDay()      // 0 = domingo
  const seg0 = maisDias(ontem, -((dow + 6) % 7))
  return Array.from({ length: n }, (_, i) => {
    const seg = maisDias(seg0, -7 * i)
    return { seg, dom: maisDias(seg, 6), dias: Array.from({ length: 7 }, (_, k) => maisDias(seg, k)) }
  })
}

const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v)) ? v : (v === null || v === undefined || v === '' ? null : (isFinite(Number(v)) ? Number(v) : null))
const div = (a: number | null, b: number | null, k = 1): number | null => (a === null || b === null || b === 0) ? null : (a / b) * k

function derivada(key: string, mat: number | null, links: number | null, rec: number | null): number | null {
  if (key === 'conv_link') return div(mat, links, 100)
  if (key === 'ticket') return div(rec, mat)
  return null
}

export type LinhaCalc = Linha & { dias: (number | null)[]; semana: number | null }

/** Valores por dia (só dias FECHADOS, até `ontem`) e a coluna SEMANA (parcial enquanto a semana está aberta). */
export function valoresDaSemana(sem: Semana, porDia: Map<string, DiaFolha>, ontem: string): { linhas: LinhaCalc[]; diasFechados: number; parcial: boolean } {
  const fechado = sem.dias.map(d => d <= ontem)
  const bruto = (key: string, i: number): number | null => {
    if (!fechado[i]) return null
    const r = porDia.get(sem.dias[i]); if (!r) return null
    return num((r as Record<string, unknown>)[key])
  }
  const soma = (key: string): number | null => {
    const v = sem.dias.map((_, i) => bruto(key, i)).filter((x): x is number => x !== null)
    return v.length ? v.reduce((a, b) => a + b, 0) : null
  }
  const linhas = LINHAS.map(l => {
    let dias: (number | null)[]; let semana: number | null
    if (l.agg === 'calc') {
      dias = sem.dias.map((_, i) => derivada(l.key, bruto('matriculas', i), bruto('links', i), bruto('receita_liquida', i)))
      semana = derivada(l.key, soma('matriculas'), soma('links'), soma('receita_liquida'))
    } else {
      dias = sem.dias.map((_, i) => bruto(l.key, i))
      const validos = dias.filter((x): x is number => x !== null)
      // contagens de fluxo com zero em TODOS os dias aparecem como 0; métricas de qualificação sem dado ficam em branco
      semana = !validos.length ? null
        : l.agg === 'soma' ? validos.reduce((a, b) => a + b, 0)
        : l.agg === 'ultimo' ? validos[validos.length - 1]
        : validos.reduce((a, b) => a + b, 0) / validos.length
      // templates/links etc.: dia fechado sem valor (0) vira célula vazia para não poluir a folha
      if (l.agg === 'soma' && (l.key === 'templates' || l.key === 'custo_templates')) dias = dias.map(x => x === 0 ? null : x)
    }
    return { ...l, dias, semana }
  })
  const diasFechados = fechado.filter(Boolean).length
  return { linhas, diasFechados, parcial: diasFechados < 7 }
}

export function fmtFolha(v: number | null | undefined, f: Fmt): string {
  if (v === null || v === undefined || !isFinite(v)) return ''
  if (f === 'brl') return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (f === 'pct') return v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  if (f === 'seg') return Math.round(v).toLocaleString('pt-BR') + ' s'
  return Math.round(v).toLocaleString('pt-BR')
}

export const FRENTE_LABEL: Record<string, string> = {
  tjam: 'TJ-AM', policiasam: 'Polícias AM', prf: 'PRF', prfadm: 'PRF Administrativo', seducam: 'SEDUC-AM', seducpa: 'SEDUC-PA',
  manausprev: 'ManausPrev', semsa: 'SEMSA Manaus', inss: 'INSS', direitopolicial: 'Pós Direito Policial', gestaopublica: 'Pós Gestão Pública',
  desconto: 'Agente de Desconto', triagem: 'Triagem', playpassei: 'Play Passei', sem_agente: 'Sem agente',
}
export const TRAVA_LABEL: Record<string, string> = {
  forma_pagamento: 'Forma de pagamento', financeira: 'Financeira', sem_tempo: 'Sem tempo', desconfianca: 'Desconfiança',
  requisito_cargo: 'Requisito do cargo', esperar_edital: 'Esperar edital', ja_tem_curso: 'Já tem curso',
}
export const DIA_SEMANA = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM']
export const ddmm = (s: string) => s.slice(8, 10) + '/' + s.slice(5, 7)
export const ddmmaaaa = (s: string) => s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4)
