// Junta rajadas de eventos realtime numa recarga só (16/10/2026).
// Causa do incidente: cada UPDATE em `conversations` (disparo da Black tocando ~25 conversas/min + Sender)
// fazia TODO painel aberto refazer as 4 consultas da lista do Inbox → 4 mil requisições em 5 min por
// vendedor, p90 de 4 s no PostgREST e a aba Escalações "demorando". Agora: no máximo 1 recarga por janela.
export function coalescer(fn: () => void, janelaMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pendente = false
  const disparar = () => { timer = null; if (pendente) { pendente = false; fn() } }
  return () => {
    pendente = true
    if (!timer) timer = setTimeout(disparar, janelaMs)
  }
}
