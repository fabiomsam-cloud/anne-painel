// Testes da lógica da folha (aba 📅 Histórico). Rodar: node --test src/lib/folha.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { semanasDaFolha, valoresDaSemana, fmtFolha, LINHAS, type DiaFolha } from './folha.ts'

const dia = (d: string, o: Partial<DiaFolha> = {}): DiaFolha => ({ dia: d, templates: 0, custo_templates: 0, falaram: 0, novas_sem_disparo: 0,
  resp_s: null, escalacoes: 0, esquentaram: null, esfriaram: null, estoque_quentes: null, orfaos: null, links: 0, prometeram: null, travas: null,
  matriculas: 0, receita_liquida: null, sem_liquido: 0, quentes_compraram: null, ...o })

test('semana corrente = a que contém ONTEM; segunda-feira mostra a semana anterior fechada', () => {
  const s = semanasDaFolha('2026-10-02', 3)          // sexta → ontem qui 01/10
  assert.equal(s.length, 3)
  assert.deepEqual([s[0].seg, s[0].dom], ['2026-09-28', '2026-10-04'])
  assert.deepEqual([s[1].seg, s[1].dom], ['2026-09-21', '2026-09-27'])
  assert.equal(s[0].dias.length, 7); assert.equal(s[0].dias[3], '2026-10-01')
  const seg = semanasDaFolha('2026-10-05', 1)        // segunda → ontem dom 04/10
  assert.deepEqual([seg[0].seg, seg[0].dom], ['2026-09-28', '2026-10-04'])
})

test('dias depois de ontem ficam em branco mesmo que venham dados; SEMANA soma só os fechados', () => {
  const sem = semanasDaFolha('2026-10-02', 1)[0]
  const por = new Map<string, DiaFolha>([
    ['2026-09-28', dia('2026-09-28', { templates: 100, links: 10, matriculas: 1, receita_liquida: 900 })],
    ['2026-09-30', dia('2026-09-30', { templates: 50, links: 30, matriculas: 3, receita_liquida: 2100 })],
    ['2026-10-02', dia('2026-10-02', { templates: 999, matriculas: 9 })],       // hoje: não fechado
  ])
  const v = valoresDaSemana(sem, por, '2026-10-01')
  const linha = (k: string) => v.linhas.find(l => l.key === k)!
  assert.deepEqual(linha('templates').dias, [100, null, 50, null, null, null, null])
  assert.equal(linha('templates').semana, 150)
  assert.equal(v.diasFechados, 4)                      // seg, ter, qua, qui
  assert.equal(v.parcial, true)
  assert.equal(linha('matriculas').semana, 4)
  assert.equal(linha('receita_liquida').semana, 3000)
  assert.equal(linha('ticket').semana, 750)            // 3000 ÷ 4
  assert.equal(linha('ticket').dias[2], 700)
  assert.equal(linha('conv_link').semana, 10)          // 4 ÷ 40 = 10%
})

test('estoque e órfãos: SEMANA = último dia fechado com retrato (não soma)', () => {
  const sem = semanasDaFolha('2026-10-02', 1)[0]
  const por = new Map<string, DiaFolha>([
    ['2026-09-30', dia('2026-09-30', { estoque_quentes: 270, orfaos: 150 })],
    ['2026-10-01', dia('2026-10-01', { estoque_quentes: 282, orfaos: 146, esquentaram: 12 })],
  ])
  const v = valoresDaSemana(sem, por, '2026-10-01')
  const linha = (k: string) => v.linhas.find(l => l.key === k)!
  assert.equal(linha('estoque_quentes').semana, 282)
  assert.equal(linha('orfaos').semana, 146)
  assert.equal(linha('esquentaram').semana, 12)
  assert.equal(linha('esquentaram').dias[0], null)     // sem qualificação naquele dia = em branco, não zero
})

test('semana fechada não é parcial', () => {
  const sem = semanasDaFolha('2026-10-05', 1)[0]
  const v = valoresDaSemana(sem, new Map(), '2026-10-04')
  assert.equal(v.diasFechados, 7); assert.equal(v.parcial, false)
})

test('formatação pt-BR e vazio', () => {
  assert.equal(fmtFolha(1947.48, 'brl'), '1.947,48')
  assert.equal(fmtFolha(1234, 'int'), '1.234')
  assert.equal(fmtFolha(15.375, 'pct'), '15,4')
  assert.equal(fmtFolha(27, 'seg'), '27 s')
  assert.equal(fmtFolha(null, 'int'), '')
  assert.equal(fmtFolha(0, 'int'), '0')
})

test('toda linha tem seção, rótulo e formato; seções na ordem da folha', () => {
  assert.deepEqual([...new Set(LINHAS.map(l => l.secao))], ['ENTRADA', 'CONVERSA', 'QUALIFICAÇÃO', 'OFERTA', 'RESULTADO'])
  assert.ok(LINHAS.every(l => l.label && l.key && l.fmt))
})
