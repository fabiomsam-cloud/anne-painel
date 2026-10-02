// anne/painel/src/lib/agendamento.test.ts — rodar: node --test src/lib/agendamento.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { listas, placar, grupos, calendario, mensagemErro, maisDias, ddmm, type Agendamento, type PainelAg } from './agendamento.ts'

const HOJE = '2026-10-20'
let seq = 0
const ag = (o: Partial<Agendamento>): Agendamento => ({ id: `a${++seq}`, conversation_id: `c${seq}`, nome: 'Lead', phone: '5592900000000',
  agent_slug: 'elite_tjam', frente: 'tjam', data: null, data_sugerida: null, status: 'agendado', origem: 'anne', criado_por: null,
  forma: null, obs: null, remarcacoes: 0, tentativas: 0, templates: 0, ultimo_erro: null, ativado_em: null, confirmado_em: null,
  fechado_em: null, created_at: '2026-10-01T12:00:00Z', liquido: null, valor: null, ...o })
const painel = (linhas: Agendamento[]): PainelAg => ({ hoje: HOJE, ini: '2026-10-01', fim: '2026-10-20', tarifa: 0.43, prazo_dias: 7, ativo: true, linhas })

test('datas: maisDias atravessa o mês e ddmm formata', () => {
  assert.equal(maisDias('2026-10-28', 7), '2026-11-04')
  assert.equal(ddmm('2026-10-09'), '09/10')
})

test('listas: hoje, atrasados (mais recente primeiro), próximos 7 dias e sem data; fechados ficam fora', () => {
  const l = listas([
    ag({ data: HOJE }), ag({ data: HOJE, status: 'confirmado' }),
    ag({ data: '2026-10-15', status: 'ativado' }), ag({ data: '2026-10-18' }),
    ag({ data: '2026-10-27' }), ag({ data: '2026-10-28' }),
    ag({ status: 'sem_data', data_sugerida: '2026-10-22' }),
    ag({ data: HOJE, status: 'matriculado' }), ag({ data: '2026-10-10', status: 'nao_cumpriu' }),
  ], HOJE)
  assert.equal(l.hoje.length, 2)
  assert.deepEqual(l.atrasados.map(a => a.data), ['2026-10-18', '2026-10-15'])
  assert.deepEqual(l.proximos.map(a => a.data), ['2026-10-27'])      // 28/10 é o 8º dia
  assert.equal(l.semData.length, 1)
})

test('placar: funil da coorte, taxa só com maduros, receita líquida e custo', () => {
  const p = placar(painel([
    ag({ data: '2026-10-05', status: 'matriculado', ativado_em: 'x', confirmado_em: 'x', templates: 1, liquido: 1400 }),
    ag({ data: '2026-10-06', status: 'matriculado', templates: 0, liquido: null }),              // pagou antes da data
    ag({ data: '2026-10-07', status: 'nao_cumpriu', ativado_em: 'x', templates: 2 }),
    ag({ data: '2026-10-08', status: 'nao_cumpriu', ativado_em: 'x', confirmado_em: 'x', templates: 1, remarcacoes: 1 }),
    ag({ data: '2026-10-18', status: 'ativado', ativado_em: 'x', templates: 1 }),                 // ainda não maduro
    ag({ data: HOJE, status: 'agendado' }),
    ag({ data: '2026-10-09', status: 'cancelado' }),
    ag({ status: 'sem_data' }),
    ag({ data: '2026-09-20', status: 'matriculado', liquido: 999 }),                             // fora do período
  ]))
  assert.equal(p.agendados, 6)
  assert.equal(p.ativados, 4)
  assert.equal(p.confirmaram, 2)
  assert.equal(p.matricularam, 2)
  assert.equal(p.naoCumpriram, 2)
  assert.equal(p.emAberto, 2)
  assert.equal(p.remarcaram, 1)
  assert.equal(p.cancelados, 1)
  assert.equal(p.maduros, 4)
  assert.equal(p.taxaMatricula, 0.5)
  assert.equal(p.taxaConfirmacao, 0.5)
  assert.equal(p.receitaLiquida, 1400)
  assert.equal(p.semLiquido, 1)
  assert.equal(p.custoTemplates, 2.15)
  assert.equal(p.abertos, 3)                                                                     // inclui o sem data
  assert.equal(p.paraHoje, 1)
  assert.equal(p.atrasados, 1)
})

test('placar: sem maduros e sem ativados as taxas são nulas, não zero', () => {
  const p = placar(painel([ag({ data: HOJE })]))
  assert.equal(p.taxaMatricula, null)
  assert.equal(p.taxaConfirmacao, null)
})

test('grupos: por frente e por origem, maior primeiro', () => {
  const p = painel([
    ag({ data: '2026-10-05', frente: 'tjam', origem: 'anne', status: 'matriculado', liquido: 1000 }),
    ag({ data: '2026-10-06', frente: 'tjam', origem: 'time', status: 'nao_cumpriu' }),
    ag({ data: '2026-10-07', frente: 'prf', origem: 'anne' }),
  ])
  const f = grupos(p, 'frente')
  assert.deepEqual(f.map(g => [g.chave, g.agendados, g.matricularam, g.naoCumpriram, g.emAberto]), [['tjam', 2, 1, 1, 0], ['prf', 1, 0, 0, 1]])
  assert.equal(f[0].liquido, 1000)
  assert.deepEqual(grupos(p, 'origem').map(g => [g.chave, g.agendados]), [['anne', 2], ['time', 1]])
})

test('calendário: 30 dias a partir de hoje, só abertos', () => {
  const c = calendario([ag({ data: HOJE }), ag({ data: HOJE, status: 'ativado' }), ag({ data: '2026-10-22' }),
    ag({ data: '2026-10-22', status: 'matriculado' }), ag({ data: '2026-12-25' })], HOJE, 30)
  assert.equal(c.length, 30)
  assert.deepEqual(c[0], { dia: HOJE, n: 2 })
  assert.deepEqual(c[2], { dia: '2026-10-22', n: 1 })
  assert.equal(c.reduce((s, x) => s + x.n, 0), 3)
})

test('mensagens de erro em português; código desconhecido aparece cru', () => {
  assert.match(mensagemErro('data_fora_do_intervalo'), /amanhã/)
  assert.match(mensagemErro('limite_remarcacoes'), /remarcou/)
  assert.equal(mensagemErro('xpto'), 'xpto')
  assert.equal(mensagemErro(null), 'Não foi possível salvar.')
})
