// Constantes do Comercial Humano compartilhadas entre a aba ☎️ Comercial e a barra do Inbox (16/10).
export const MOTIVOS = ['ja_e_aluno', 'sem_interesse', 'sem_dinheiro_agora', 'preco', 'vai_pensar', 'concorrente', 'sem_contato', 'telefone_invalido', 'outro']
// motivos que mandam o lead para a recuperação (desconto + nutrição); os demais só encerram (26/10)
export const MOTIVOS_RECUPERACAO = ['sem_interesse', 'sem_dinheiro_agora', 'preco', 'vai_pensar', 'concorrente', 'sem_contato']
export const ATIV_LABEL: Record<string, string> = {
  ligacao_atendida: '📞 Atendida', ligacao_nao_atendida: '📵 Não atendeu',
  ligacao_agendada: '🗓 Agendada', whatsapp: '💬 WhatsApp', nota: '📝 Nota',
}
export const ESTRATO_CLS: Record<string, string> = {
  // 25/10: classe do Jev com cor própria (roxo/azul/cinza) para não brigar com o dourado dos botões nem com o semáforo
  A: 'border-jevA/60 text-jevA bg-jevA/15 font-semibold', B: 'border-jevB/50 text-jevB bg-jevB/10', C: 'border-line text-dim',
}
export function diasRestantes(expiresAt: string) {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000))
}
