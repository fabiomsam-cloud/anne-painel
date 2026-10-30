// ============================================================
// Biblioteca de TREINAMENTO da equipe (aba 📚, 26/10/2026).
// Para acrescentar um documento: coloque o HTML em public/treinamento/<arquivo>.html
// (página completa, com <!doctype html>) e adicione uma entrada aqui. Nada mais.
// `publico`: quem vê — 'todos' (admin + vendedores) ou 'admin'.
// ============================================================
export type DocTreinamento = {
  id: string; titulo: string; descricao: string; data: string   // AAAA-MM-DD
  arquivo: string                                               // relativo a public/treinamento/
  publico: 'todos' | 'admin'; tags?: string[]
}
export const DOCS_TREINAMENTO: DocTreinamento[] = [
  {
    id: 'criterios-mql-sql-prf-2910', titulo: 'PRF: MQL e SQL', data: '2026-10-29',
    descricao: 'Régua de qualificação da Elite PRF: quem fica fora (secretária eletrônica, cargo administrativo, objeção de valor e de tempo), o que faz ser MQL e SQL, ex-aluno e comprador de ingresso como prioridade, erros comuns e o que cada classe significa para a Anne e para o Comercial.',
    arquivo: 'criterios-mql-sql-prf-2910.html', publico: 'todos', tags: ['Qualificação', 'MQL', 'SQL', 'PRF'],
  },
  {
    id: 'criterios-mql-sql-2910', titulo: 'TJ-AM: MQL e SQL', data: '2026-10-29',
    descricao: 'O que faz um lead ser MQL, o que faz ser SQL e quem fica fora (secretária eletrônica, concurso errado, objeção de valor). Com exemplos reais do TJ-AM e o que cada classe significa para a Anne e para o Comercial.',
    arquivo: 'criterios-mql-sql-2910.html', publico: 'todos', tags: ['Qualificação', 'MQL', 'SQL', 'TJ-AM'],
  },
  {
    id: 'guia-comercial-2610', titulo: 'Guia do Comercial na Anne', data: '2026-10-26',
    descricao: 'O que mudou no painel: semáforo dos cards, fila a atribuir, próxima ação obrigatória, posse de 14 dias, Inbox e a rotina diária do vendedor.',
    arquivo: 'guia-comercial-2610.html', publico: 'todos', tags: ['Comercial', 'Inbox', 'Rotina'],
  },
]
