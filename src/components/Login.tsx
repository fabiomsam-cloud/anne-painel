import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [modo, setModo] = useState<'senha' | 'link'>('senha')
  const [enviado, setEnviado] = useState(false)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault()
    setEnviando(true); setErro('')
    if (modo === 'senha') {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(), password: senha,
      })
      setEnviando(false)
      if (error) setErro(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message)
      return
    }
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: window.location.href.split('#')[0] },
    })
    setEnviando(false)
    if (error) setErro(error.message.includes('rate limit') ? 'Limite de e-mails atingido — use a senha ou aguarde ~1h.' : error.message)
    else setEnviado(true)
  }

  return (
    <div className="h-full grid place-items-center px-6">
      <div className="w-full max-w-sm rise">
        <div className="font-display font-bold text-5xl tracking-tight">
          Anne<span className="text-gold">.</span>IA
        </div>
        <div className="font-mono text-[11px] text-dim mt-2 uppercase tracking-[0.25em]">
          Central de Comando · Grupo SOU
        </div>

        {enviado ? (
          <div className="mt-10 border border-teal/30 bg-teal/5 rounded-xl p-5">
            <div className="text-teal font-semibold">Link enviado ✓</div>
            <p className="text-sm text-dim mt-2 leading-relaxed">
              Abra seu e-mail <span className="text-cream font-mono text-[13px]">{email}</span> e
              clique no link mágico para entrar. Pode fechar esta aba.
            </p>
          </div>
        ) : (
          <form onSubmit={entrar} className="mt-10 space-y-4">
            <label className="block">
              <span className="text-xs text-dim uppercase tracking-wider">E-mail de operador</span>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                placeholder="voce@grupo.com"
                className="mt-2 w-full bg-panel border border-line rounded-lg px-4 py-3 text-sm font-mono
                  focus:outline-none focus:border-gold/60 transition-colors placeholder:text-dim/50" />
            </label>
            {modo === 'senha' && (
              <label className="block">
                <span className="text-xs text-dim uppercase tracking-wider">Senha</span>
                <input type="password" required value={senha} onChange={e => setSenha(e.target.value)}
                  placeholder="••••••••••••"
                  className="mt-2 w-full bg-panel border border-line rounded-lg px-4 py-3 text-sm font-mono
                    focus:outline-none focus:border-gold/60 transition-colors placeholder:text-dim/50" />
              </label>
            )}
            <button disabled={enviando}
              className="w-full bg-gold text-ink font-semibold rounded-lg py-3 text-sm
                hover:brightness-110 active:scale-[0.99] transition disabled:opacity-50">
              {enviando ? 'Entrando…' : modo === 'senha' ? 'Entrar →' : 'Receber link mágico →'}
            </button>
            {erro && <div className="text-danger text-xs">{erro}</div>}
            <button type="button" onClick={() => { setModo(modo === 'senha' ? 'link' : 'senha'); setErro('') }}
              className="text-[11px] text-dim hover:text-gold transition-colors">
              {modo === 'senha' ? 'Prefiro receber link mágico por e-mail →' : '← Entrar com senha'}
            </button>
            <p className="text-[11px] text-dim/70 leading-relaxed">
              Apenas e-mails autorizados enxergam os dados.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
