import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const PAINEL_URL = 'https://fabiomsam-cloud.github.io/anne-painel/'

export default function Equipe() {
  const [emails, setEmails] = useState<string[]>([])
  const [meuEmail, setMeuEmail] = useState('')
  const [novo, setNovo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState('')
  const [senha, setSenha] = useState('')
  const [senha2, setSenha2] = useState('')
  const [trocando, setTrocando] = useState(false)

  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(''), 9000) }

  const carregar = async () => {
    const { data } = await supabase.from('global_settings').select('value').eq('key', 'operator_emails').single()
    setEmails(((data?.value as string[]) ?? []))
    const { data: u } = await supabase.auth.getUser()
    setMeuEmail(u.user?.email ?? '')
  }
  useEffect(() => { carregar() }, [])

  const salvarLista = async (nova: string[]) => {
    const { error } = await supabase.from('global_settings')
      .update({ value: nova }).eq('key', 'operator_emails')
    if (error) { flash('Erro ao salvar: ' + error.message); return false }
    setEmails(nova)
    return true
  }

  const enviarLink = async (email: string) => {
    // magic link de acesso — mesmo fluxo do login do painel
    const { error } = await supabase.auth.signInWithOtp({
      email, options: { emailRedirectTo: PAINEL_URL, shouldCreateUser: true },
    })
    return error
  }

  const adicionar = async () => {
    const email = novo.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return flash('Digite um e-mail válido.')
    if (emails.includes(email)) return flash('Esse e-mail já está na equipe.')
    setSalvando(true)
    if (await salvarLista([...emails, email])) {
      const err = await enviarLink(email)
      flash(err
        ? `${email} autorizado, mas o e-mail de acesso falhou (${err.message}). Use "Reenviar link" em alguns minutos.`
        : `✅ ${email} autorizado — link de acesso enviado por e-mail.`)
      setNovo('')
    }
    setSalvando(false)
  }

  const reenviar = async (email: string) => {
    setSalvando(true)
    const err = await enviarLink(email)
    flash(err ? `Falha ao reenviar (${err.message}). O SMTP padrão tem limite por hora — tente de novo em ~1h.`
      : `✅ Link de acesso reenviado para ${email}.`)
    setSalvando(false)
  }

  const remover = async (email: string) => {
    if (email === meuEmail) return flash('Você não pode remover o seu próprio acesso.')
    if (!window.confirm(`Remover o acesso de ${email}?\n\nA pessoa perde a entrada no painel imediatamente (o link antigo para de funcionar nos dados).`)) return
    setSalvando(true)
    if (await salvarLista(emails.filter(e => e !== email))) flash(`Acesso de ${email} removido.`)
    setSalvando(false)
  }

  const trocarSenha = async () => {
    if (senha.length < 8) return flash('A senha precisa ter pelo menos 8 caracteres.')
    if (senha !== senha2) return flash('As senhas não conferem.')
    setTrocando(true)
    const { error } = await supabase.auth.updateUser({ password: senha })
    setTrocando(false)
    if (error) return flash('Erro ao alterar a senha: ' + error.message)
    setSenha(''); setSenha2('')
    flash('✅ Senha alterada — já vale no próximo login (e-mail + senha na tela de entrada).')
  }

  const inp = 'bg-panel border border-line rounded-lg px-3 py-2 text-sm text-cream focus:outline-none focus:border-gold/60 placeholder:text-dim/40'

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 max-w-2xl space-y-5">
      {msg && <div className="rise border border-win/40 bg-win/10 text-win text-sm rounded-xl px-4 py-3">{msg}</div>}

      <div>
        <h1 className="font-display font-bold text-2xl">Equipe</h1>
        <p className="text-sm text-dim mt-1">
          Quem está aqui enxerga e opera o painel inteiro (Inbox, Disparos, Agentes, tudo).
          Ao cadastrar, a pessoa recebe por e-mail um <b className="text-cream">link mágico de acesso</b> — sem senha.
        </p>
      </div>

      <div className="border border-teal/25 bg-teal/5 rounded-xl p-4">
        <div className="text-xs text-teal mb-1 font-mono uppercase tracking-widest">Minha conta</div>
        <div className="text-sm font-mono mb-3">{meuEmail}</div>
        <div className="text-xs text-dim mb-2">Definir/alterar minha senha (passa a valer junto com o link mágico)</div>
        <div className="flex gap-2 flex-wrap">
          <input type="password" className={inp + ' flex-1 min-w-40'} placeholder="Nova senha (mín. 8)" value={senha}
            onChange={e => setSenha(e.target.value)} autoComplete="new-password" />
          <input type="password" className={inp + ' flex-1 min-w-40'} placeholder="Repetir a nova senha" value={senha2}
            onChange={e => setSenha2(e.target.value)} autoComplete="new-password"
            onKeyDown={e => e.key === 'Enter' && trocarSenha()} />
          <button onClick={trocarSenha} disabled={trocando || !senha || !senha2}
            className="bg-teal/15 text-teal border border-teal/40 font-semibold rounded-lg px-4 text-sm disabled:opacity-40 hover:bg-teal/25 transition">
            {trocando ? '…' : '🔑 Salvar senha'}
          </button>
        </div>
      </div>

      <div className="border border-line bg-panel/50 rounded-xl p-4">
        <div className="text-xs text-dim mb-2">Cadastrar novo operador</div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input className={inp + ' flex-1'} placeholder="email@grupo.com" value={novo}
            onChange={e => setNovo(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && adicionar()} />
          <button onClick={adicionar} disabled={salvando || !novo.trim()}
            className="bg-gold text-ink font-semibold rounded-lg px-5 text-sm disabled:opacity-40 hover:brightness-110 transition">
            {salvando ? '…' : '＋ Cadastrar e enviar link'}
          </button>
        </div>
        <p className="text-[11px] text-dim/70 mt-2">
          O e-mail sai pelo remetente padrão do Supabase (pode cair no spam; limite de poucos envios por hora).
          Se não chegar, use "Reenviar link" — ou a pessoa pode pedir o link na tela de login do painel.
        </p>
      </div>

      <div className="space-y-2">
        {emails.map(e => (
          <div key={e} className="border border-line bg-panel/50 rounded-xl px-4 py-3 flex items-center gap-3">
            <span className="text-sm font-mono truncate">{e}</span>
            {e === meuEmail && (
              <span className="text-[10px] px-2 py-0.5 rounded-full border border-gold/40 text-gold bg-gold/10">você</span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => reenviar(e)} disabled={salvando}
                className="text-xs text-dim border border-line rounded-lg px-3 py-1.5 hover:text-cream transition disabled:opacity-40">
                ✉ Reenviar link
              </button>
              {e !== meuEmail && (
                <button onClick={() => remover(e)} disabled={salvando}
                  className="text-xs text-danger/80 border border-danger/30 rounded-lg px-3 py-1.5 hover:bg-danger/10 hover:text-danger transition disabled:opacity-40">
                  Remover
                </button>
              )}
            </div>
          </div>
        ))}
        {emails.length === 0 && <div className="text-center py-8 text-dim text-sm">Carregando…</div>}
      </div>
    </div>
  )
}
