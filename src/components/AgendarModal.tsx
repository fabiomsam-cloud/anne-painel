// anne/painel/src/components/AgendarModal.tsx
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { hojeManaus, maisDias, mensagemErro } from '../lib/agendamento'

// 🗓 Agendar matrícula — registra a data combinada com o lead (RPC fn_agendar_matricula, migration 38).
// A partir daqui a Anne assume a conversa: no dia, sai o template e o agente do concurso retoma.
export default function AgendarModal({ conversationId, nome, dataInicial, onClose, onOk }: {
  conversationId: string; nome: string; dataInicial?: string | null; onClose: () => void; onOk: () => void
}) {
  const hoje = hojeManaus()
  const [data, setData] = useState(dataInicial && dataInicial > hoje ? dataInicial : '')
  const [forma, setForma] = useState('')
  const [obs, setObs] = useState('')
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState('')

  const salvar = async () => {
    if (!data || busy) return
    setBusy(true); setErro('')
    const { data: r, error } = await supabase.rpc('fn_agendar_matricula', {
      p_conversation_id: conversationId, p_data: data, p_forma: forma.trim() || null, p_obs: obs.trim() || null,
    })
    setBusy(false)
    const res = (r as any) ?? {}
    if (error || !res.ok) { setErro(mensagemErro(error?.message || res.erro)); return }
    onOk()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onClick={() => !busy && onClose()}>
      <div className="rise w-full max-w-md bg-panel border border-line rounded-2xl p-5 space-y-4" onClick={ev => ev.stopPropagation()}>
        <div>
          <div className="font-display font-semibold text-lg">🗓 Agendar matrícula</div>
          <div className="text-sm text-dim mt-1">
            <b className="text-cream">{nome}</b> combinou uma data para pagar. No dia, a Anne envia o lembrete e conduz a matrícula.
            Se o lead estiver com um vendedor, ele sai da posse sem contar como perda.
          </div>
        </div>
        <label className="block text-xs text-dim">Data combinada
          <input type="date" value={data} min={maisDias(hoje, 1)} max={maisDias(hoje, 45)} onChange={e => setData(e.target.value)}
            className="mt-1 w-full bg-panel2 border border-line rounded-lg px-3 py-2 text-sm text-cream" />
        </label>
        <label className="block text-xs text-dim">Forma de pagamento combinada (opcional)
          <input value={forma} onChange={e => setForma(e.target.value)} maxLength={200} placeholder="ex.: cartão em 12x"
            className="mt-1 w-full bg-panel2 border border-line rounded-lg px-3 py-2 text-sm text-cream" />
        </label>
        <label className="block text-xs text-dim">Observação (opcional)
          <textarea value={obs} onChange={e => setObs(e.target.value)} maxLength={200} rows={2} placeholder="ex.: recebe o salário no dia 10"
            className="mt-1 w-full bg-panel2 border border-line rounded-lg px-3 py-2 text-sm text-cream" />
        </label>
        {erro && <div className="text-sm text-danger">⚠️ {erro}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={busy}
            className="text-xs text-dim border border-line rounded-lg px-3 py-2 hover:text-cream transition">Cancelar</button>
          <button onClick={salvar} disabled={!data || busy}
            className="text-xs font-semibold bg-gold/15 text-gold border border-gold/40 rounded-lg px-3 py-2 hover:bg-gold/25 transition disabled:opacity-40">
            {busy ? 'Salvando…' : 'Agendar'}</button>
        </div>
      </div>
    </div>
  )
}
