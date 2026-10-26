// ============================================================
// Semáforo dos cards do Comercial e do Inbox (25/10/2026).
// UMA pergunta define a cor: de quem é a bola e há quanto tempo.
//   vermelho = o lead está esperando você (dinheiro na mesa)
//   âmbar    = bola com você, sem resposta pendente (sem próxima ação / vencida / sem dono)
//   verde    = próxima ação marcada ou esperando o lead
//   cinza    = frio: decidir devolver ou retomar
// Mentoria, funil e origem ficam em cinza — só o estado tem cor.
// Protótipo aprovado pelo Fábio: prototipos/cards-semaforo.html
// ============================================================
export type Cor = 'red' | 'amber' | 'green' | 'grey' | 'none'
const H = 3600000, D = 86400000

export const FAIXA: Record<Cor, string> = { red: 'bg-danger', amber: 'bg-amber', green: 'bg-win', grey: 'bg-frio', none: '' }
export const TXT: Record<Cor, string> = { red: 'text-danger', amber: 'text-amber', green: 'text-win', grey: 'text-dim', none: 'text-dim' }
export const CHIP: Record<Cor, string> = {
  red: 'border-danger/50 text-danger bg-danger/10', amber: 'border-amber/50 text-amber bg-amber/10',
  green: 'border-win/40 text-win bg-win/5', grey: 'border-frio/60 text-dim bg-frio/10', none: 'border-line text-dim',
}
export const RANK: Record<Cor, number> = { red: 0, amber: 1, green: 2, grey: 3, none: 4 }
export const TITULO: Record<Cor, string> = {
  red: 'O lead está esperando você', amber: 'Bola com você: sem próxima ação, vencida ou sem dono',
  green: 'Próxima ação marcada ou esperando o lead', grey: 'Frio: decidir devolver ou retomar', none: '',
}

export function fmtDesde(ms: number, agora: number) {
  const min = Math.max(0, Math.round((agora - ms) / 60000))
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `há ${h} h`
  return `há ${Math.floor(h / 24)} dias`
}

export type EstadoCard = { cor: Cor; rotulo: string; pulsa: boolean }
// Card do Comercial em posse do vendedor.
// esperandoDesde = instante da última mensagem do lead quando ela é a última da conversa (senão 0).
export function estadoCard(p: {
  esperandoDesde: number; proximaEm: string | null | undefined; naoAtendeu: number
  ultimoContatoLead: string | null | undefined; assignedAt: string; agora: number
}): EstadoCard {
  const { esperandoDesde, proximaEm, naoAtendeu, agora } = p
  if (esperandoDesde > 0) {
    return { cor: 'red', rotulo: `Respondeu ${fmtDesde(esperandoDesde, agora)} · esperando você`, pulsa: agora - esperandoDesde >= 2 * H }
  }
  const proxMs = proximaEm ? new Date(proximaEm).getTime() : 0
  const proxFutura = proxMs > agora
  const ref = p.ultimoContatoLead ? new Date(p.ultimoContatoLead).getTime() : new Date(p.assignedAt).getTime()
  const diasSemLead = Math.floor((agora - ref) / D)
  if (!proxFutura && (naoAtendeu >= 3 || diasSemLead >= 7)) {
    const partes: string[] = []
    if (naoAtendeu >= 3) partes.push(`não atendeu ×${naoAtendeu}`)
    if (diasSemLead >= 7) partes.push(`sem resposta há ${diasSemLead} d`)
    return { cor: 'grey', rotulo: `Frio · ${partes.join(' · ')} · decidir devolver`, pulsa: false }
  }
  if (!proxMs) return { cor: 'amber', rotulo: 'Sem próxima ação', pulsa: false }
  if (!proxFutura) return { cor: 'amber', rotulo: 'Próxima ação vencida', pulsa: false }
  return { cor: 'green', rotulo: p.ultimoContatoLead ? 'Próxima ação marcada · esperando o lead' : 'Próxima ação marcada', pulsa: false }
}

export type EstadoInbox = { cor: Cor; rotulo: string; espera: string; pulsa: boolean }
// Linha do Inbox. Limites: verde até 1 h · âmbar de 1 h a 24 h · vermelho acima de 24 h · cinza acima de 14 dias.
export function estadoInbox(p: {
  aguardando: boolean; lastUser: string | null; lastMsg: string | null
  comHumano: boolean; semDono: boolean; meu: boolean; agora: number
}): EstadoInbox {
  const { agora } = p
  const quem = p.meu ? 'esperando você' : 'esperando resposta'
  if (p.aguardando && p.lastUser) {
    const t = new Date(p.lastUser).getTime(), ms = agora - t, espera = fmtDesde(t, agora)
    if (ms > 14 * D) return { cor: 'grey', rotulo: 'decidir: devolver ou retomar', espera, pulsa: false }
    if (ms > 24 * H) return { cor: 'red', rotulo: quem, espera, pulsa: true }
    if (ms > H) return { cor: 'amber', rotulo: quem, espera, pulsa: false }
    return { cor: 'green', rotulo: p.meu ? 'no prazo · responda' : 'no prazo', espera, pulsa: false }
  }
  if (!p.comHumano) return { cor: 'none', rotulo: '', espera: '', pulsa: false }
  if (p.semDono) return { cor: 'amber', rotulo: 'sem dono · assumir', espera: '', pulsa: false }
  const ref = p.lastMsg ? new Date(p.lastMsg).getTime() : 0
  if (ref && agora - ref > 14 * D) return { cor: 'grey', rotulo: 'decidir: devolver ou retomar', espera: '', pulsa: false }
  return { cor: 'green', rotulo: p.lastUser ? 'esperando o lead' : 'você falou por último', espera: '', pulsa: false }
}
