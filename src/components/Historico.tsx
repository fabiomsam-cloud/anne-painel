import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  semanasDaFolha, valoresDaSemana, fmtFolha, FRENTE_LABEL, TRAVA_LABEL, DIA_SEMANA, ddmm, ddmmaaaa,
  type DiaFolha, type Semana,
} from '../lib/folha'

// 📅 Histórico — folha semanal da Anne, mesmo padrão da folha do webinário (pronta para imprimir).
// Dados: RPC fn_folha_anne (migration 36). Dias FECHADOS até ontem (dia de Manaus); SEMANA = parcial.

type Quente = { frente: string; quentes: number; com_ia_followup: number; com_humano: number; orfaos: number
  janela_aberta: number; parados_7d: number; mornos: number; frios: number; trava_principal: string | null }
type Camp = { origem: string; conversas: number; quentes: number; pct_quente: number; compraram: number }
export type FolhaAnne = { dias: DiaFolha[]; quentes_hoje: Quente[]; campanhas_7d: Camp[]; hoje: string; gerado_em: string; qualificacao_desde: string | null }

const N_SEMANAS = 4
const hojeManaus = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Manaus' })
const menosUm = (s: string) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) }

function leituraDoDia(f: FolhaAnne, ontem: string): string {
  const q = f.quentes_hoje
  const tot = (k: keyof Quente) => q.reduce((a, x) => a + (Number(x[k]) || 0), 0)
  const topo = [...q].sort((a, b) => b.orfaos - a.orfaos)[0]
  const d = f.dias.find(x => x.dia === ontem)
  const partes = [
    `${tot('quentes')} quentes hoje: ${tot('orfaos')} órfãos, ${tot('com_humano')} com humano, ${tot('com_ia_followup')} com follow-up da IA.`,
    topo && topo.orfaos > 0 ? `Maior fila de órfãos: ${FRENTE_LABEL[topo.frente] ?? topo.frente} (${topo.orfaos}).` : '',
    tot('janela_aberta') > 0 ? `${tot('janela_aberta')} com janela de 24h aberta (mensagem sem custo de template).` : 'Nenhum quente com janela de 24h aberta.',
    d ? `Ontem (${ddmm(ontem)}): ${d.matriculas} matrícula(s)${d.receita_liquida != null ? `, R$ ${fmtFolha(Number(d.receita_liquida), 'brl')} líquidos` : ''}.` : '',
  ]
  return partes.filter(Boolean).join(' ')
}

function Tabela({ sem, porDia, ontem }: { sem: Semana; porDia: Map<string, DiaFolha>; ontem: string }) {
  const v = useMemo(() => valoresDaSemana(sem, porDia, ontem), [sem, porDia, ontem])
  const secoes = [...new Set(v.linhas.map(l => l.secao))]
  return (
    <div className="tw">
      <table>
        <thead>
          <tr>
            <th colSpan={2}>MÉTRICA</th>
            {sem.dias.map((d, i) => <th key={d}>{DIA_SEMANA[i]}<small>{ddmm(d)}</small></th>)}
            <th>SEMANA¹<small>{v.parcial ? `parcial · ${v.diasFechados} dia${v.diasFechados === 1 ? '' : 's'}` : 'fechada'}</small></th>
          </tr>
        </thead>
        <tbody>
          {secoes.map(sec => {
            const ls = v.linhas.filter(l => l.secao === sec)
            return ls.map((l, i) => (
              <tr key={l.key} className={`${l.dst ? 'dst' : ''} ${i === ls.length - 1 ? 'fim' : ''}`}>
                {i === 0 && <td className="sec" rowSpan={ls.length} style={{ background: l.cor }}><span>{sec}</span></td>}
                <td className="lab">{l.label}</td>
                {l.dias.map((x, k) => <td key={k}>{fmtFolha(x, l.fmt)}</td>)}
                <td className="sem">{fmtFolha(l.semana, l.fmt)}</td>
              </tr>
            ))
          })}
        </tbody>
      </table>
    </div>
  )
}

