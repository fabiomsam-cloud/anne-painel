// anne/painel/dev/agendamento.tsx — harness SEM login: troca a RPC por um fixture para olhar a tela.
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import { supabase } from '../src/lib/supabase'
import { hojeManaus, maisDias, type Agendamento as Ag } from '../src/lib/agendamento'
import Agendamento from '../src/components/Agendamento'

const hoje = hojeManaus()
let n = 0
const ag = (o: Partial<Ag>): Ag => ({ id: `a${++n}`, conversation_id: `c${n}`, nome: `Lead ${n}`, phone: `55929000000${String(n).padStart(2, '0')}`,
  agent_slug: 'elite_tjam', frente: 'tjam', data: null, data_sugerida: null, status: 'agendado', origem: 'anne', criado_por: null,
  forma: 'cartão em 12x', obs: 'recebe dia 10', remarcacoes: 0, tentativas: 0, templates: 0, ultimo_erro: null, ativado_em: null,
  confirmado_em: null, fechado_em: null, created_at: hoje + 'T12:00:00Z', liquido: null, valor: null, ...o })
const linhas = [
  ag({ data: hoje }), ag({ data: hoje, status: 'confirmado', ativado_em: 'x', confirmado_em: 'x', templates: 1, origem: 'time', criado_por: 'luana@x.com' }),
  ag({ data: maisDias(hoje, -2), status: 'ativado', ativado_em: 'x', templates: 1, frente: 'prf', agent_slug: 'elite_prf' }),
  ag({ data: maisDias(hoje, -1), ultimo_erro: 'skipped_invalido', tentativas: 3 }),
  ag({ data: maisDias(hoje, 3), remarcacoes: 1 }), ag({ data: maisDias(hoje, 12) }),
  ag({ status: 'sem_data', data_sugerida: maisDias(hoje, 4), origem: 'qualificacao' }),
  ag({ data: maisDias(hoje, -12), status: 'matriculado', ativado_em: 'x', confirmado_em: 'x', templates: 1, liquido: 1397.5 }),
  ag({ data: maisDias(hoje, -10), status: 'nao_cumpriu', ativado_em: 'x', templates: 2 }),
]
;(supabase as any).rpc = async (fn: string) => fn === 'fn_agendamento_painel'
  ? { data: { hoje, ini: maisDias(hoje, -30), fim: hoje, tarifa: 0.43, prazo_dias: 7, ativo: false, linhas }, error: null }
  : { data: { ok: true }, error: null }

createRoot(document.getElementById('root')!).render(<Agendamento irParaInbox={id => alert('abrir ' + id)} />)
