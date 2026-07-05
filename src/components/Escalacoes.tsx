import { useEffect, useState } from 'react'
import { supabase, fmtHora, fmtFone } from '../lib/supabase'

type Esc = {
  id: string; reason: string | null; question_text: string | null; status: string
  claimed_by: string | null; created_at: string; resolved_at: string | null
  conversations: { id: string; status: string; contacts: { name: string | null; phone: string } }
}

export default function Escalacoes({ irParaInbox }: { irParaInbox: () => void }) {
  const [escs, setEscs] = useState<Esc[]>([])
  const [mostrarResolvidas, setMostrarResolvidas] = useState(false)

  const carregar = async () => {
    const { data } = await supabase
      .from('escalations')
      .select('id,reason,question_text,status,claimed_by,created_at,resolved_at,conversations(id,status,contacts(name,phone))')
      .order('created_at', { ascending: false })
      .limit(100)
    setEscs((data as any) ?? [])
  }

  useEffect(() => {
    carregar()
    const ch = supabase.channel('escs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'escalations' }, carregar)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  const claim = async (e: Esc) => {
    const { data: u } = await supabase.auth.getUser()
    await supabase.from('escalations').update({
      status: 'claimed', claimed_by: u.user?.email ?? 'operador', claimed_at: new Date().toISOString(),
    }).eq('id', e.id)
  }

  const resolver = async (e: Esc, devolverIa: boolean) => {
    await supabase.from('escalations').update({
      status: 'resolved', resolved_at: new Date().toISOString(),
    }).eq('id', e.id)
    if (devolverIa) await supabase.from('conversations').update({ status: 'ia' }).eq('id', e.conversations.id)
  }

  const lista = escs.filter(e => mostrarResolvidas || e.status !== 'resolved')
  const minutosAberta = (e: Esc) => Math.round((Date.now() - new Date(e.created_at).getTime()) / 60000)

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display font-bold text-2xl">Escalações</h1>
        <label className="text-xs text-dim flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={mostrarResolvidas} onChange={e => setMostrarResolvidas(e.target.checked)}
            className="accent-[#f5b942]" />
          mostrar resolvidas
        </label>
      </div>

      <div className="space-y-3 max-w-3xl">
        {lista.map(e => (
          <div key={e.id} className={`rise border rounded-xl p-4
            ${e.status === 'open' ? 'border-danger/40 bg-danger/5' :
              e.status === 'claimed' ? 'border-gold/40 bg-gold/5' : 'border-line bg-panel/50'}`}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">
                    {e.conversations?.contacts?.name || fmtFone(e.conversations?.contacts?.phone)}
                  </span>
                  <span className="font-mono text-[10px] text-dim">{fmtFone(e.conversations?.contacts?.phone)}</span>
                  {e.status === 'open' && (
                    <span className="text-[10px] font-mono text-danger">aberta há {minutosAberta(e)} min</span>
                  )}
                  {e.status === 'claimed' && (
                    <span className="text-[10px] font-mono text-gold">com {e.claimed_by}</span>
                  )}
                  {e.status === 'resolved' && (
                    <span className="text-[10px] font-mono text-win">resolvida {fmtHora(e.resolved_at)}</span>
                  )}
                </div>
                {e.question_text && (
                  <div className="text-sm mt-2 bg-panel2 border border-line rounded-lg px-3 py-2">"{e.question_text}"</div>
                )}
                {e.reason && <div className="text-xs text-dim mt-2 leading-relaxed">{e.reason}</div>}
                <div className="font-mono text-[10px] text-dim/60 mt-2">{fmtHora(e.created_at)}</div>
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                {e.status === 'open' && (
                  <button onClick={() => claim(e)}
                    className="text-xs font-semibold bg-gold/15 text-gold border border-gold/40 rounded-lg px-3 py-1.5 hover:bg-gold/25 transition">
                    Atender
                  </button>
                )}
                {e.status !== 'resolved' && (
                  <>
                    <button onClick={irParaInbox}
                      className="text-xs text-dim border border-line rounded-lg px-3 py-1.5 hover:text-cream transition">
                      Abrir no Inbox
                    </button>
                    <button onClick={() => resolver(e, true)}
                      className="text-xs font-semibold bg-teal/15 text-teal border border-teal/40 rounded-lg px-3 py-1.5 hover:bg-teal/25 transition">
                      Resolver + IA ↩
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
        {lista.length === 0 && (
          <div className="text-center py-16 text-dim">
            <div className="text-4xl mb-3">✅</div>
            <div className="text-sm">Nenhuma escalação pendente — a Anne está dando conta.</div>
          </div>
        )}
      </div>
    </div>
  )
}