function QuadroQuentes({ q }: { q: Quente[] }) {
  if (!q.length) return <p className="nota">Nenhuma conversa quente no momento.</p>
  const t = (k: keyof Quente) => q.reduce((a, x) => a + (Number(x[k]) || 0), 0)
  return (
    <div className="tw">
      <table className="q2">
        <thead>
          <tr><th>FRENTE</th><th>QUENTES</th><th>COM IA<small>e follow-up</small></th><th>COM HUMANO</th><th>ÓRFÃOS<small>sem humano nem follow-up</small></th>
            <th>JANELA 24H<small>aberta</small></th><th>PARADOS<small>há 7+ dias</small></th><th>MORNOS</th><th>TRAVA PRINCIPAL</th></tr>
        </thead>
        <tbody>
          {q.map(x => (
            <tr key={x.frente}>
              <td className="lab">{FRENTE_LABEL[x.frente] ?? x.frente}</td>
              <td><b>{x.quentes}</b></td><td>{x.com_ia_followup || ''}</td><td>{x.com_humano || ''}</td>
              <td className={x.orfaos > 0 ? 'alerta' : ''}>{x.orfaos || ''}</td>
              <td>{x.janela_aberta || ''}</td><td>{x.parados_7d || ''}</td><td>{x.mornos || ''}</td>
              <td className="esq">{x.trava_principal ? (TRAVA_LABEL[x.trava_principal] ?? x.trava_principal) : ''}</td>
            </tr>
          ))}
          <tr className="dst fim">
            <td className="lab">TOTAL</td><td>{t('quentes')}</td><td>{t('com_ia_followup')}</td><td>{t('com_humano')}</td>
            <td className="alerta">{t('orfaos')}</td><td>{t('janela_aberta')}</td><td>{t('parados_7d')}</td><td>{t('mornos')}</td><td></td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function QuadroCampanhas({ c }: { c: Camp[] }) {
  if (!c.length) return <p className="nota">Sem campanha com 10 ou mais conversas qualificadas nos últimos 7 dias.</p>
  return (
    <div className="tw">
      <table className="q2">
        <thead><tr><th>ORIGEM DA CONVERSA (últimos 7 dias)</th><th>CONVERSAS</th><th>QUENTES</th><th>% QUENTE</th><th>COMPRARAM</th></tr></thead>
        <tbody>
          {c.map(x => (
            <tr key={x.origem}>
              <td className="lab larga">{x.origem}</td><td>{x.conversas}</td><td>{x.quentes}</td>
              <td><b>{x.pct_quente}%</b></td><td>{x.compraram || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Historico({ dadosIniciais }: { dadosIniciais?: FolhaAnne }) {
  const [f, setF] = useState<FolhaAnne | null>(dadosIniciais ?? null)
  const [erro, setErro] = useState('')
  const hoje = f?.hoje ?? hojeManaus()
  const ontem = menosUm(hoje)
  const semanas = useMemo(() => semanasDaFolha(hoje, N_SEMANAS), [hoje])

  useEffect(() => {
    if (dadosIniciais) return
    const s = semanasDaFolha(hojeManaus(), N_SEMANAS)
    supabase.rpc('fn_folha_anne', { p_ini: s[s.length - 1].seg, p_fim: s[0].dom }).then(({ data, error }) => {
      if (error || !data) setErro(error?.message || 'sem dados')
      else setF(data as FolhaAnne)
    })
  }, [dadosIniciais])

  // classe no <body> libera altura/rolagem do layout na impressão (ver index.css)
  useEffect(() => {
    document.body.classList.add('imprimindo-folha')
    const limpar = () => { document.body.classList.remove('print-uma'); document.querySelectorAll('.folha.alvo').forEach(e => e.classList.remove('alvo')) }
    window.addEventListener('afterprint', limpar)
    return () => { document.body.classList.remove('imprimindo-folha'); window.removeEventListener('afterprint', limpar); limpar() }
  }, [])

  const imprimir = (seg?: string) => {
    document.querySelectorAll('.folha.alvo').forEach(e => e.classList.remove('alvo'))
    if (seg) {
      document.body.classList.add('print-uma')
      document.querySelector(`.folha[data-seg="${seg}"]`)?.classList.add('alvo')
    } else document.body.classList.remove('print-uma')
    window.print()
  }

  const porDia = useMemo(() => new Map((f?.dias ?? []).map(d => [d.dia, d])), [f])

  return (
    <div className="hist-scroll h-full overflow-y-auto p-4 md:p-6">
      <div className="hist-bar rise border border-line rounded-xl p-4 mb-4 bg-panel/50 max-w-6xl">
        <h1 className="font-display font-bold text-xl text-gold">📅 Histórico semana a semana</h1>
        <p className="text-xs text-dim mt-1">
          Folha de controle da Anne, no mesmo formato da folha do webinário. Dias fechados até ontem (dia de Manaus) ·
          Fontes: conversas e disparos da Anne · qualificação diária do Jev (06h30) · Hubla (receita líquida, pela data da compra).
        </p>
        <button onClick={() => imprimir()} disabled={!f}
          className="mt-3 text-sm font-semibold border border-line rounded-lg px-3 py-1.5 hover:bg-panel2 disabled:opacity-40">🖨️ Imprimir todas</button>
      </div>

      {erro && <div className="text-danger text-sm max-w-6xl">Não consegui carregar a folha: {erro}</div>}
      {!f && !erro && <div className="text-dim text-sm">Carregando a folha…</div>}

      {f && semanas.map((sem, i) => {
        const corrente = i === 0
        const fechados = sem.dias.filter(d => d <= ontem).length
        const semLiquido = sem.dias.reduce((a, d) => a + (d <= ontem ? (porDia.get(d)?.sem_liquido ?? 0) : 0), 0)
        return (
          <div className="folha max-w-6xl" data-seg={sem.seg} key={sem.seg}>
            <h3><span>CONTROLE SEMANAL DA ANNE</span><button onClick={() => imprimir(sem.seg)}>🖨️ Imprimir esta semana</button></h3>
            <p className="nota">{fechados < 7
              ? 'Semana em andamento: dados até ontem; a coluna SEMANA mostra a PARCIAL dos dias já fechados.'
              : 'Semana fechada.'}</p>
            <div className="cab"><span><b>OPERAÇÃO:</b> Anne Vendedora · todas as frentes</span><span><b>SEMANA:</b> {ddmmaaaa(sem.seg)} a {ddmmaaaa(sem.dom)}</span></div>
            {f.qualificacao_desde && sem.seg < f.qualificacao_desde && (
              <p className="nota">Qualificação do Jev no ar desde {ddmmaaaa(f.qualificacao_desde)}: nos dias anteriores o bloco QUALIFICAÇÃO fica em branco.</p>
            )}
            {semLiquido > 0 && <p className="nota alerta">{semLiquido} matrícula(s) desta semana ainda sem o valor líquido da Hubla — a receita entra na próxima atualização (06h30).</p>}
            <Tabela sem={sem} porDia={porDia} ontem={ontem} />
            {!corrente && <div className="leit">LEITURA DA SEMANA / AJUSTE OU TESTE PARA A PRÓXIMA:</div>}
            <div className="form">
              ¹ SEMANA: fluxos = soma dos dias fechados · estoque de quentes e órfãos = retrato do último dia fechado · tempo de resposta = média das medianas diárias.
              Conversão link → matrícula = matrículas ÷ links × 100 · Ticket = receita líquida ÷ matrículas · Custo dos templates = enviados × R$ 0,43 ·
              Matrículas = vendas atribuídas à Anne (IA, humano, disparo, blindado), pela data do pagamento.
            </div>

            {corrente && <div className="pagina2">
              <div className="sub">ONDE ESTÃO OS QUENTES HOJE <small>· retrato de agora ({ddmm(hoje)}), por frente</small></div>
              <QuadroQuentes q={f.quentes_hoje} />
              <div className="sub">QUALIDADE POR ORIGEM <small>· conversas com mensagem do lead nos últimos 7 dias</small></div>
              <QuadroCampanhas c={f.campanhas_7d} />
              <div className="leit">LEITURA DO DIA: <span>{leituraDoDia(f, ontem)}</span></div>
              <div className="form">
                Quente = classe A da qualificação do Jev (≥ 5 pontos: temperatura, engajamento, objeção, cartão, promessa de data, intenção) ·
                Órfão = quente com a IA ou adormecido, sem follow-up agendado e sem vendedor · Janela 24h aberta = pode receber mensagem sem template.
              </div>
            </div>}
          </div>
        )
      })}
    </div>
  )
}
