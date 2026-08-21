import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export type Check = { key: string; titulo: string; status: 'ok' | 'warn' | 'crit'; valor: string; detalhe: string }
export type Saude = { geral: 'ok' | 'warn' | 'crit'; gerado_em: string; checks: Check[] }

export async function buscarSaude(): Promise<Saude | null> {
  const { data, error } = await supabase.rpc('fn_sentinela')
  if (error || !data) return null
  return data as Saude
}

const COR = {
  ok:   { dot: 'bg-win',    text: 'text-win',    border: 'border-line/60',   rotulo: 'OK' },
  warn: { dot: 'bg-gold',   text: 'text-gold',   border: 'border-gold/40',   rotulo: 'ATENÇÃO' },
  crit: { dot: 'bg-danger', text: 'text-danger', border: 'border-danger/60', rotulo: 'CRÍTICO' },
} as const

export default function Sentinela() {
  const [saude, setSaude] = useState<Saude | null>(null)
  const [erro, setErro] = useState('')
  const [notif, setNotif] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported')

  const carregar = async () => {
    const s = await buscarSaude()
    if (s) { setSaude(s); setErro('') }
    else setErro('Não consegui consultar a saúde do sistema — isso por si só já é um mau sinal. Recarregue; persistindo, avise o admin.')
  }

  useEffect(() => {
    carregar()
    const t = setInterval(carregar, 30_000)
    return () => clearInterval(t)
  }, [])

  const pedirNotificacao = async () => {
    if (typeof Notification === 'undefined') return
    const p = await Notification.requestPermission()
    setNotif(p)
  }

  const geral = saude?.geral ?? 'ok'
  return (
    <div className="h-full overflow-y-auto p-6 max-w-4xl space-y-5">
      <div>
        <h1 className="font-display font-bold text-2xl flex items-center gap-2.5">
          🛡️ Sentinela
          {saude && (
            <span className={`text-xs font-mono font-semibold rounded-full px-3 py-1 border ${COR[geral].border} ${COR[geral].text} ${geral === 'crit' ? 'pulse-danger' : ''}`}>
              ● {geral === 'ok' ? 'TUDO OPERANDO' : geral === 'warn' ? 'PONTOS DE ATENÇÃO' : 'PROBLEMA CRÍTICO'}
            </span>
          )}
        </h1>
        <p className="text-xs text-dim mt-1.5">
          Saúde da operação da Anne, verificada a cada 30s direto no banco. Se algo ficar <b className="text-danger">crítico</b>,
          um aviso vermelho aparece em TODAS as abas, para todo mundo que estiver com o painel aberto.
          Vermelho = sistema com defeito (motor lento/mudo, fila travada, webhook com erro). Amarelo = atenção ou fila de trabalho do time.
        </p>
      </div>

      {erro && <div className="border border-danger/60 bg-danger/10 text-danger text-sm rounded-xl px-4 py-3">{erro}</div>}

      {notif !== 'granted' && notif !== 'unsupported' && (
        <button onClick={pedirNotificacao}
          className="text-xs text-dim border border-line rounded-lg px-3 py-2 hover:text-cream hover:border-gold/40 transition">
          🔔 Ativar notificações do navegador (avisa mesmo com o painel em outra janela)
        </button>
      )}
      {notif === 'granted' && <div className="text-[11px] text-win">🔔 Notificações do navegador ativas neste dispositivo.</div>}

      <div className="space-y-2">
        {(saude?.checks ?? []).map(c => (
          <div key={c.key} className={`border ${COR[c.status].border} bg-panel/50 rounded-xl p-4`}>
            <div className="flex items-center gap-3">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${COR[c.status].dot} ${c.status === 'crit' ? 'pulse-danger' : ''}`} />
              <div className="font-semibold">{c.titulo}</div>
              <span className={`ml-auto font-mono text-xs ${COR[c.status].text}`}>{c.valor}</span>
            </div>
            <p className="text-[12px] text-dim mt-2 leading-relaxed">{c.detalhe}</p>
          </div>
        ))}
        {!saude && !erro && <div className="text-sm text-dim">verificando…</div>}
      </div>

      {saude && (
        <div className="font-mono text-[10px] text-dim/60">
          última verificação: {new Date(saude.gerado_em).toLocaleTimeString('pt-BR')} · atualiza sozinha a cada 30s
        </div>
      )}

      <div className="border border-line bg-panel/30 rounded-xl p-4 text-[12px] text-dim leading-relaxed">
        <b className="text-cream">Por que esta aba existe:</b> entre 14 e 21/08 um bug deixou o tempo de resposta da Anne
        em ~10 minutos (em vez de ~20s) sem ninguém perceber, porque a taxa de resposta continuava normal — só o tempo
        degradou. A Sentinela vigia justamente o que não aparece nas métricas de "funcionou/não funcionou".
        Além dela, um vigia no servidor manda alerta no WhatsApp dos operadores a cada 10min se o motor degradar.
      </div>
    </div>
  )
}
