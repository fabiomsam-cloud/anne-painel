// Constantes do Comercial Humano compartilhadas entre a aba ☎️ Comercial e a barra do Inbox (16/10).
export const MOTIVOS = ['sem_interesse', 'sem_dinheiro_agora', 'preco', 'vai_pensar', 'concorrente', 'sem_contato', 'telefone_invalido', 'outro']
export const ATIV_LABEL: Record<string, string> = {
  ligacao_atendida: '📞 Atendida', ligacao_nao_atendida: '📵 Não atendeu',
  ligacao_agendada: '🗓 Agendada', whatsapp: '💬 WhatsApp', nota: '📝 Nota',
}
export const ESTRATO_CLS: Record<string, string> = {
  A: 'border-gold/60 text-gold bg-gold/10', B: 'border-teal/50 text-teal bg-teal/10', C: 'border-line text-dim',
}
export function diasRestantes(expiresAt: string) {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000))
}
