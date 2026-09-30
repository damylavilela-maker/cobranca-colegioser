// Painel de Cobrança — Colégio Ser
// Servidor do site (Cloudflare Workers). Atende tudo que começa com /api/ e entrega
// os arquivos da pasta public/ para o resto. O banco é o Cloudflare D1, vinculado
// com o nome "DB" (veja wrangler.toml).

const COOKIE = "ser_sessao";
const SESSAO_HORAS = 8;            // sessão expira após 8h sem uso
const PBKDF2_ITER = 100000;        // limite máximo aceito pelo Workers
const MAX_TENTATIVAS = 5;
const BLOQUEIO_MIN = 15;
const FUSO = "America/Sao_Paulo";

const STATUS = ["sem_contato", "em_negociacao", "amortizando", "aguardando_retorno", "retornar_contato", "regularizado", "sem_previsao"];
const DIA_VENCIMENTO_MENSALIDADE = 5;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS usuarios (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    usuario TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL,
    senha_salt TEXT NOT NULL,
    perfil TEXT NOT NULL DEFAULT 'atendente',
    ativo INTEGER NOT NULL DEFAULT 1,
    trocar_senha INTEGER NOT NULL DEFAULT 0,
    tentativas INTEGER NOT NULL DEFAULT 0,
    bloqueado_ate INTEGER,
    ultimo_acesso TEXT,
    criado_em TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessoes (
    token_hash TEXT PRIMARY KEY,
    usuario_id TEXT NOT NULL,
    expira_em INTEGER NOT NULL,
    criado_em TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessoes_usuario ON sessoes(usuario_id)`,
  `CREATE TABLE IF NOT EXISTS alunos (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    ra TEXT NOT NULL DEFAULT '',
    turma TEXT NOT NULL DEFAULT '',
    responsavel TEXT NOT NULL DEFAULT '',
    telefone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    valor_aberto REAL NOT NULL DEFAULT 0,
    parcelas_aberto INTEGER,
    vencimento TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'sem_contato',
    setor TEXT NOT NULL DEFAULT '',
    atendente_responsavel TEXT NOT NULL DEFAULT '',
    ultimo_contato_data TEXT,
    ultimo_contato_canal TEXT,
    proximo_retorno TEXT,
    arquivado INTEGER NOT NULL DEFAULT 0,
    ultima_atualizacao_financeira TEXT,
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_alunos_ra ON alunos(ra)`,
  `CREATE TABLE IF NOT EXISTS atendimentos (
    id TEXT PRIMARY KEY,
    aluno_id TEXT NOT NULL,
    aluno_nome TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL,
    usuario_id TEXT,
    atendente_nome TEXT NOT NULL DEFAULT '',
    canal TEXT NOT NULL DEFAULT '',
    setor TEXT NOT NULL DEFAULT '',
    motivo TEXT NOT NULL DEFAULT '',
    observacao TEXT NOT NULL DEFAULT '',
    status_resultante TEXT NOT NULL DEFAULT 'sem_contato',
    proximo_retorno TEXT,
    valor_recuperado REAL NOT NULL DEFAULT 0,
    valor_recuperado_aberto REAL NOT NULL DEFAULT 0,
    faixa_atraso TEXT NOT NULL DEFAULT '',
    mensalidades TEXT NOT NULL DEFAULT '[]',
    valor_negociado_total REAL NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_atend_aluno ON atendimentos(aluno_id)`,
  `CREATE INDEX IF NOT EXISTS idx_atend_data ON atendimentos(data)`,
  // Controle de negativação: uma linha por parcela, como na planilha "SERASA - SER".
  `CREATE TABLE IF NOT EXISTS serasa (
    id TEXT PRIMARY KEY,
    ra TEXT NOT NULL DEFAULT '',
    nome TEXT NOT NULL DEFAULT '',
    responsavel TEXT NOT NULL DEFAULT '',
    cpf TEXT NOT NULL DEFAULT '',
    vencimento TEXT NOT NULL DEFAULT '',
    valor REAL NOT NULL DEFAULT 0,
    tipo TEXT NOT NULL DEFAULT '',
    mentor TEXT NOT NULL DEFAULT '',
    serasa TEXT NOT NULL DEFAULT '',
    data_inclusao TEXT NOT NULL DEFAULT '',
    resp_inclusao TEXT NOT NULL DEFAULT '',
    observacao TEXT NOT NULL DEFAULT '',
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL,
    atualizado_por TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS idx_serasa_ra ON serasa(ra)`,
  // Períodos de vencimento da aba Serasa (as "abas" da planilha).
  `CREATE TABLE IF NOT EXISTS serasa_periodos (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    inicio TEXT NOT NULL,
    fim TEXT NOT NULL,
    criado_em TEXT NOT NULL,
    criado_por TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS meta (chave TEXT PRIMARY KEY, valor TEXT NOT NULL)`,
  // Base de dados: cadastro completo dos alunos (relatório total do sistema). É a fonte dos
  // dados cadastrais que completam as outras abas quando um relatório vem cortado.
  `CREATE TABLE IF NOT EXISTS base_alunos (
    id TEXT PRIMARY KEY,
    ra TEXT NOT NULL DEFAULT '',
    nome TEXT NOT NULL DEFAULT '',
    turma TEXT NOT NULL DEFAULT '',
    responsavel TEXT NOT NULL DEFAULT '',
    cpf TEXT NOT NULL DEFAULT '',
    telefone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    situacao TEXT NOT NULL DEFAULT '',
    extras TEXT NOT NULL DEFAULT '{}',
    atualizado_em TEXT NOT NULL,
    atualizado_por TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS idx_base_ra ON base_alunos(ra)`,
  // Painel jurídico: casos da cobrança jurídica (GM Carvalho), tratativas e uma leitura por dia
  // dos totais (gráfico de evolução). Arquivar em vez de excluir.
  `CREATE TABLE IF NOT EXISTS jur_casos (
    id TEXT PRIMARY KEY,
    ra TEXT NOT NULL DEFAULT '',
    carteira TEXT NOT NULL DEFAULT '',
    ano TEXT NOT NULL DEFAULT '',
    aluno TEXT NOT NULL DEFAULT '',
    responsavel TEXT NOT NULL DEFAULT '',
    cpf TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    celular TEXT NOT NULL DEFAULT '',
    valor_negociado REAL,
    valor_aberto REAL,
    status TEXT NOT NULL DEFAULT 'nao_classificado',
    enviado_juridico INTEGER NOT NULL DEFAULT 0,
    data_envio_juridico TEXT NOT NULL DEFAULT '',
    motivo_pendencia TEXT NOT NULL DEFAULT '',
    flag_conflito INTEGER NOT NULL DEFAULT 0,
    arquivado INTEGER NOT NULL DEFAULT 0,
    arquivado_em TEXT NOT NULL DEFAULT '',
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL,
    atualizado_por TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS idx_jur_ra ON jur_casos(ra)`,
  `CREATE TABLE IF NOT EXISTS jur_obs (
    id TEXT PRIMARY KEY,
    caso_id TEXT NOT NULL,
    data TEXT NOT NULL,
    texto TEXT NOT NULL,
    autor TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS idx_jur_obs_caso ON jur_obs(caso_id)`,
  `CREATE TABLE IF NOT EXISTS jur_kpi (data TEXT PRIMARY KEY, dados TEXT NOT NULL)`,
  // pagamentos do relatório de recebimento já abatidos (não abate duas vezes o mesmo)
  `CREATE TABLE IF NOT EXISTS jur_receb_antes (caso_id TEXT PRIMARY KEY, status TEXT NOT NULL, valor_aberto REAL, criado_em TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS jur_pagamentos (chave TEXT PRIMARY KEY, caso_id TEXT NOT NULL, data TEXT NOT NULL DEFAULT '', valor REAL NOT NULL DEFAULT 0, criado_em TEXT NOT NULL, criado_por TEXT NOT NULL DEFAULT '')`,
  // relatórios de inadimplência por competência (mês de referência): cada importação é um mês
  // do histórico; importar de novo o mesmo mês substitui só aquele mês
  `CREATE TABLE IF NOT EXISTS jur_competencias (mes TEXT PRIMARY KEY, data_relatorio TEXT NOT NULL DEFAULT '', importado_em TEXT NOT NULL, importado_por TEXT NOT NULL DEFAULT '', arquivos TEXT NOT NULL DEFAULT '', resumo TEXT NOT NULL DEFAULT '{}')`,
  `CREATE TABLE IF NOT EXISTS jur_hist (mes TEXT NOT NULL, caso_id TEXT NOT NULL, valor_aberto REAL, valor_negociado REAL, parcelas_aberto INTEGER NOT NULL DEFAULT 0, parcelas_negociado INTEGER NOT NULL DEFAULT 0, contas TEXT NOT NULL DEFAULT '{}', ausente INTEGER NOT NULL DEFAULT 0, movimento TEXT NOT NULL DEFAULT '', conferir TEXT NOT NULL DEFAULT '', PRIMARY KEY (mes, caso_id))`,
  `CREATE INDEX IF NOT EXISTS idx_jur_hist_caso ON jur_hist(caso_id)`,
  // parcelas do acordo GM de cada caso (vindas da planilha da carteira)
  `CREATE TABLE IF NOT EXISTS jur_acordo_parcelas (id TEXT PRIMARY KEY, caso_id TEXT NOT NULL, acordo TEXT NOT NULL DEFAULT '', parcela TEXT NOT NULL DEFAULT '', vencimento TEXT NOT NULL DEFAULT '', valor REAL, pago REAL, data_pagamento TEXT NOT NULL DEFAULT '', saldo REAL, situacao TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS idx_jur_acordo_caso ON jur_acordo_parcelas(caso_id)`,
  // aba Cheques: cheques devolvidos e cheques recebidos (tipo), como nas abas da planilha CHEQUES_SER
  `CREATE TABLE IF NOT EXISTS cheques (
    id TEXT PRIMARY KEY, tipo TEXT NOT NULL, chave TEXT NOT NULL DEFAULT '',
    ra TEXT NOT NULL DEFAULT '', aluno TEXT NOT NULL DEFAULT '', responsavel TEXT NOT NULL DEFAULT '',
    emitente TEXT NOT NULL DEFAULT '', cpf_emitente TEXT NOT NULL DEFAULT '',
    banco TEXT NOT NULL DEFAULT '', agencia TEXT NOT NULL DEFAULT '', conta TEXT NOT NULL DEFAULT '', numero TEXT NOT NULL DEFAULT '',
    valor REAL, vencimento TEXT NOT NULL DEFAULT '', data_recebimento TEXT NOT NULL DEFAULT '',
    motivo TEXT NOT NULL DEFAULT '', pagamento TEXT NOT NULL DEFAULT '', geracao_mentor TEXT NOT NULL DEFAULT '', observacao TEXT NOT NULL DEFAULT '',
    motivo_devolucao TEXT NOT NULL DEFAULT '', data_devolucao TEXT NOT NULL DEFAULT '', data_formulario TEXT NOT NULL DEFAULT '', identificacao TEXT NOT NULL DEFAULT '',
    criado_em TEXT NOT NULL, criado_por TEXT NOT NULL DEFAULT '', atualizado_em TEXT NOT NULL, atualizado_por TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cheques_chave ON cheques(tipo, chave)`,
  // carteiras anuais do jurídico (nome e ano letivo do débito)
  `CREATE TABLE IF NOT EXISTS jur_carteiras (id TEXT PRIMARY KEY, nome TEXT NOT NULL UNIQUE, ano TEXT NOT NULL DEFAULT '', criado_em TEXT NOT NULL, criado_por TEXT NOT NULL DEFAULT '')`
];

// Períodos que já existiam na planilha "SERASA - SER", criados uma única vez. O nome é o
// da aba da planilha; as datas cobrem os vencimentos que estão de fato em cada aba.
const PERIODOS_INICIAIS = [
  ["RF 2024 - JANEIRO A ABRIL", "2023-12-01", "2024-04-30"],
  ["01/09 - 30/10_2024", "2024-05-01", "2024-09-30"],
  ["01/10 - 30/01", "2024-10-01", "2025-01-31"],
  ["01/02 - 30/04", "2025-02-01", "2025-04-30"],
  ["01/05 - 31/07_2025", "2025-05-01", "2025-07-31"],
  ["01/08 - 31/10/2025", "2025-08-01", "2025-10-31"],
  ["01/11 - 31/01/26", "2025-11-01", "2026-01-31"],
  ["01/02 - 31/03_2026", "2026-02-01", "2026-03-31"],
  ["01/04 - 30/06_2026", "2026-04-01", "2026-06-30"]
];

// Carteiras de alunos: "regular" (aba Painel) e "contraturno" (aba Contraturno).
const CARTEIRAS = ["regular", "contraturno"];
function carteiraValida(v) { return CARTEIRAS.includes(v) ? v : "regular"; }

// Situação da parcela no Mentor e no Serasa ("" = pendente).
const SERASA_STATUS = ["", "ok", "pago", "negociado", "juridico", "bloqueio", "nao_negativar"];
function statusSerasaValido(v) { return SERASA_STATUS.includes(v) ? v : ""; }

const ALUNO_COLS = ["id", "nome", "ra", "turma", "responsavel", "telefone", "email", "valor_aberto", "parcelas_aberto", "vencimento", "status", "setor", "atendente_responsavel", "ultimo_contato_data", "ultimo_contato_canal", "proximo_retorno", "arquivado", "ultima_atualizacao_financeira", "criado_em", "atualizado_em", "carteira"];
const SERASA_COLS = ["id", "ra", "nome", "responsavel", "cpf", "vencimento", "valor", "tipo", "mentor", "serasa", "data_inclusao", "resp_inclusao", "observacao", "criado_em", "atualizado_em", "atualizado_por", "periodo_id"];
const ATEND_COLS = ["id", "aluno_id", "aluno_nome", "data", "usuario_id", "atendente_nome", "canal", "setor", "motivo", "observacao", "status_resultante", "proximo_retorno", "valor_recuperado", "valor_recuperado_aberto", "faixa_atraso", "mensalidades", "valor_negociado_total", "criado_em"];

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

let schemaPronto = false;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return servirArquivo(request, env, url);
    try {
      if (!env.DB) throw new HttpError(500, "Banco de dados não vinculado. No painel da Cloudflare, adicione um vínculo D1 com o nome DB.");
      if (!schemaPronto) {
        await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
        // Bancos criados antes da aba Contraturno não têm a coluna "carteira".
        const cols = (await env.DB.prepare("PRAGMA table_info(alunos)").all()).results.map((c) => c.name);
        if (!cols.includes("carteira")) await env.DB.prepare("ALTER TABLE alunos ADD COLUMN carteira TEXT NOT NULL DEFAULT 'regular'").run();
        // vencimento e valor de cada parcela em aberto (JSON), para a faixa de atraso por parcela
        if (!cols.includes("parcelas_venc")) await env.DB.prepare("ALTER TABLE alunos ADD COLUMN parcelas_venc TEXT NOT NULL DEFAULT '[]'").run();
        // Cada parcela da Serasa pertence a um período (como uma linha pertence a uma aba da planilha).
        const colsSer = (await env.DB.prepare("PRAGMA table_info(serasa)").all()).results.map((c) => c.name);
        if (!colsSer.includes("periodo_id")) await env.DB.prepare("ALTER TABLE serasa ADD COLUMN periodo_id TEXT NOT NULL DEFAULT ''").run();
        // Casos do Painel jurídico criados antes da coluna de quantidade de parcelas em aberto.
        const colsJur = (await env.DB.prepare("PRAGMA table_info(jur_casos)").all()).results.map((c) => c.name);
        if (!colsJur.includes("parcelas")) await env.DB.prepare("ALTER TABLE jur_casos ADD COLUMN parcelas INTEGER NOT NULL DEFAULT 0").run();
        // tratativas: quem corrigiu e quando
        const colsObs = (await env.DB.prepare("PRAGMA table_info(jur_obs)").all()).results.map((c) => c.name);
        if (!colsObs.includes("editado_em")) await env.DB.batch(["ALTER TABLE jur_obs ADD COLUMN editado_em TEXT NOT NULL DEFAULT ''", "ALTER TABLE jur_obs ADD COLUMN editado_por TEXT NOT NULL DEFAULT ''"].map((s) => env.DB.prepare(s)));
        if (!colsJur.includes("extrato")) await env.DB.batch(["ALTER TABLE jur_casos ADD COLUMN extrato REAL", "ALTER TABLE jur_casos ADD COLUMN conta_financeira TEXT NOT NULL DEFAULT ''", "ALTER TABLE jur_casos ADD COLUMN link_drive TEXT NOT NULL DEFAULT ''"].map((s) => env.DB.prepare(s)));
        // mês de referência do último relatório em que o caso apareceu e motivo da conferência manual
        // parcelas do valor negociado e vencimento/valor de cada parcela do último relatório (vencidas × a vencer)
        if (!colsJur.includes("parcelas_negociado")) await env.DB.batch(["ALTER TABLE jur_casos ADD COLUMN parcelas_negociado INTEGER NOT NULL DEFAULT 0", "ALTER TABLE jur_casos ADD COLUMN parcelas_venc TEXT NOT NULL DEFAULT '[]'"].map((s) => env.DB.prepare(s)));
        // resumo do acordo GM (planilha da carteira)
        if (!colsJur.includes("acordo_tipo")) await env.DB.batch(["acordo_tipo TEXT NOT NULL DEFAULT ''", "acordo_valor REAL", "acordo_pago REAL", "acordo_saldo_aberto REAL", "acordo_saldo_vencer REAL", "acordo_parc_vencer INTEGER NOT NULL DEFAULT 0"].map((c) => env.DB.prepare("ALTER TABLE jur_casos ADD COLUMN " + c)));
        if (!colsJur.includes("competencia")) await env.DB.batch(["ALTER TABLE jur_casos ADD COLUMN competencia TEXT NOT NULL DEFAULT ''", "ALTER TABLE jur_casos ADD COLUMN conferir_motivo TEXT NOT NULL DEFAULT ''"].map((s) => env.DB.prepare(s)));
        // Cria os períodos da planilha uma única vez (se forem apagados, não voltam).
        // Só quem conseguir gravar a marca "periodos_iniciais" cria os períodos (evita duplicar
        // se duas pessoas abrirem o site ao mesmo tempo logo após a atualização).
        const agora = agoraISO();
        const marca = await env.DB.prepare("INSERT OR IGNORE INTO meta (chave, valor) VALUES ('periodos_iniciais', ?)").bind(agora).run();
        if (!marca.meta || marca.meta.changes > 0) {
          await env.DB.batch(PERIODOS_INICIAIS.map(([nome, ini, fim]) => env.DB.prepare(
            "INSERT INTO serasa_periodos (id, nome, inicio, fim, criado_em, criado_por) VALUES (?,?,?,?,?, 'planilha')").bind(novoId(), nome, ini, fim, agora)));
        }
        // Uma vez: renomeia os períodos já criados para os nomes exatos das abas da planilha
        // (só os que ainda estão com as datas originais).
        const renome = await env.DB.prepare("INSERT OR IGNORE INTO meta (chave, valor) VALUES ('periodos_nomes_planilha', ?)").bind(agora).run();
        if (!renome.meta || renome.meta.changes > 0) {
          await env.DB.batch(PERIODOS_INICIAIS.map(([nome, ini, fim]) => env.DB.prepare(
            "UPDATE serasa_periodos SET nome = ? WHERE criado_por = 'planilha' AND inicio = ? AND fim = ?").bind(nome, ini, fim)));
        }
        // Uma vez: apaga da base os campos sensíveis guardados pela 1ª versão (CPF, situação e demais colunas).
        const limpa = await env.DB.prepare("INSERT OR IGNORE INTO meta (chave, valor) VALUES ('base_sem_dados_sensiveis', ?)").bind(agora).run();
        if (!limpa.meta || limpa.meta.changes > 0) await env.DB.prepare("UPDATE base_alunos SET cpf = '', situacao = '', extras = '{}'").run();
        // Uma vez: nomes da Serasa que vieram cortados de PDF voltam a ser o nome completo da base (pelo RA).
        const nomes = await env.DB.prepare("INSERT OR IGNORE INTO meta (chave, valor) VALUES ('serasa_nomes_da_base', ?)").bind(agora).run();
        if (!nomes.meta || nomes.meta.changes > 0) await sincronizarComBase(env);
        // Uma vez: separa RA e nome que ficaram grudados na importação de PDF com título centralizado.
        const ras = await env.DB.prepare("INSERT OR IGNORE INTO meta (chave, valor) VALUES ('ra_com_nome_consertado', ?)").bind(agora).run();
        if (!ras.meta || ras.meta.changes > 0) await consertarRasSalvos(env);
        // Uma vez: todos os casos do Painel jurídico ficam como já enviados ao jurídico.
        const envj = await env.DB.prepare("INSERT OR IGNORE INTO meta (chave, valor) VALUES ('jur_todos_enviados', ?)").bind(agora).run();
        if (!envj.meta || envj.meta.changes > 0) await env.DB.prepare("UPDATE jur_casos SET enviado_juridico = 1").run();
        // Uma vez: status antigos do Painel jurídico viram os 4 da aba nova.
        const stj = await env.DB.prepare("INSERT OR IGNORE INTO meta (chave, valor) VALUES ('jur_status_simples', ?)").bind(agora).run();
        if (!stj.meta || stj.meta.changes > 0) await env.DB.batch([
          "UPDATE jur_casos SET status = 'em_negociacao' WHERE status IN ('em_dia', 'parcial')",
          "UPDATE jur_casos SET status = 'em_aberto' WHERE status NOT IN ('em_aberto', 'em_negociacao', 'verificar', 'quitado')"
        ].map((s) => env.DB.prepare(s)));
        schemaPronto = true;
      }
      return await rotear(request, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ erro: e.message, codigo: e.code || null }, e.status);
      console.error(e && e.stack || e);
      // o motivo vai junto (curto) para dar para saber o que houve sem acesso aos logs
      const motivo = String((e && e.message) || e || "").replace(/\s+/g, " ").slice(0, 160);
      return json({ erro: "Erro interno no servidor. Tente de novo em instantes." + (motivo ? " (Detalhe: " + motivo + ")" : "") }, 500);
    }
  }
};

// ---------------------------------------------------------------- arquivos do site

// Publicado pelo GitHub, as telas vêm da pasta public/ via env.ASSETS. Na versão
// "arquivo único" (dist/worker-completo.js) vêm embutidas em ARQUIVOS_EMBUTIDOS.
function servirArquivo(request, env, url) {
  if (typeof ARQUIVOS_EMBUTIDOS === "undefined") return env.ASSETS.fetch(request);
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Método não permitido", { status: 405 });
  const caminho = url.pathname === "/" ? "/index.html" : url.pathname;
  const arq = ARQUIVOS_EMBUTIDOS[caminho];
  if (!arq) return new Response("Página não encontrada", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const corpoArq = arq.base64 ? Uint8Array.from(atob(arq.base64), (c) => c.charCodeAt(0)) : arq.conteudo;
  return new Response(request.method === "HEAD" ? null : corpoArq, {
    headers: {
      "Content-Type": arq.tipo,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "same-origin"
    }
  });
}

// ---------------------------------------------------------------- rotas

async function rotear(req, env, url) {
  const caminho = url.pathname.replace(/\/+$/, "");
  const m = req.method;
  const partes = caminho.split("/").slice(2); // ["alunos", ":id"]

  // Toda requisição que altera dados precisa deste cabeçalho, que um site de terceiros
  // não consegue enviar sem autorização do navegador (proteção contra CSRF).
  if (m !== "GET" && req.headers.get("X-Painel") !== "1") throw new HttpError(403, "Requisição recusada.");

  if (caminho === "/api/setup" && m === "GET") return json({ precisaSetup: (await contarUsuarios(env)) === 0 });
  if (caminho === "/api/setup" && m === "POST") return setupInicial(req, env);
  if (caminho === "/api/login" && m === "POST") return login(req, env);
  if (caminho === "/api/logout" && m === "POST") return logout(req, env);

  const eu = await autenticar(req, env);

  if (caminho === "/api/me" && m === "GET") return json({ usuario: usuarioPublico(eu) });
  if (caminho === "/api/me/senha" && m === "POST") return trocarMinhaSenha(req, env, eu);
  if (eu.trocar_senha) throw new HttpError(403, "Troque sua senha provisória para continuar.", "trocar_senha");

  if (caminho === "/api/atendentes" && m === "GET") {
    const r = await env.DB.prepare("SELECT nome FROM usuarios WHERE ativo = 1 ORDER BY nome").all();
    return json({ atendentes: r.results.map((x) => x.nome) });
  }

  if (partes[0] === "usuarios") {
    exigirAdmin(eu);
    if (partes.length === 1 && m === "GET") return listarUsuarios(env);
    if (partes.length === 1 && m === "POST") return criarUsuario(req, env);
    if (partes.length === 2 && m === "PATCH") return alterarUsuario(req, env, eu, partes[1]);
    if (partes.length === 2 && m === "DELETE") return excluirUsuario(env, eu, partes[1]);
  }

  if (partes[0] === "alunos") {
    if (partes.length === 1 && m === "GET") return listarAlunos(env);
    if (partes.length === 1 && m === "POST") return criarAluno(req, env);
    if (partes[1] === "importar" && m === "POST") return importarPlanilha(req, env);
    if (partes[1] === "regularizar" && m === "POST") return regularizar(req, env, eu);
    if (partes.length === 2 && m === "PATCH") return alterarAluno(req, env, partes[1]);
  }

  if (partes[0] === "serasa" && partes[1] === "periodos") {
    if (partes.length === 2 && m === "GET") return listarPeriodos(env);
    if (partes.length === 2 && m === "POST") return salvarPeriodo(req, env, eu, null);
    if (partes.length === 3 && m === "PATCH") return salvarPeriodo(req, env, eu, partes[2]);
    if (partes.length === 3 && m === "DELETE") {
      // as parcelas do período continuam salvas, apenas ficam "sem período"
      await env.DB.batch([
        env.DB.prepare("UPDATE serasa SET periodo_id = '' WHERE periodo_id = ?").bind(partes[2]),
        env.DB.prepare("DELETE FROM serasa_periodos WHERE id = ?").bind(partes[2])
      ]);
      return json({ ok: true });
    }
  }

  if (partes[0] === "serasa") {
    if (partes.length === 1 && m === "GET") return listarSerasa(env);
    if (partes.length === 1 && m === "POST") return criarSerasa(req, env, eu);
    if (partes[1] === "importar" && m === "POST") return importarSerasa(req, env, eu);
    if (partes[1] === "lote" && m === "POST") return loteSerasa(req, env, eu);
    if (partes[1] === "inicio-negativacoes" && m === "POST") { exigirAdmin(eu); return definirInicioNegativacoes(req, env); }
    if (partes[1] === "duplicadas" && m === "GET") { exigirAdmin(eu); return duplicadasSerasa(env, eu, false); }
    if (partes[1] === "duplicadas" && m === "POST") { exigirAdmin(eu); return duplicadasSerasa(env, eu, true); }
    if (partes.length === 2 && m === "PATCH") return alterarSerasa(req, env, eu, partes[1]);
    if (partes.length === 2 && m === "DELETE") { exigirAdmin(eu); return excluirSerasa(env, partes[1]); }
  }

  if (partes[0] === "base") {
    if (partes.length === 1 && m === "GET") return listarBase(env);
    if (partes[1] === "importar" && m === "POST") return importarBase(req, env, eu);
  }

  if (partes[0] === "juridico") {
    if (partes.length === 1 && m === "GET") return listarJuridico(env);
    if (partes.length === 1 && m === "POST") return criarCasoJur(req, env, eu);
    if (partes[1] === "importar" && m === "POST") return importarJuridico(req, env, eu);
    if (partes[1] === "carteiras" && partes.length === 2 && m === "POST") return salvarCarteiraJur(req, env, eu, null);
    if (partes[1] === "carteiras" && partes.length === 3 && m === "PATCH") return salvarCarteiraJur(req, env, eu, partes[2]);
    if (partes[1] === "carteiras" && partes.length === 3 && m === "DELETE") return excluirCarteiraJur(env, partes[2]);
    if (partes[1] === "inadimplencia" && m === "POST") return inadimplenciaJuridico(req, env, eu);
    if (partes[1] === "competencias" && m === "GET") return competenciasJuridico(env);
    if (partes[1] === "quitar-sem-valor" && m === "POST") return quitarSemValorJur(req, env, eu);
    if (partes.length === 3 && partes[2] === "historico" && m === "GET") return historicoCasoJur(env, partes[1]);
    if (partes.length === 2 && m === "PATCH") return alterarCasoJur(req, env, eu, partes[1]);
    if (partes.length === 2 && m === "DELETE") { exigirAdmin(eu); return excluirCasoJur(env, partes[1]); }
    if (partes.length === 3 && partes[2] === "obs" && m === "POST") return novaObsJur(req, env, eu, partes[1]);
    if (partes.length === 4 && partes[2] === "obs" && m === "PATCH") return editarObsJur(req, env, eu, partes[1], partes[3]);
    if (partes.length === 4 && partes[2] === "obs" && m === "DELETE") return excluirObsJur(env, eu, partes[1], partes[3]);
  }
  if (partes[0] === "cheques") {
    if (partes.length === 1 && m === "GET") return listarCheques(env);
    if (partes.length === 1 && m === "POST") return salvarCheque(req, env, eu, null);
    if (partes[1] === "importar" && m === "POST") return importarCheques(req, env, eu);
    if (partes.length === 2 && m === "PATCH") return salvarCheque(req, env, eu, partes[1]);
    if (partes.length === 2 && m === "DELETE") return excluirCheque(env, partes[1]);
  }

  if (partes[0] === "atendimentos") {
    if (partes.length === 1 && m === "GET") return listarAtendimentos(env, url);
    if (partes.length === 1 && m === "POST") return criarAtendimento(req, env, eu);
    if (partes.length === 2 && m === "DELETE") return excluirAtendimento(env, eu, partes[1]);
  }

  if (caminho === "/api/admin/importar-backup" && m === "POST") {
    exigirAdmin(eu);
    return importarBackup(req, env);
  }

  throw new HttpError(404, "Endereço não encontrado.");
}

// ---------------------------------------------------------------- utilidades

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
  });
}

async function corpo(req) {
  try { return await req.json(); } catch { throw new HttpError(400, "Dados enviados em formato inválido."); }
}

function texto(v, max = 200) { return v == null ? "" : String(v).trim().slice(0, max); }
function numero(v) { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; }
function dataISO(v) { return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ""; }
function dataOuNull(v) { return dataISO(v) || null; }
function statusValido(v) { return STATUS.includes(v) ? v : "sem_contato"; }
function agoraISO() { return new Date().toISOString(); }
function hojeISO() { return new Date().toLocaleDateString("en-CA", { timeZone: FUSO }); }
function novoId() { return crypto.randomUUID().replace(/-/g, "").slice(0, 20); }

function faixaAtrasoDe(vencimento, dataAtend) {
  if (!vencimento || !dataAtend) return "";
  const dias = Math.round((new Date(dataAtend + "T00:00:00Z") - new Date(vencimento + "T00:00:00Z")) / 86400000);
  if (dias <= 0) return "em_dia";
  if (dias <= 30) return "30";
  if (dias <= 60) return "60";
  if (dias <= 90) return "90";
  return "90+";
}

function b64(buf) {
  let s = ""; const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function deB64(str) { return Uint8Array.from(atob(str), (c) => c.charCodeAt(0)); }
function hex(buf) { return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""); }

async function hashSenha(senha, saltB64) {
  const salt = saltB64 ? deB64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const chave = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITER }, chave, 256);
  return { hash: b64(bits), salt: saltB64 || b64(salt) };
}

function iguais(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function sha256(txt) { return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt))); }

function lerCookie(req, nome) {
  const c = req.headers.get("Cookie") || "";
  for (const parte of c.split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === nome) return v.join("=");
  }
  return null;
}

function cookieSessao(token) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

function validarSenha(s) {
  if (typeof s !== "string" || s.length < 8) throw new HttpError(400, "A senha precisa ter pelo menos 8 caracteres.");
  if (s.length > 200) throw new HttpError(400, "A senha é longa demais.");
}
function validarUsuario(u) {
  if (!/^[a-z0-9._-]{3,30}$/.test(u)) throw new HttpError(400, "O usuário deve ter de 3 a 30 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado.");
}

function usuarioPublico(u) {
  return {
    id: u.id, nome: u.nome, usuario: u.usuario, perfil: u.perfil, ativo: !!u.ativo,
    trocarSenha: !!u.trocar_senha, ultimoAcesso: u.ultimo_acesso || null, criadoEm: u.criado_em
  };
}

function exigirAdmin(u) {
  if (u.perfil !== "admin") throw new HttpError(403, "Somente administradores podem fazer isso.");
}

async function contarUsuarios(env) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM usuarios").first();
  return r ? r.n : 0;
}

function emLotes(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }
async function executarEmLotes(env, stmts) { for (const lote of emLotes(stmts, 50)) if (lote.length) await env.DB.batch(lote); }

function insertSQL(tabela, cols) {
  return `INSERT OR REPLACE INTO ${tabela} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`;
}

// ---------------------------------------------------------------- sessão

async function criarSessao(env, usuarioId) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const expira = Date.now() + SESSAO_HORAS * 3600 * 1000;
  await env.DB.prepare("INSERT INTO sessoes (token_hash, usuario_id, expira_em, criado_em) VALUES (?,?,?,?)")
    .bind(await sha256(token), usuarioId, expira, agoraISO()).run();
  return token;
}

async function autenticar(req, env) {
  const token = lerCookie(req, COOKIE);
  if (!token) throw new HttpError(401, "Entre com seu usuário e senha.", "sem_sessao");
  const th = await sha256(token);
  const s = await env.DB.prepare(
    "SELECT s.expira_em, u.* FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token_hash = ?"
  ).bind(th).first();
  if (!s || s.expira_em < Date.now() || !s.ativo) {
    if (s) await env.DB.prepare("DELETE FROM sessoes WHERE token_hash = ?").bind(th).run();
    throw new HttpError(401, "Sua sessão expirou. Entre novamente.", "sem_sessao");
  }
  // Renova a validade (janela deslizante) sem gravar a cada clique.
  const limite = SESSAO_HORAS * 3600 * 1000;
  if (s.expira_em - Date.now() < limite - 15 * 60 * 1000) {
    await env.DB.prepare("UPDATE sessoes SET expira_em = ? WHERE token_hash = ?").bind(Date.now() + limite, th).run();
  }
  return s;
}

async function setupInicial(req, env) {
  if ((await contarUsuarios(env)) > 0) throw new HttpError(409, "O painel já foi configurado. Entre com seu usuário e senha.");
  const b = await corpo(req);
  if (env.SETUP_KEY && b.chave !== env.SETUP_KEY) throw new HttpError(403, "Chave de configuração incorreta.");
  const nome = texto(b.nome, 80), usuario = texto(b.usuario, 30).toLowerCase();
  if (!nome) throw new HttpError(400, "Informe seu nome.");
  validarUsuario(usuario);
  validarSenha(b.senha);
  const { hash, salt } = await hashSenha(b.senha);
  const id = novoId();
  await env.DB.prepare(
    "INSERT INTO usuarios (id, nome, usuario, senha_hash, senha_salt, perfil, ativo, trocar_senha, criado_em, ultimo_acesso) VALUES (?,?,?,?,?, 'admin', 1, 0, ?, ?)"
  ).bind(id, nome, usuario, hash, salt, agoraISO(), agoraISO()).run();
  const token = await criarSessao(env, id);
  const u = await env.DB.prepare("SELECT * FROM usuarios WHERE id = ?").bind(id).first();
  return json({ usuario: usuarioPublico(u) }, 200, { "Set-Cookie": cookieSessao(token) });
}

async function login(req, env) {
  const b = await corpo(req);
  const usuario = texto(b.usuario, 30).toLowerCase();
  const senha = typeof b.senha === "string" ? b.senha : "";
  if (!usuario || !senha) throw new HttpError(400, "Informe usuário e senha.");

  await env.DB.prepare("DELETE FROM sessoes WHERE expira_em < ?").bind(Date.now()).run();
  const u = await env.DB.prepare("SELECT * FROM usuarios WHERE usuario = ?").bind(usuario).first();
  if (!u) {
    await hashSenha(senha); // mesmo tempo de resposta para usuário inexistente
    throw new HttpError(401, "Usuário ou senha incorretos. Confira e tente de novo.");
  }
  if (u.bloqueado_ate && u.bloqueado_ate > Date.now()) {
    const min = Math.ceil((u.bloqueado_ate - Date.now()) / 60000);
    throw new HttpError(429, `Muitas tentativas erradas. Tente de novo em ${min} minuto${min > 1 ? "s" : ""}.`);
  }
  const { hash } = await hashSenha(senha, u.senha_salt);
  if (!iguais(hash, u.senha_hash)) {
    const t = (u.tentativas || 0) + 1;
    const bloqueio = t >= MAX_TENTATIVAS ? Date.now() + BLOQUEIO_MIN * 60000 : null;
    await env.DB.prepare("UPDATE usuarios SET tentativas = ?, bloqueado_ate = ? WHERE id = ?")
      .bind(bloqueio ? 0 : t, bloqueio, u.id).run();
    if (bloqueio) throw new HttpError(429, `Muitas tentativas erradas. Acesso bloqueado por ${BLOQUEIO_MIN} minutos.`);
    throw new HttpError(401, "Usuário ou senha incorretos. Confira e tente de novo.");
  }
  if (!u.ativo) throw new HttpError(403, "Este acesso está desativado. Fale com a administração.");
  await env.DB.prepare("UPDATE usuarios SET tentativas = 0, bloqueado_ate = NULL, ultimo_acesso = ? WHERE id = ?")
    .bind(agoraISO(), u.id).run();
  const token = await criarSessao(env, u.id);
  return json({ usuario: usuarioPublico(u) }, 200, { "Set-Cookie": cookieSessao(token) });
}

async function logout(req, env) {
  const token = lerCookie(req, COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessoes WHERE token_hash = ?").bind(await sha256(token)).run();
  return json({ ok: true }, 200, { "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
}

async function trocarMinhaSenha(req, env, eu) {
  const b = await corpo(req);
  const { hash } = await hashSenha(typeof b.atual === "string" ? b.atual : "", eu.senha_salt);
  if (!iguais(hash, eu.senha_hash)) throw new HttpError(400, "A senha atual está incorreta.");
  validarSenha(b.nova);
  if (b.nova === b.atual) throw new HttpError(400, "A nova senha precisa ser diferente da atual.");
  const n = await hashSenha(b.nova);
  const tokenAtual = await sha256(lerCookie(req, COOKIE) || "");
  await env.DB.batch([
    env.DB.prepare("UPDATE usuarios SET senha_hash = ?, senha_salt = ?, trocar_senha = 0 WHERE id = ?").bind(n.hash, n.salt, eu.id),
    // encerra as outras sessões abertas desta pessoa (outros computadores)
    env.DB.prepare("DELETE FROM sessoes WHERE usuario_id = ? AND token_hash <> ?").bind(eu.id, tokenAtual)
  ]);
  return json({ ok: true });
}

// ---------------------------------------------------------------- usuários

async function listarUsuarios(env) {
  const r = await env.DB.prepare("SELECT * FROM usuarios ORDER BY ativo DESC, nome").all();
  return json({ usuarios: r.results.map(usuarioPublico) });
}

async function criarUsuario(req, env) {
  const b = await corpo(req);
  const nome = texto(b.nome, 80), usuario = texto(b.usuario, 30).toLowerCase();
  const perfil = b.perfil === "admin" ? "admin" : "atendente";
  if (!nome) throw new HttpError(400, "Informe o nome.");
  validarUsuario(usuario);
  validarSenha(b.senha);
  const existe = await env.DB.prepare("SELECT id FROM usuarios WHERE usuario = ?").bind(usuario).first();
  if (existe) throw new HttpError(409, `Já existe um acesso com o usuário "${usuario}". Escolha outro.`);
  const { hash, salt } = await hashSenha(b.senha);
  const id = novoId();
  await env.DB.prepare(
    "INSERT INTO usuarios (id, nome, usuario, senha_hash, senha_salt, perfil, ativo, trocar_senha, criado_em) VALUES (?,?,?,?,?,?,1,?,?)"
  ).bind(id, nome, usuario, hash, salt, perfil, b.trocarSenha === false ? 0 : 1, agoraISO()).run();
  const u = await env.DB.prepare("SELECT * FROM usuarios WHERE id = ?").bind(id).first();
  return json({ usuario: usuarioPublico(u) });
}

async function outrosAdminsAtivos(env, excetoId) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE perfil = 'admin' AND ativo = 1 AND id <> ?").bind(excetoId).first();
  return r ? r.n : 0;
}

async function alterarUsuario(req, env, eu, id) {
  const alvo = await env.DB.prepare("SELECT * FROM usuarios WHERE id = ?").bind(id).first();
  if (!alvo) throw new HttpError(404, "Usuário não encontrado.");
  const b = await corpo(req);
  const sets = [], vals = [];
  let derrubarSessoes = false;

  if (b.nome !== undefined) {
    const nome = texto(b.nome, 80);
    if (!nome) throw new HttpError(400, "O nome não pode ficar em branco.");
    sets.push("nome = ?"); vals.push(nome);
  }
  if (b.perfil !== undefined) {
    const perfil = b.perfil === "admin" ? "admin" : "atendente";
    if (alvo.id === eu.id && perfil !== "admin") throw new HttpError(400, "Você não pode tirar o seu próprio perfil de administrador.");
    if (alvo.perfil === "admin" && perfil !== "admin" && (await outrosAdminsAtivos(env, alvo.id)) === 0)
      throw new HttpError(400, "É preciso manter pelo menos um administrador ativo.");
    sets.push("perfil = ?"); vals.push(perfil);
  }
  if (b.ativo !== undefined) {
    const ativo = b.ativo ? 1 : 0;
    if (alvo.id === eu.id && !ativo) throw new HttpError(400, "Você não pode desativar o seu próprio acesso.");
    if (!ativo && alvo.perfil === "admin" && (await outrosAdminsAtivos(env, alvo.id)) === 0)
      throw new HttpError(400, "É preciso manter pelo menos um administrador ativo.");
    sets.push("ativo = ?"); vals.push(ativo);
    if (!ativo) derrubarSessoes = true;
  }
  if (b.senha !== undefined) {
    validarSenha(b.senha);
    const { hash, salt } = await hashSenha(b.senha);
    sets.push("senha_hash = ?", "senha_salt = ?", "tentativas = 0", "bloqueado_ate = NULL");
    vals.push(hash, salt);
    sets.push("trocar_senha = ?"); vals.push(b.trocarSenha === false ? 0 : 1);
    derrubarSessoes = true;
  }
  if (!sets.length) throw new HttpError(400, "Nada para alterar.");
  const stmts = [env.DB.prepare(`UPDATE usuarios SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id)];
  if (derrubarSessoes && alvo.id !== eu.id) stmts.push(env.DB.prepare("DELETE FROM sessoes WHERE usuario_id = ?").bind(id));
  await env.DB.batch(stmts);
  const u = await env.DB.prepare("SELECT * FROM usuarios WHERE id = ?").bind(id).first();
  return json({ usuario: usuarioPublico(u) });
}

async function excluirUsuario(env, eu, id) {
  if (id === eu.id) throw new HttpError(400, "Você não pode excluir o seu próprio acesso.");
  const alvo = await env.DB.prepare("SELECT * FROM usuarios WHERE id = ?").bind(id).first();
  if (!alvo) throw new HttpError(404, "Usuário não encontrado.");
  if (alvo.perfil === "admin" && alvo.ativo && (await outrosAdminsAtivos(env, id)) === 0)
    throw new HttpError(400, "É preciso manter pelo menos um administrador ativo.");
  // Os atendimentos feitos por esta pessoa continuam no histórico (com o nome dela).
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessoes WHERE usuario_id = ?").bind(id),
    env.DB.prepare("DELETE FROM usuarios WHERE id = ?").bind(id)
  ]);
  return json({ ok: true });
}

// ---------------------------------------------------------------- alunos

function alunoSaida(r) {
  return {
    id: r.id, nome: r.nome, ra: r.ra, turma: r.turma, responsavel: r.responsavel, telefone: r.telefone, email: r.email,
    valorAberto: r.valor_aberto, parcelasAberto: r.parcelas_aberto, vencimento: r.vencimento || "",
    status: r.status, setor: r.setor, atendenteResponsavel: r.atendente_responsavel,
    ultimoContato: r.ultimo_contato_data ? { data: r.ultimo_contato_data, canal: r.ultimo_contato_canal || "" } : null,
    proximoRetorno: r.proximo_retorno || null, arquivado: !!r.arquivado,
    ultimaAtualizacaoFinanceira: r.ultima_atualizacao_financeira || null,
    createdAt: r.criado_em, updatedAt: r.atualizado_em, carteira: r.carteira || "regular", parcelasVenc: lerParcelasVenc(r.parcelas_venc)
  };
}

// Parcelas em aberto do aluno: [[vencimento, valor], ...] (só o que o relatório importado trouxe).
function lerParcelasVenc(t) { try { const a = JSON.parse(t || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function parcelasVencJSON(lista) {
  const a = Array.isArray(lista) ? lista : [];
  return JSON.stringify(a.slice(0, 200).map((p) => [dataISO(p && p[0]), numero(p && p[1])]).filter((p) => p[0]).sort((x, y) => x[0].localeCompare(y[0])));
}

// Converte um aluno no formato do painel (camelCase) para os valores das colunas.
function alunoValores(o, id) {
  const agora = agoraISO();
  const uc = o.ultimoContato && typeof o.ultimoContato === "object" ? o.ultimoContato : null;
  const parc = parseInt(o.parcelasAberto, 10);
  return [
    id, texto(o.nome, 150) || "(sem nome)", texto(o.ra, 30), texto(o.turma, 80), texto(o.responsavel, 150),
    texto(o.telefone, 60), texto(o.email, 150), numero(o.valorAberto), Number.isFinite(parc) ? parc : null,
    dataISO(o.vencimento), statusValido(o.status), texto(o.setor, 40), texto(o.atendenteResponsavel, 80),
    uc ? dataOuNull(uc.data) : null, uc ? texto(uc.canal, 30) : null, dataOuNull(o.proximoRetorno),
    o.arquivado ? 1 : 0, typeof o.ultimaAtualizacaoFinanceira === "string" ? o.ultimaAtualizacaoFinanceira : null,
    typeof o.createdAt === "string" ? o.createdAt : agora, typeof o.updatedAt === "string" ? o.updatedAt : agora,
    carteiraValida(o.carteira)
  ];
}

// O mesmo aluno pode estar no Painel e no Contraturno (registros separados, um por
// carteira). Eles são ligados pelo RA ou, quando não há RA, pelo nome.
async function alunosVinculados(env, a) {
  const ra = (a.ra || "").trim().toLowerCase(), nome = (a.nome || "").trim().toLowerCase();
  const r = ra
    ? await env.DB.prepare("SELECT * FROM alunos WHERE id <> ? AND (lower(trim(ra)) = ? OR (trim(ra) = '' AND lower(trim(nome)) = ?))").bind(a.id, ra, nome).all()
    : await env.DB.prepare("SELECT * FROM alunos WHERE id <> ? AND lower(trim(nome)) = ?").bind(a.id, nome).all();
  return r.results;
}

async function listarAlunos(env) {
  const r = await env.DB.prepare("SELECT * FROM alunos ORDER BY nome").all();
  return json({ alunos: r.results.map(alunoSaida) });
}

async function buscarAluno(env, id) {
  const r = await env.DB.prepare("SELECT * FROM alunos WHERE id = ?").bind(id).first();
  if (!r) throw new HttpError(404, "Aluno não encontrado.");
  return r;
}

async function criarAluno(req, env) {
  const b = await corpo(req);
  if (!texto(b.nome)) throw new HttpError(400, "Informe o nome do aluno.");
  const id = novoId();
  const dados = { ...b, carteira: carteiraValida(b.carteira), status: "sem_contato", atendenteResponsavel: "", ultimoContato: null, proximoRetorno: null, arquivado: false, createdAt: null, updatedAt: null };
  await env.DB.prepare(insertSQL("alunos", ALUNO_COLS)).bind(...alunoValores(dados, id)).run();
  return json({ aluno: alunoSaida(await buscarAluno(env, id)) });
}

async function alterarAluno(req, env, id) {
  await buscarAluno(env, id);
  const b = await corpo(req);
  const campos = {
    nome: (v) => { const t = texto(v, 150); if (!t) throw new HttpError(400, "O nome do aluno não pode ficar em branco."); return t; },
    ra: (v) => texto(v, 30), turma: (v) => texto(v, 80), responsavel: (v) => texto(v, 150),
    telefone: (v) => texto(v, 60), email: (v) => texto(v, 150), setor: (v) => texto(v, 40),
    valorAberto: numero, vencimento: dataISO, arquivado: (v) => (v ? 1 : 0)
  };
  const colunas = { valorAberto: "valor_aberto" };
  const sets = [], vals = [];
  for (const k of Object.keys(campos)) {
    if (b[k] === undefined) continue;
    sets.push(`${colunas[k] || k} = ?`); vals.push(campos[k](b[k]));
  }
  if (!sets.length) throw new HttpError(400, "Nada para alterar.");
  sets.push("atualizado_em = ?"); vals.push(agoraISO());
  await env.DB.prepare(`UPDATE alunos SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id).run();
  return json({ aluno: alunoSaida(await buscarAluno(env, id)) });
}

// Recebe as linhas já agrupadas por aluno (uma por RA/nome) e faz a mesma conciliação
// do painel antigo: atualiza quem já existe, cadastra quem é novo e devolve a lista de
// alunos ativos que não vieram na planilha (provavelmente quitaram).
async function importarPlanilha(req, env) {
  const b = await corpo(req);
  const linhas = Array.isArray(b.linhas) ? b.linhas.slice(0, 5000) : [];
  if (!linhas.length) throw new HttpError(400, "Nenhuma linha para importar.");
  // A conciliação acontece só dentro da carteira da aba de onde veio a planilha.
  const carteira = carteiraValida(b.carteira);
  const todos = (await env.DB.prepare("SELECT * FROM alunos WHERE carteira = ?").bind(carteira).all()).results;
  const porRa = {}, porNome = {};
  todos.forEach((a) => {
    if (a.ra && a.ra.trim()) porRa[a.ra.trim().toLowerCase()] = a;
    if (a.nome) porNome[a.nome.trim().toLowerCase()] = a;
  });
  const ativosAntes = todos.filter((a) => !a.arquivado);
  const tocados = new Set();
  const agora = agoraISO();
  const stmts = [];
  let criados = 0, atualizados = 0, daBase = 0;
  const base = await carregarBase(env);

  for (const r0 of linhas) {
    if (!texto(r0.nome, 150)) continue;
    // completa com a Base de dados (nome inteiro, turma, responsável, contato)
    const r1 = consertarRa(r0), bx = acharNaBase(base, r1);
    const r = bx ? completarComBase(r1, bx) : r1;
    if (bx) daBase++;
    const nome = texto(r.nome, 150);
    const ra = texto(r.ra, 30);
    const achado = (ra && porRa[ra.toLowerCase()]) || porNome[nome.toLowerCase()] || porNome[texto(r0.nome, 150).toLowerCase()];
    if (achado) {
      if (tocados.has(achado.id)) continue;
      const sets = ["valor_aberto = ?", "parcelas_aberto = ?", "ultima_atualizacao_financeira = ?", "atualizado_em = ?", "parcelas_venc = ?"];
      const vals = [numero(r.valorAberto), parseInt(r.parcelas, 10) || 1, agora, agora, parcelasVencJSON(r0.parcelasVenc)];
      if (bx && bx.nome && bx.nome !== achado.nome) { sets.push("nome = ?"); vals.push(bx.nome); }
      const opc = { turma: texto(r.turma, 80), responsavel: texto(r.responsavel, 150), telefone: texto(r.telefone, 60), email: texto(r.email, 150) };
      for (const k of Object.keys(opc)) if (opc[k]) { sets.push(`${k} = ?`); vals.push(opc[k]); }
      if (ra && !achado.ra) { sets.push("ra = ?"); vals.push(ra); }
      if (dataISO(r.vencimento) && !achado.vencimento) { sets.push("vencimento = ?"); vals.push(dataISO(r.vencimento)); }
      if (achado.arquivado) sets.push("arquivado = 0");
      stmts.push(env.DB.prepare(`UPDATE alunos SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, achado.id));
      tocados.add(achado.id);
      atualizados++;
    } else {
      const id = novoId();
      const novo = {
        ra, nome, turma: r.turma, responsavel: r.responsavel, telefone: r.telefone, email: r.email,
        valorAberto: r.valorAberto, parcelasAberto: parseInt(r.parcelas, 10) || 1, vencimento: r.vencimento,
        status: "sem_contato", setor: "", atendenteResponsavel: "", arquivado: false,
        ultimaAtualizacaoFinanceira: agora, createdAt: agora, updatedAt: agora, carteira
      };
      stmts.push(env.DB.prepare(insertSQL("alunos", ALUNO_COLS)).bind(...alunoValores(novo, id)));
      stmts.push(env.DB.prepare("UPDATE alunos SET parcelas_venc = ? WHERE id = ?").bind(parcelasVencJSON(r0.parcelasVenc), id));
      porNome[nome.toLowerCase()] = { id, nome, ra };
      if (ra) porRa[ra.toLowerCase()] = { id, nome, ra };
      tocados.add(id);
      criados++;
    }
  }
  await executarEmLotes(env, stmts);
  const foraDaPlanilha = ativosAntes.filter((a) => !tocados.has(a.id)).map((a) => ({ id: a.id, nome: a.nome, valorAberto: a.valor_aberto }));
  return json({ criados, atualizados, foraDaPlanilha, daBase });
}

// Marca alunos como regularizados e registra o valor em aberto deles como recuperado.
async function regularizar(req, env, eu) {
  const b = await corpo(req);
  const ids = Array.isArray(b.ids) ? b.ids.slice(0, 2000).map(String) : [];
  if (!ids.length) throw new HttpError(400, "Selecione ao menos um aluno.");
  const hoje = hojeISO(), agora = agoraISO();
  const stmts = [];
  let ok = 0;
  for (const lote of emLotes(ids, 50)) {
    const r = await env.DB.prepare(`SELECT * FROM alunos WHERE id IN (${lote.map(() => "?").join(",")})`).bind(...lote).all();
    for (const a of r.results) {
      const valor = numero(a.valor_aberto);
      stmts.push(env.DB.prepare(insertSQL("atendimentos", ATEND_COLS)).bind(
        novoId(), a.id, a.nome, hoje, eu.id, eu.nome, "Presencial", a.setor || "",
        "Regularização via importação de planilha",
        "Aluno não constava na planilha importada mais recente — marcado como regularizado.",
        "regularizado", null, valor, valor, faixaAtrasoDe(a.vencimento, hoje), "[]", 0, agora
      ));
      stmts.push(env.DB.prepare(
        "UPDATE alunos SET status = 'regularizado', valor_aberto = 0, ultimo_contato_data = ?, ultimo_contato_canal = 'Presencial', atualizado_em = ? WHERE id = ?"
      ).bind(hoje, agora, a.id));
      ok++;
    }
  }
  await executarEmLotes(env, stmts);
  return json({ regularizados: ok });
}

// ---------------------------------------------------------------- atendimentos

function atendSaida(r) {
  let mens = [];
  try { mens = JSON.parse(r.mensalidades || "[]"); } catch { mens = []; }
  return {
    id: r.id, alunoId: r.aluno_id, alunoNome: r.aluno_nome, data: r.data, usuarioId: r.usuario_id,
    responsavel: r.atendente_nome, canal: r.canal, setor: r.setor, motivo: r.motivo, observacao: r.observacao,
    statusResultante: r.status_resultante, proximoRetorno: r.proximo_retorno || null,
    valorRecuperado: r.valor_recuperado, valorRecuperadoAberto: r.valor_recuperado_aberto,
    faixaAtraso: r.faixa_atraso, mensalidadesNegociadas: mens, valorNegociadoTotal: r.valor_negociado_total,
    createdAt: r.criado_em
  };
}

function mensalidadesValidas(lista) {
  if (!Array.isArray(lista)) return [];
  // tipo: mensalidade, acordo ou cheque (registros antigos, sem tipo, são mensalidades)
  return lista.slice(0, 108)
    .filter((m) => m && typeof m.mes === "string" && /^\d{4}-\d{2}$/.test(m.mes))
    .map((m) => ({ tipo: ["acordo", "cheque"].includes(m.tipo) ? m.tipo : "mensalidade", mes: m.mes, valor: numero(m.valor) }));
}

async function listarAtendimentos(env, url) {
  const alunoId = url.searchParams.get("alunoId");
  const r = alunoId
    ? await env.DB.prepare("SELECT * FROM atendimentos WHERE aluno_id = ? ORDER BY criado_em DESC").bind(alunoId).all()
    : await env.DB.prepare("SELECT * FROM atendimentos ORDER BY criado_em DESC LIMIT 20000").all();
  return json({ atendimentos: r.results.map(atendSaida) });
}

async function criarAtendimento(req, env, eu) {
  const b = await corpo(req);
  const aluno = await buscarAluno(env, texto(b.alunoId, 40));
  const data = dataISO(b.data) || hojeISO();
  const canal = texto(b.canal, 30), setor = texto(b.setor, 40);
  const status = statusValido(b.statusResultante);
  const proximo = dataOuNull(b.proximoRetorno);
  const mens = mensalidadesValidas(b.mensalidadesNegociadas);
  const totalNegociado = numero(mens.reduce((s, m) => s + m.valor, 0));
  const temValorNovo = b.valorNovo !== null && b.valorNovo !== undefined && b.valorNovo !== "";
  const valorNovo = temValorNovo ? Math.max(0, numero(b.valorNovo)) : null;
  const recAberto = temValorNovo && valorNovo < aluno.valor_aberto ? numero(aluno.valor_aberto - valorNovo) : 0;
  const agora = agoraISO();
  const id = novoId();

  const stmts = [
    env.DB.prepare(insertSQL("atendimentos", ATEND_COLS)).bind(
      id, aluno.id, aluno.nome, data, eu.id, eu.nome, canal, setor, texto(b.motivo, 150), texto(b.observacao, 4000),
      status, proximo, numero(recAberto + totalNegociado), recAberto, faixaAtrasoDe(aluno.vencimento, data),
      JSON.stringify(mens), totalNegociado, agora
    )
  ];
  const sets = ["status = ?", "atendente_responsavel = ?", "setor = ?", "ultimo_contato_data = ?", "ultimo_contato_canal = ?", "proximo_retorno = ?", "arquivado = 0", "atualizado_em = ?"];
  const vals = [status, eu.nome, setor, data, canal, proximo, agora];
  if (temValorNovo) { sets.push("valor_aberto = ?"); vals.push(valorNovo); }
  stmts.push(env.DB.prepare(`UPDATE alunos SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, aluno.id));

  // Se o mesmo aluno está na outra carteira (Painel ↔ Contraturno), o contato também vale
  // lá: atualiza último atendimento, próximo retorno e atendente. Status e valor em aberto
  // continuam próprios de cada carteira.
  const vinculados = await alunosVinculados(env, aluno);
  for (const v of vinculados) {
    stmts.push(env.DB.prepare(
      "UPDATE alunos SET atendente_responsavel = ?, ultimo_contato_data = ?, ultimo_contato_canal = ?, proximo_retorno = ?, atualizado_em = ? WHERE id = ?"
    ).bind(eu.nome, data, canal, proximo, agora, v.id));
  }
  await env.DB.batch(stmts);

  const at = await env.DB.prepare("SELECT * FROM atendimentos WHERE id = ?").bind(id).first();
  const atualizados = [];
  for (const v of vinculados) atualizados.push(alunoSaida(await buscarAluno(env, v.id)));
  return json({ atendimento: atendSaida(at), aluno: alunoSaida(await buscarAluno(env, aluno.id)), vinculados: atualizados });
}

async function excluirAtendimento(env, eu, id) {
  const at = await env.DB.prepare("SELECT * FROM atendimentos WHERE id = ?").bind(id).first();
  if (!at) throw new HttpError(404, "Atendimento não encontrado.");
  if (eu.perfil !== "admin" && at.usuario_id !== eu.id)
    throw new HttpError(403, "Só quem registrou o atendimento ou um administrador pode excluí-lo.");
  await env.DB.prepare("DELETE FROM atendimentos WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

// ---------------------------------------------------------------- migração do painel antigo

// Recebe { alunos: {id: {...}}, atendimentos: {id: {...}} } exatamente no formato do
// painel antigo e grava tudo, mantendo os mesmos ids (rodar duas vezes não duplica).
async function importarBackup(req, env) {
  const b = await corpo(req);
  const alunos = b && typeof b.alunos === "object" && b.alunos ? b.alunos : {};
  const atends = b && typeof b.atendimentos === "object" && b.atendimentos ? b.atendimentos : {};
  const idOk = (id) => /^[A-Za-z0-9_\-]{1,60}$/.test(id);
  const stmts = [];
  let na = 0, nt = 0;

  for (const [id, a] of Object.entries(alunos)) {
    if (!idOk(id) || !a || typeof a !== "object") continue;
    stmts.push(env.DB.prepare(insertSQL("alunos", ALUNO_COLS)).bind(...alunoValores(a, id)));
    na++;
  }
  for (const [id, t] of Object.entries(atends)) {
    if (!idOk(id) || !t || typeof t !== "object" || !t.alunoId) continue;
    const mens = mensalidadesValidas(t.mensalidadesNegociadas);
    stmts.push(env.DB.prepare(insertSQL("atendimentos", ATEND_COLS)).bind(
      id, texto(t.alunoId, 60), texto(t.alunoNome, 150), dataISO(t.data) || hojeISO(), null, texto(t.responsavel, 80),
      texto(t.canal, 30), texto(t.setor, 40), texto(t.motivo, 150), texto(t.observacao, 4000),
      statusValido(t.statusResultante), dataOuNull(t.proximoRetorno), numero(t.valorRecuperado),
      numero(t.valorRecuperadoAberto), texto(t.faixaAtraso, 10), JSON.stringify(mens), numero(t.valorNegociadoTotal),
      typeof t.createdAt === "string" ? t.createdAt : agoraISO()
    ));
    nt++;
  }
  if (!stmts.length) throw new HttpError(400, "O arquivo não tem alunos nem atendimentos no formato esperado.");
  await executarEmLotes(env, stmts);
  return json({ alunos: na, atendimentos: nt });
}

// ---------------------------------------------------------------- Serasa (negativação)

function serasaSaida(r) {
  return {
    id: r.id, ra: r.ra, nome: r.nome, responsavel: r.responsavel, cpf: r.cpf, vencimento: r.vencimento,
    valor: r.valor, tipo: r.tipo, mentor: r.mentor, serasa: r.serasa, dataInclusao: r.data_inclusao,
    respInclusao: r.resp_inclusao, observacao: r.observacao, criadoEm: r.criado_em,
    atualizadoEm: r.atualizado_em, atualizadoPor: r.atualizado_por, periodoId: r.periodo_id || ""
  };
}

function serasaValores(o, id, eu, criadoEm) {
  const agora = agoraISO();
  return [
    id, texto(o.ra, 30), texto(o.nome, 150), texto(o.responsavel, 150), texto(o.cpf, 20), dataISO(o.vencimento),
    numero(o.valor), texto(o.tipo, 40), statusSerasaValido(o.mentor), statusSerasaValido(o.serasa),
    dataISO(o.dataInclusao), texto(o.respInclusao, 80), texto(o.observacao, 2000),
    criadoEm || agora, agora, eu ? eu.nome : "", texto(o.periodoId, 40)
  ];
}

// Identifica a mesma parcela entre importações: aluno (RA ou nome) + vencimento + valor + tipo.
function chaveSerasa(o) {
  const ra = texto(o.ra, 30).toLowerCase();
  const quem = ra || ("nm:" + (texto(o.nome, 150) || texto(o.responsavel, 150)).toLowerCase());
  return [quem, dataISO(o.vencimento), numero(o.valor).toFixed(2), texto(o.tipo, 40).toLowerCase()].join("|");
}

async function buscarSerasa(env, id) {
  const r = await env.DB.prepare("SELECT * FROM serasa WHERE id = ?").bind(id).first();
  if (!r) throw new HttpError(404, "Parcela não encontrada.");
  return r;
}

async function listarSerasa(env) {
  const r = await env.DB.prepare("SELECT * FROM serasa ORDER BY vencimento DESC, nome").all();
  const ini = await env.DB.prepare("SELECT valor FROM meta WHERE chave = 'serasa_neg_inicio'").first();
  return json({ parcelas: r.results.map(serasaSaida), negInicio: ini ? ini.valor : "" });
}

// "Zerar" a tabela de negativações por mês: ela passa a contar só inclusões a partir desta data.
// Nada é apagado; data vazia volta a contar tudo.
async function definirInicioNegativacoes(req, env) {
  const b = await corpo(req);
  const data = dataISO(b.data);
  if (data) await env.DB.prepare("INSERT OR REPLACE INTO meta (chave, valor) VALUES ('serasa_neg_inicio', ?)").bind(data).run();
  else await env.DB.prepare("DELETE FROM meta WHERE chave = 'serasa_neg_inicio'").run();
  return json({ negInicio: data });
}

async function criarSerasa(req, env, eu) {
  const b = await corpo(req);
  if (!texto(b.nome) && !texto(b.responsavel)) throw new HttpError(400, "Informe o nome do aluno ou do responsável.");
  if (!dataISO(b.vencimento)) throw new HttpError(400, "Informe o vencimento da parcela.");
  const id = novoId();
  await env.DB.prepare(insertSQL("serasa", SERASA_COLS)).bind(...serasaValores(b, id, eu)).run();
  return json({ parcela: serasaSaida(await buscarSerasa(env, id)) });
}

async function alterarSerasa(req, env, eu, id) {
  const atual = await buscarSerasa(env, id);
  const b = await corpo(req);
  const junto = { ...serasaSaida(atual), ...b };
  if (!texto(junto.nome) && !texto(junto.responsavel)) throw new HttpError(400, "Informe o nome do aluno ou do responsável.");
  await env.DB.prepare(insertSQL("serasa", SERASA_COLS)).bind(...serasaValores(junto, id, eu, atual.criado_em)).run();
  return json({ parcela: serasaSaida(await buscarSerasa(env, id)) });
}

async function excluirSerasa(env, id) {
  await buscarSerasa(env, id);
  await env.DB.prepare("DELETE FROM serasa WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

// Importa o relatório de um período (uma aba da planilha). Cada linha vai para o período
// escolhido na tela ou, se o arquivo tiver a coluna PERÍODO, para o período daquela linha
// (períodos que ainda não existem são criados). A mesma parcela pode estar em dois
// períodos, como na planilha. Parcela que já existe no período só recebe os campos que
// vieram preenchidos — nada que a equipe já marcou é apagado. Parcelas antigas ainda sem
// período são aproveitadas (recebem o período) em vez de duplicadas.
async function importarSerasa(req, env, eu) {
  const b = await corpo(req);
  // simular: calcula tudo sem gravar (para mostrar antes). espelhar: o período fica igual ao arquivo.
  const simular = b.simular === true, espelhar = b.espelhar === true;
  const linhas = Array.isArray(b.linhas) ? b.linhas.slice(0, 10000) : [];
  if (!linhas.length) throw new HttpError(400, "Nenhuma linha para importar.");

  const periodos = (await env.DB.prepare("SELECT * FROM serasa_periodos").all()).results;
  const porNome = {}, ids = new Set();
  periodos.forEach((p) => { porNome[p.nome.trim().toLowerCase()] = p.id; ids.add(p.id); });
  const padrao = ids.has(texto(b.periodoId, 40)) ? texto(b.periodoId, 40) : "";
  // períodos citados no arquivo que ainda não existem: cria, com as datas dos vencimentos
  const novos = {};
  linhas.forEach((l) => {
    const n = texto(l.periodo, 60); if (!n || porNome[n.toLowerCase()]) return;
    const v = dataISO(l.vencimento), k = n.toLowerCase();
    if (!novos[k]) novos[k] = { nome: n, ini: v, fim: v };
    if (v && (!novos[k].ini || v < novos[k].ini)) novos[k].ini = v;
    if (v && (!novos[k].fim || v > novos[k].fim)) novos[k].fim = v;
  });
  const criadosPeriodos = [];
  for (const k of Object.keys(novos)) {
    const p = novos[k], id = simular ? "novo:" + k : novoId();
    if (!simular) await env.DB.prepare("INSERT INTO serasa_periodos (id, nome, inicio, fim, criado_em, criado_por) VALUES (?,?,?,?,?,?)")
      .bind(id, p.nome, p.ini || hojeISO(), p.fim || hojeISO(), agoraISO(), eu.nome).run();
    porNome[k] = id; criadosPeriodos.push(p.nome);
  }
  if (!padrao && linhas.some((l) => !texto(l.periodo))) throw new HttpError(400, "Escolha o período para onde vão as parcelas deste arquivo.");

  // Linhas idênticas na mesma aba são parcelas diferentes (ex.: duas cobranças iguais):
  // a 1ª linha do arquivo corresponde à 1ª parcela igual já salva no período, a 2ª à 2ª…
  const noPeriodo = {}, semPeriodo = {};
  (await env.DB.prepare("SELECT * FROM serasa ORDER BY criado_em, id").all()).results.forEach((r) => {
    const k = chaveSerasa(serasaSaida(r));
    if (r.periodo_id) (noPeriodo[r.periodo_id + "#" + k] = noPeriodo[r.periodo_id + "#" + k] || []).push(r);
    else (semPeriodo[k] = semPeriodo[k] || []).push(r);
  });
  const stmts = [];
  let criados = 0, atualizados = 0, iguais = 0, incompletas = 0, repetidas = 0;
  const ocorrencia = {}, porPeriodo = {}, usados = new Set();
  // compara tudo menos as datas de criação/alteração e quem alterou
  const comparavel = (o, id) => { const v = serasaValores(o, id, null); return JSON.stringify(v.slice(0, 13).concat(v.slice(16))); };
  const base = await carregarBase(env);
  for (const l0 of linhas) {
    const l = completarSerasaComBase(consertarRa(l0), base);
    if ((!texto(l.nome) && !texto(l.responsavel)) || !dataISO(l.vencimento)) { incompletas++; continue; }
    const pid = texto(l.periodo) ? porNome[texto(l.periodo, 60).toLowerCase()] : padrao;
    const k = chaveSerasa(l), kp = pid + "#" + k;
    const n = ocorrencia[kp] = (ocorrencia[kp] || 0) + 1;
    if (n > 1) repetidas++; // informativo: linha igual a outra da mesma aba (também é importada)
    porPeriodo[pid] = (porPeriodo[pid] || 0) + 1;
    let achado = (noPeriodo[kp] || [])[n - 1];
    if (!achado && semPeriodo[k] && semPeriodo[k].length) achado = semPeriodo[k].shift();
    if (achado) {
      usados.add(achado.id);
      const base = serasaSaida(achado);
      const junto = { ...base, periodoId: pid };
      ["nome", "responsavel", "cpf", "tipo", "respInclusao", "observacao"].forEach((c) => { if (texto(l[c])) junto[c] = l[c]; });
      // nome cortado (PDF do Google Planilhas) não substitui o nome completo já salvo
      if (texto(base.nome).length > texto(l.nome).length && texto(base.nome).toUpperCase().startsWith(texto(l.nome).toUpperCase())) junto.nome = base.nome;
      ["mentor", "serasa"].forEach((c) => { if (statusSerasaValido(l[c])) junto[c] = l[c]; });
      if (dataISO(l.dataInclusao)) junto.dataInclusao = l.dataInclusao;
      const mudou = comparavel(junto, achado.id) !== comparavel(base, achado.id);
      if (!mudou) { iguais++; continue; }
      stmts.push(env.DB.prepare(insertSQL("serasa", SERASA_COLS)).bind(...serasaValores(junto, achado.id, eu, achado.criado_em)));
      atualizados++;
    } else {
      stmts.push(env.DB.prepare(insertSQL("serasa", SERASA_COLS)).bind(...serasaValores({ ...l, periodoId: pid }, novoId(), eu)));
      criados++;
    }
  }
  // Período igual ao arquivo: o que está no período e não veio no arquivo sai dele. Se a mesma
  // parcela existe em outro lugar (outra aba ou repetida aqui), é cópia e é apagada, passando as
  // marcações da equipe para a que fica; se não existe em outro lugar, vai para "Sem período".
  let copiasApagadas = 0, paraSemPeriodo = 0;
  const saem = [];
  if (espelhar) {
    const alvos = new Set(Object.keys(porPeriodo).filter((p) => p && !p.startsWith("novo:")));
    const todas = Object.values(noPeriodo).flat();
    const porChave = {};
    todas.forEach((r) => { const k = chaveSerasa(serasaSaida(r)); (porChave[k] = porChave[k] || []).push(r); });
    const marcas = ["mentor", "serasa", "data_inclusao", "resp_inclusao", "observacao"];
    for (const r of todas) {
      if (!alvos.has(r.periodo_id) || usados.has(r.id)) continue;
      const k = chaveSerasa(serasaSaida(r));
      const outra = (porChave[k] || []).find((o) => o.id !== r.id && (usados.has(o.id) || !alvos.has(o.periodo_id)));
      if (outra) {
        const sets = [], vals = [];
        marcas.forEach((c) => { if (r[c]) { sets.push(`${c} = CASE WHEN ${c} = '' THEN ? ELSE ${c} END`); vals.push(r[c]); } });
        if (sets.length) stmts.push(env.DB.prepare(`UPDATE serasa SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, outra.id));
        stmts.push(env.DB.prepare("DELETE FROM serasa WHERE id = ?").bind(r.id));
        copiasApagadas++;
      } else {
        stmts.push(env.DB.prepare("UPDATE serasa SET periodo_id = '', atualizado_em = ?, atualizado_por = ? WHERE id = ?").bind(agoraISO(), eu.nome, r.id));
        paraSemPeriodo++;
      }
      if (saem.length < 300) saem.push({ nome: r.nome || r.responsavel, ra: r.ra, vencimento: r.vencimento, valor: r.valor, destino: outra ? "cópia (apagada)" : "Sem período" });
    }
  }
  // (as linhas do arquivo já vieram completadas com a Base de dados; a base inteira é
  // sincronizada quando ela é importada)
  if (!simular) await executarEmLotes(env, stmts);
  return json({ simulacao: simular, criados, atualizados, iguais, incompletas, repetidas, ignorados: iguais + incompletas + repetidas, periodosCriados: criadosPeriodos, porPeriodo, copiasApagadas, paraSemPeriodo, saem });
}

// Atualiza várias parcelas de uma vez (ex.: "incluídas no Serasa hoje").
async function loteSerasa(req, env, eu) {
  const b = await corpo(req);
  const ids = Array.isArray(b.ids) ? b.ids.slice(0, 5000).map(String) : [];
  if (!ids.length) throw new HttpError(400, "Selecione ao menos uma parcela.");
  const sets = [], vals = [];
  if (b.mentor !== undefined) { sets.push("mentor = ?"); vals.push(statusSerasaValido(b.mentor)); }
  if (b.serasa !== undefined) { sets.push("serasa = ?"); vals.push(statusSerasaValido(b.serasa)); }
  if (b.periodoId !== undefined) {
    // mover as parcelas selecionadas para outro período ("" = sem período)
    const pid = texto(b.periodoId, 40);
    if (pid && !(await env.DB.prepare("SELECT id FROM serasa_periodos WHERE id = ?").bind(pid).first())) throw new HttpError(400, "Período não encontrado.");
    sets.push("periodo_id = ?"); vals.push(pid);
  }
  if (!sets.length) throw new HttpError(400, "Nada para alterar.");
  if (b.serasa === "ok" || b.mentor === "ok") {
    // registra quando e quem incluiu, sem sobrescrever uma data já informada
    sets.push("data_inclusao = CASE WHEN data_inclusao = '' THEN ? ELSE data_inclusao END", "resp_inclusao = CASE WHEN resp_inclusao = '' THEN ? ELSE resp_inclusao END");
    vals.push(hojeISO(), eu.nome);
  }
  sets.push("atualizado_em = ?", "atualizado_por = ?");
  vals.push(agoraISO(), eu.nome);
  const stmts = emLotes(ids, 50).map((lote) =>
    env.DB.prepare(`UPDATE serasa SET ${sets.join(", ")} WHERE id IN (${lote.map(() => "?").join(",")})`).bind(...vals, ...lote));
  await executarEmLotes(env, stmts);
  return json({ atualizados: ids.length });
}

// ---------------------------------------------------------------- Serasa: períodos

function periodoSaida(r) { return { id: r.id, nome: r.nome, inicio: r.inicio, fim: r.fim, criadoPor: r.criado_por }; }

async function listarPeriodos(env) {
  const r = await env.DB.prepare("SELECT * FROM serasa_periodos ORDER BY inicio, fim").all();
  return json({ periodos: r.results.map(periodoSaida) });
}

async function salvarPeriodo(req, env, eu, id) {
  const b = await corpo(req);
  const nome = texto(b.nome, 60), inicio = dataISO(b.inicio), fim = dataISO(b.fim);
  if (!inicio || !fim) throw new HttpError(400, "Informe a data de início e a data de fim do período.");
  if (fim < inicio) throw new HttpError(400, "A data de fim precisa ser igual ou posterior à de início.");
  if (!nome) throw new HttpError(400, "Dê um nome ao período.");
  if (id) {
    const r = await env.DB.prepare("UPDATE serasa_periodos SET nome = ?, inicio = ?, fim = ? WHERE id = ?").bind(nome, inicio, fim, id).run();
    if (r.meta && r.meta.changes === 0) throw new HttpError(404, "Período não encontrado.");
  } else {
    id = novoId();
    await env.DB.prepare("INSERT INTO serasa_periodos (id, nome, inicio, fim, criado_em, criado_por) VALUES (?,?,?,?,?,?)")
      .bind(id, nome, inicio, fim, agoraISO(), eu.nome).run();
  }
  return json({ periodo: periodoSaida(await env.DB.prepare("SELECT * FROM serasa_periodos WHERE id = ?").bind(id).first()) });
}

// ---------------------------------------------------------------- Base de dados (cadastro dos alunos)

// Só estes campos são guardados (os demais dados do relatório são sensíveis e não entram no sistema).
const BASE_CAMPOS = ["ra", "nome", "turma", "responsavel", "telefone", "email"];

function normNome(s) { return String(s || "").trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " "); }

// RA que veio com o começo do nome grudado (ex.: "4324 JULIA RAMOS", de um PDF com título
// centralizado): o número fica no RA e o texto volta para o começo do nome.
function consertarRa(o) {
  const m = texto(o.ra, 200).match(/^(\d{1,12})\s+(\D.*)$/);
  if (!m) return o;
  const nome = texto(o.nome, 150), resto = m[2].trim();
  return { ...o, ra: m[1], nome: nome.toUpperCase().startsWith(resto.toUpperCase()) ? nome : (resto + " " + nome).trim() };
}

function baseSaida(r) {
  return {
    id: r.id, ra: r.ra, nome: r.nome, turma: r.turma, responsavel: r.responsavel,
    telefone: r.telefone, email: r.email, atualizadoEm: r.atualizado_em, atualizadoPor: r.atualizado_por
  };
}

async function listarBase(env) {
  const r = await env.DB.prepare("SELECT * FROM base_alunos ORDER BY nome").all();
  const ult = await env.DB.prepare("SELECT valor FROM meta WHERE chave = 'base_ultima_importacao'").first();
  let ultima = null;
  try { ultima = ult ? JSON.parse(ult.valor) : null; } catch (e) { ultima = null; }
  return json({ alunos: r.results.map(baseSaida), ultimaImportacao: ultima });
}

// Índices da base: por RA e, para quem vem sem RA, por nome (só quando o nome é único na base).
async function carregarBase(env) {
  const r = (await env.DB.prepare("SELECT * FROM base_alunos").all()).results;
  const porRa = {}, porNome = {}, repetido = {};
  r.forEach((b) => {
    if (b.ra) porRa[b.ra.trim().toLowerCase()] = b;
    const n = normNome(b.nome);
    if (!n) return;
    if (porNome[n] && porNome[n].ra !== b.ra) repetido[n] = true;
    porNome[n] = b;
  });
  Object.keys(repetido).forEach((n) => { delete porNome[n]; });
  return { porRa, porNome, vazia: !r.length };
}

function acharNaBase(base, o) {
  if (!base || base.vazia) return null;
  const ra = texto(o.ra, 30).toLowerCase();
  if (ra) return base.porRa[ra] || null;
  return base.porNome[normNome(o.nome)] || null;
}

// Aluno do Painel/Contraturno: os dados cadastrais da base valem mais que os do relatório
// (o relatório pode vir com nome cortado ou sem contato). O financeiro continua do relatório.
function completarComBase(r, bx) {
  const o = { ...r };
  o.ra = texto(r.ra, 30) || bx.ra;
  if (bx.nome) o.nome = bx.nome;
  ["turma", "responsavel", "telefone", "email"].forEach((c) => { if (bx[c]) o[c] = bx[c]; });
  return o;
}

// Parcela da Serasa: com RA, o nome completo vem da base (o RA é que identifica a parcela,
// então trocar o nome não duplica; corrige nomes que vieram cortados de um PDF). Sem RA, o nome
// faz parte da identificação e não muda. O responsável só é preenchido se estiver vazio.
function completarSerasaComBase(l, base) {
  const bx = acharNaBase(base, l);
  if (!bx) return l;
  const o = { ...l };
  if (texto(o.ra) && bx.nome) o.nome = bx.nome;
  if (!texto(o.responsavel) && texto(o.nome)) o.responsavel = bx.responsavel;
  return o;
}

async function importarBase(req, env, eu) {
  const b = await corpo(req);
  const linhas = Array.isArray(b.linhas) ? b.linhas.slice(0, 20000) : [];
  if (!linhas.length) throw new HttpError(400, "Nenhuma linha para importar.");
  const atuais = (await env.DB.prepare("SELECT * FROM base_alunos").all()).results;
  const porRa = {}, porNome = {};
  atuais.forEach((a) => { if (a.ra) porRa[a.ra.trim().toLowerCase()] = a; else porNome[normNome(a.nome)] = a; });
  const agora = agoraISO(), stmts = [], vistos = new Set();
  let criados = 0, atualizados = 0, iguais = 0, incompletas = 0;
  const cols = ["id", ...BASE_CAMPOS, "atualizado_em", "atualizado_por"];
  for (const l0 of linhas) {
    const l = consertarRa(l0);
    const o = {
      ra: texto(l.ra, 30), nome: texto(l.nome, 150), turma: texto(l.turma, 80), responsavel: texto(l.responsavel, 150),
      telefone: texto(l.telefone, 80), email: texto(l.email, 150)
    };
    if (!o.nome) { incompletas++; continue; }
    const chave = o.ra ? "ra:" + o.ra.toLowerCase() : "nm:" + normNome(o.nome);
    if (vistos.has(chave)) continue; // mesma pessoa repetida no arquivo: vale a 1ª linha
    vistos.add(chave);
    const achado = o.ra ? (porRa[o.ra.toLowerCase()] || porNome[normNome(o.nome)]) : porNome[normNome(o.nome)];
    if (achado) {
      // campo vazio no arquivo não apaga o que já estava na base
      const junto = {};
      BASE_CAMPOS.forEach((c) => { junto[c] = o[c] || achado[c] || ""; });
      if (BASE_CAMPOS.every((c) => junto[c] === achado[c])) { iguais++; continue; }
      stmts.push(env.DB.prepare(`UPDATE base_alunos SET ${BASE_CAMPOS.map((c) => c + " = ?").join(", ")}, atualizado_em = ?, atualizado_por = ? WHERE id = ?`).bind(...BASE_CAMPOS.map((c) => junto[c]), agora, eu.nome, achado.id));
      atualizados++;
    } else {
      stmts.push(env.DB.prepare(insertSQL("base_alunos", cols)).bind(novoId(), ...BASE_CAMPOS.map((c) => o[c]), agora, eu.nome));
      criados++;
    }
  }
  await executarEmLotes(env, stmts);
  // o arquivo pode vir em partes; a sincronização com as outras abas roda na última
  if (b.ultimaParte === false) return json({ criados, atualizados, iguais, incompletas, sincronizados: null });
  const sinc = await sincronizarComBase(env);
  await env.DB.prepare("INSERT OR REPLACE INTO meta (chave, valor) VALUES ('base_ultima_importacao', ?)")
    .bind(JSON.stringify({ em: agora, por: eu.nome, linhas: linhas.length })).run();
  return json({ criados, atualizados, iguais, incompletas, sincronizados: sinc });
}

// Depois de importar a base, atualiza os cadastros que já estão nas outras abas.
async function sincronizarComBase(env) {
  const base = await carregarBase(env);
  if (base.vazia) return { alunos: 0, serasa: 0 };
  const agora = agoraISO(), stmts = [];
  let nAlunos = 0, nSerasa = 0;
  const alunos = (await env.DB.prepare("SELECT * FROM alunos").all()).results;
  for (const a of alunos) {
    const bx = acharNaBase(base, a); if (!bx) continue;
    const novo = completarComBase(a, bx);
    const campos = ["ra", "nome", "turma", "responsavel", "telefone", "email"].filter((c) => texto(novo[c]) && novo[c] !== a[c]);
    if (!campos.length) continue;
    stmts.push(env.DB.prepare(`UPDATE alunos SET ${campos.map((c) => c + " = ?").join(", ")}, atualizado_em = ? WHERE id = ?`).bind(...campos.map((c) => novo[c]), agora, a.id));
    nAlunos++;
  }
  const parcelas = (await env.DB.prepare("SELECT id, ra, nome, responsavel FROM serasa").all()).results;
  for (const p of parcelas) {
    const novo = completarSerasaComBase(p, base);
    const campos = ["nome", "responsavel"].filter((c) => texto(novo[c]) && novo[c] !== p[c]);
    if (!campos.length) continue;
    stmts.push(env.DB.prepare(`UPDATE serasa SET ${campos.map((c) => c + " = ?").join(", ")} WHERE id = ?`).bind(...campos.map((c) => novo[c]), p.id));
    nSerasa++;
  }
  await executarEmLotes(env, stmts);
  return { alunos: nAlunos, serasa: nSerasa };
}

async function consertarRasSalvos(env) {
  const stmts = [];
  for (const tabela of ["serasa", "alunos", "base_alunos"]) {
    const r = (await env.DB.prepare(`SELECT id, ra, nome FROM ${tabela} WHERE ra LIKE '% %'`).all()).results;
    for (const x of r) {
      const o = consertarRa(x);
      if (o.ra !== x.ra) stmts.push(env.DB.prepare(`UPDATE ${tabela} SET ra = ?, nome = ? WHERE id = ?`).bind(o.ra, o.nome, x.id));
    }
  }
  await executarEmLotes(env, stmts);
  if (stmts.length) await sincronizarComBase(env);
}

// Parcelas duplicadas no mesmo período (mesmo aluno, vencimento, valor e tipo), criadas por uma
// importação que não reconheceu as parcelas já salvas (ex.: RA grudado no nome, já consertado).
// Linhas iguais dentro de UMA importação são parcelas de verdade (a planilha pode ter repetidas):
// por isso cada grupo mantém a maior quantidade vinda de uma mesma importação (mesmo minuto) e
// só o que passar disso é duplicado. Fica a parcela mais antiga; o que a equipe marcou na cópia
// (Mentor, Serasa, inclusão, observação) passa para a que fica, se lá estiver vazio.
async function duplicadasSerasa(env, eu, remover) {
  const todas = (await env.DB.prepare("SELECT * FROM serasa ORDER BY criado_em, id").all()).results;
  const periodos = {};
  (await env.DB.prepare("SELECT id, nome FROM serasa_periodos").all()).results.forEach((p) => { periodos[p.id] = p.nome; });
  const grupos = {};
  todas.forEach((r) => { const k = r.periodo_id + "#" + chaveSerasa(serasaSaida(r)); (grupos[k] = grupos[k] || []).push(r); });
  const apagar = [], ajustes = [], exemplos = [];
  let nGrupos = 0;
  Object.keys(grupos).forEach((k) => {
    const g = grupos[k];
    if (g.length < 2) return;
    const porLote = {};
    g.forEach((r) => { const lote = String(r.criado_em || "").slice(0, 16); porLote[lote] = (porLote[lote] || 0) + 1; });
    const manter = Math.max(...Object.values(porLote));
    if (g.length <= manter) return;
    nGrupos++;
    const ficam = g.slice(0, manter), saem = g.slice(manter);
    saem.forEach((s, i) => {
      const f = ficam[i % ficam.length], mud = {};
      ["mentor", "serasa", "data_inclusao", "resp_inclusao", "observacao", "responsavel", "cpf"].forEach((c) => { if (!f[c] && s[c]) { mud[c] = s[c]; f[c] = s[c]; } });
      if (texto(s.nome).length > texto(f.nome).length) { mud.nome = s.nome; f.nome = s.nome; }
      if (Object.keys(mud).length) ajustes.push([f.id, mud]);
      apagar.push(s.id);
    });
    if (exemplos.length < 200) exemplos.push({ nome: ficam[0].nome || ficam[0].responsavel, ra: ficam[0].ra, vencimento: ficam[0].vencimento, valor: ficam[0].valor, periodo: periodos[ficam[0].periodo_id] || "Sem período", vezes: g.length, ficam: manter });
  });
  if (remover && apagar.length) {
    const stmts = [];
    const agora = agoraISO();
    // junta as marcações do mesmo registro (pode receber de mais de uma cópia)
    const porId = {};
    ajustes.forEach(([id, mud]) => { porId[id] = { ...(porId[id] || {}), ...mud }; });
    Object.keys(porId).forEach((id) => {
      const cs = Object.keys(porId[id]);
      stmts.push(env.DB.prepare(`UPDATE serasa SET ${cs.map((c) => c + " = ?").join(", ")}, atualizado_em = ?, atualizado_por = ? WHERE id = ?`).bind(...cs.map((c) => porId[id][c]), agora, eu.nome, id));
    });
    emLotes(apagar, 50).forEach((lote) => stmts.push(env.DB.prepare(`DELETE FROM serasa WHERE id IN (${lote.map(() => "?").join(",")})`).bind(...lote)));
    await executarEmLotes(env, stmts);
  }
  return json({ duplicadas: apagar.length, grupos: nGrupos, exemplos, removidas: remover ? apagar.length : 0 });
}

// ---------------------------------------------------------------- Painel jurídico
// Carteira jurídica (GM Carvalho e Fraia): alunos entram pela carteira anual (importar carteira
// ou novo caso); valores, parcelas e movimentação vêm dos relatórios mensais de inadimplência.

const JUR_STATUS = ["em_aberto", "em_negociacao", "verificar", "quitado"];
const JUR_ST_ROTULO = { em_aberto: "Em aberto", em_negociacao: "Em negociação GM", verificar: "Verificar", quitado: "Quitado" };
// todas as colunas da tabela (gravação com INSERT OR REPLACE); as que a aba não usa mais ficam vazias
const JUR_COLS = ["id", "ra", "carteira", "ano", "aluno", "responsavel", "cpf", "email", "celular", "valor_negociado", "valor_aberto", "status", "enviado_juridico", "data_envio_juridico", "motivo_pendencia", "flag_conflito", "arquivado", "arquivado_em", "criado_em", "atualizado_em", "atualizado_por", "parcelas", "extrato", "conta_financeira", "link_drive", "competencia", "conferir_motivo", "parcelas_negociado", "parcelas_venc", "acordo_tipo", "acordo_valor", "acordo_pago", "acordo_saldo_aberto", "acordo_saldo_vencer", "acordo_parc_vencer"];

function jurStatusValido(v) { return JUR_STATUS.includes(v) ? v : "em_aberto"; }
function valorOuNull(v) { return v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : numero(v); }
// Nome igual, ou um é o começo do outro (nome cortado no relatório).
function nomesCompativeis(a, b) { const x = normNome(a), y = normNome(b); return !x || !y || x === y || x.startsWith(y) || y.startsWith(x); }

function casoSaida(r, obs) {
  return {
    id: r.id, ra: r.ra, carteira: r.carteira, ano: r.ano, aluno: r.aluno, responsavel: r.responsavel, email: r.email, celular: r.celular,
    valorNegociado: r.valor_negociado, valorAberto: r.valor_aberto, status: jurStatusValido(r.status),
    flagConflito: !!r.flag_conflito, conferirMotivo: r.conferir_motivo || "", criadoEm: r.criado_em, atualizadoEm: r.atualizado_em, atualizadoPor: r.atualizado_por,
    parcelas: r.parcelas || 0, parcelasNegociado: r.parcelas_negociado || 0, parcelasVenc: lerParcelasVenc(r.parcelas_venc),
    contaFinanceira: r.conta_financeira || "", competencia: r.competencia || "",
    cpf: r.cpf || "", linkDrive: r.link_drive || "", extrato: r.extrato, motivo: r.motivo_pendencia || "", dataEnvio: r.data_envio_juridico || "",
    acordo: { tipo: r.acordo_tipo || "", valor: r.acordo_valor, pago: r.acordo_pago, saldoAberto: r.acordo_saldo_aberto, saldoVencer: r.acordo_saldo_vencer, parcVencer: r.acordo_parc_vencer || 0 },
    obs: obs || []
  };
}

// Junta o que veio da tela com o registro salvo: só muda o campo enviado. Valores e parcelas só
// mudam pelo relatório de inadimplência.
function casoValores(o, atual, eu) {
  const a = atual || {};
  const agora = agoraISO();
  const tem = (k) => Object.prototype.hasOwnProperty.call(o, k);
  const v = {
    id: a.id || novoId(),
    ra: tem("ra") ? texto(o.ra, 30) : a.ra || "",
    carteira: tem("carteira") ? texto(o.carteira, 60) : a.carteira || "",
    ano: tem("ano") ? texto(o.ano, 10) : a.ano || "",
    aluno: tem("aluno") ? texto(o.aluno, 150) : a.aluno || "",
    responsavel: tem("responsavel") ? texto(o.responsavel, 150) : a.responsavel || "",
    cpf: tem("cpf") ? texto(o.cpf, 20) : a.cpf || "", email: tem("email") ? texto(o.email, 150) : a.email || "", celular: tem("celular") ? texto(o.celular, 40) : a.celular || "",
    valor_negociado: a.valor_negociado ?? null, valor_aberto: a.valor_aberto ?? null,
    status: tem("status") ? jurStatusValido(o.status) : jurStatusValido(a.status),
    enviado_juridico: 1, data_envio_juridico: tem("dataEnvio") ? dataISO(o.dataEnvio) : a.data_envio_juridico || "",
    motivo_pendencia: tem("motivo") ? texto(o.motivo, 200) : a.motivo_pendencia || "",
    flag_conflito: tem("flagConflito") ? (o.flagConflito ? 1 : 0) : (a.flag_conflito || 0),
    arquivado: 0, arquivado_em: "", criado_em: a.criado_em || agora, atualizado_em: agora, atualizado_por: eu ? eu.nome : "",
    parcelas: a.parcelas || 0, extrato: tem("extrato") ? valorOuNull(o.extrato) : (a.extrato ?? null), conta_financeira: a.conta_financeira || "",
    link_drive: tem("linkDrive") ? (/^https?:\/\//i.test(texto(o.linkDrive, 500)) ? texto(o.linkDrive, 500) : "") : a.link_drive || "",
    competencia: a.competencia || "",
    // "conferido" (aviso desligado) apaga o motivo da conferência
    conferir_motivo: tem("flagConflito") && !o.flagConflito ? "" : a.conferir_motivo || "",
    parcelas_negociado: a.parcelas_negociado || 0, parcelas_venc: a.parcelas_venc || "[]",
    // acordo GM: só a planilha da carteira muda (objeto "acordo")
    acordo_tipo: tem("acordo") ? texto(o.acordo && o.acordo.tipo, 80) : a.acordo_tipo || "",
    acordo_valor: tem("acordo") ? valorOuNull(o.acordo && o.acordo.valor) : (a.acordo_valor ?? null),
    acordo_pago: tem("acordo") ? valorOuNull(o.acordo && o.acordo.pago) : (a.acordo_pago ?? null),
    acordo_saldo_aberto: tem("acordo") ? valorOuNull(o.acordo && o.acordo.saldoAberto) : (a.acordo_saldo_aberto ?? null),
    acordo_saldo_vencer: tem("acordo") ? valorOuNull(o.acordo && o.acordo.saldoVencer) : (a.acordo_saldo_vencer ?? null),
    acordo_parc_vencer: tem("acordo") ? Math.max(0, parseInt(o.acordo && o.acordo.parcVencer, 10) || 0) : (a.acordo_parc_vencer || 0)
  };
  return JUR_COLS.map((c) => v[c]);
}

async function buscarCasoJur(env, id) {
  const r = await env.DB.prepare("SELECT * FROM jur_casos WHERE id = ?").bind(id).first();
  if (!r) throw new HttpError(404, "Caso não encontrado.");
  return r;
}
async function obsDoCaso(env, id) {
  return (await env.DB.prepare("SELECT id, data, texto, autor, editado_em, editado_por FROM jur_obs WHERE caso_id = ? ORDER BY data DESC").bind(id).all()).results;
}
async function casoCompleto(env, id) {
  return json({ caso: casoSaida(await buscarCasoJur(env, id), await obsDoCaso(env, id)) });
}

async function listarJuridico(env) {
  const casos = (await env.DB.prepare("SELECT * FROM jur_casos WHERE arquivado = 0 ORDER BY aluno").all()).results;
  const porCaso = {};
  (await env.DB.prepare("SELECT caso_id, id, data, texto, autor, editado_em, editado_por FROM jur_obs ORDER BY data DESC").all()).results
    .forEach((o) => { (porCaso[o.caso_id] = porCaso[o.caso_id] || []).push({ id: o.id, data: o.data, texto: o.texto, autor: o.autor, editado_em: o.editado_em, editado_por: o.editado_por }); });
  // indicadores das duas últimas competências e o movimento de cada caso na última
  const comps = (await env.DB.prepare("SELECT mes, resumo FROM jur_competencias ORDER BY mes DESC LIMIT 2").all()).results.map(compSaida);
  const movimentos = {};
  if (comps.length) (await env.DB.prepare("SELECT caso_id, movimento FROM jur_hist WHERE mes = ?").bind(comps[0].mes).all()).results.forEach((h) => { movimentos[h.caso_id] = h.movimento; });
  // parcelas do acordo GM ainda com saldo (vencimento e saldo), para as colunas vencidas × a vencer
  const acordoParc = {};
  (await env.DB.prepare("SELECT caso_id, vencimento, saldo FROM jur_acordo_parcelas WHERE saldo > 0.009").all()).results
    .forEach((p) => { if (p.vencimento) (acordoParc[p.caso_id] = acordoParc[p.caso_id] || []).push([p.vencimento, p.saldo]); });
  return json({ casos: casos.map((c) => ({ ...casoSaida(c, porCaso[c.id]), acordoParc: acordoParc[c.id] || [] })), competencias: comps, movimentos, carteiras: await carteirasJur(env, casos) });
}

// Carteiras cadastradas. Carteira que só existe nos casos (importada antes do cadastro) entra
// sozinha, com o ano letivo mais comum dos casos dela.
async function carteirasJur(env, casos) {
  let lista = (await env.DB.prepare("SELECT * FROM jur_carteiras").all()).results;
  const tem = new Set(lista.map((c) => normNome(c.nome))), faltam = {};
  casos.forEach((c) => {
    const n = texto(c.carteira, 60); if (!n || tem.has(normNome(n))) return;
    const f = faltam[normNome(n)] || (faltam[normNome(n)] = { nome: n, anos: {} });
    if (c.ano) f.anos[c.ano] = (f.anos[c.ano] || 0) + 1;
  });
  const novas = Object.values(faltam);
  if (novas.length) {
    const agora = agoraISO();
    await env.DB.batch(novas.map((f) => env.DB.prepare("INSERT OR IGNORE INTO jur_carteiras (id, nome, ano, criado_em, criado_por) VALUES (?,?,?,?, 'casos')")
      .bind(novoId(), f.nome, Object.keys(f.anos).sort((a, b) => f.anos[b] - f.anos[a])[0] || "", agora)));
    lista = (await env.DB.prepare("SELECT * FROM jur_carteiras").all()).results;
  }
  return lista.map((c) => ({ id: c.id, nome: c.nome, ano: c.ano })).sort((a, b) => b.nome.localeCompare(a.nome, "pt-BR", { numeric: true }));
}
// Criar ou editar carteira. Trocar o nome ou o ano letivo muda também os casos dela.
async function salvarCarteiraJur(req, env, eu, id) {
  const b = await corpo(req);
  const nome = texto(b.nome, 60), ano = texto(b.ano, 10);
  if (!nome) throw new HttpError(400, "Informe o nome da carteira (ex.: Carteira 2027).");
  if (ano && !/^\d{4}$/.test(ano)) throw new HttpError(400, "O ano letivo deve ter 4 números (ex.: 2026).");
  const outra = (await env.DB.prepare("SELECT id, nome FROM jur_carteiras").all()).results.find((c) => normNome(c.nome) === normNome(nome) && c.id !== id);
  if (outra) throw new HttpError(400, "Já existe uma carteira com esse nome.");
  const agora = agoraISO();
  if (!id) {
    const novo = novoId();
    await env.DB.prepare("INSERT INTO jur_carteiras (id, nome, ano, criado_em, criado_por) VALUES (?,?,?,?,?)").bind(novo, nome, ano, agora, eu.nome).run();
    return json({ carteira: { id: novo, nome, ano } });
  }
  const atual = await env.DB.prepare("SELECT * FROM jur_carteiras WHERE id = ?").bind(id).first();
  if (!atual) throw new HttpError(404, "Carteira não encontrada.");
  await env.DB.batch([
    env.DB.prepare("UPDATE jur_carteiras SET nome = ?, ano = ? WHERE id = ?").bind(nome, ano, id),
    env.DB.prepare("UPDATE jur_casos SET carteira = ?, ano = CASE WHEN ? <> '' THEN ? ELSE ano END WHERE carteira = ?").bind(nome, ano, ano, atual.nome)
  ]);
  return json({ carteira: { id, nome, ano } });
}
// Só carteira vazia pode ser excluída (os casos nunca são apagados junto).
async function excluirCarteiraJur(env, id) {
  const c = await env.DB.prepare("SELECT * FROM jur_carteiras WHERE id = ?").bind(id).first();
  if (!c) throw new HttpError(404, "Carteira não encontrada.");
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM jur_casos WHERE carteira = ?").bind(c.nome).first();
  if (n && n.n) throw new HttpError(400, `A carteira tem ${n.n} caso(s). Exclua ou mude a carteira dos casos antes.`);
  await env.DB.prepare("DELETE FROM jur_carteiras WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

// Responsável e contato vêm sempre da Base de dados (pelo RA ou pelo nome); o nome também, se faltar.
function completarJurComBase(o, base) {
  const bx = acharNaBase(base, { ra: o.ra, nome: o.aluno });
  if (!bx) return o;
  const r = { ...o };
  if (!texto(r.ra)) r.ra = bx.ra;
  if (!texto(r.aluno)) r.aluno = bx.nome;
  r.responsavel = bx.responsavel || r.responsavel || "";
  r.email = bx.email || r.email || "";
  r.celular = bx.telefone || r.celular || "";
  return r;
}

function insertObsJur(env, casoId, data, t, eu) {
  return env.DB.prepare("INSERT INTO jur_obs (id, caso_id, data, texto, autor) VALUES (?,?,?,?,?)").bind(novoId(), casoId, data, t, eu ? eu.nome : "");
}

async function criarCasoJur(req, env, eu) {
  const b0 = await corpo(req);
  const b = completarJurComBase({ ra: b0.ra, aluno: b0.aluno, carteira: b0.carteira, ano: b0.ano }, await carregarBase(env));
  if (!texto(b.aluno)) throw new HttpError(400, "Informe o nome do aluno.");
  const ra = texto(b.ra, 30), cart = normNome(b.carteira);
  if (ra && (await env.DB.prepare("SELECT carteira FROM jur_casos WHERE ra = ? AND arquivado = 0").bind(ra).all()).results.some((c) => normNome(c.carteira) === cart))
    throw new HttpError(400, "Esse aluno já está nessa carteira.");
  const vals = casoValores({ status: "em_aberto", ...b }, null, eu);
  await env.DB.prepare(insertSQL("jur_casos", JUR_COLS)).bind(...vals).run();
  return casoCompleto(env, vals[0]);
}

async function alterarCasoJur(req, env, eu, id) {
  const atual = await buscarCasoJur(env, id);
  const b0 = await corpo(req), b = {};
  ["aluno", "ra", "carteira", "ano", "status", "flagConflito", "cpf", "linkDrive", "extrato", "motivo", "dataEnvio"].forEach((k) => { if (Object.prototype.hasOwnProperty.call(b0, k)) b[k] = b0[k]; });
  if (Object.prototype.hasOwnProperty.call(b, "aluno") && !texto(b.aluno)) throw new HttpError(400, "Informe o nome do aluno.");
  const vals = casoValores(b, atual, eu);
  const stmts = [env.DB.prepare(insertSQL("jur_casos", JUR_COLS)).bind(...vals)];
  const st = vals[JUR_COLS.indexOf("status")], stAntes = jurStatusValido(atual.status);
  if (st !== stAntes) stmts.push(insertObsJur(env, id, agoraISO(), `Status ${JUR_ST_ROTULO[stAntes]} → ${JUR_ST_ROTULO[st]}.`, eu));
  await env.DB.batch(stmts);
  return casoCompleto(env, id);
}

// Excluir de vez (administrador): o caso, as tratativas e o histórico mensal dele.
async function excluirCasoJur(env, id) {
  await buscarCasoJur(env, id);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM jur_obs WHERE caso_id = ?").bind(id),
    env.DB.prepare("DELETE FROM jur_hist WHERE caso_id = ?").bind(id),
    env.DB.prepare("DELETE FROM jur_acordo_parcelas WHERE caso_id = ?").bind(id),
    env.DB.prepare("DELETE FROM jur_casos WHERE id = ?").bind(id)
  ]);
  return json({ ok: true });
}

async function novaObsJur(req, env, eu, id) {
  await buscarCasoJur(env, id);
  const t = texto((await corpo(req)).texto, 4000);
  if (!t) throw new HttpError(400, "Escreva a tratativa antes de adicionar.");
  const agora = agoraISO();
  await env.DB.batch([
    insertObsJur(env, id, agora, t, eu),
    env.DB.prepare("UPDATE jur_casos SET atualizado_em = ?, atualizado_por = ? WHERE id = ?").bind(agora, eu.nome, id)
  ]);
  return casoCompleto(env, id);
}

// Corrigir ou excluir uma tratativa: quem registrou ou um administrador.
async function obsDoCasoJur(env, eu, casoId, obsId) {
  const o = await env.DB.prepare("SELECT * FROM jur_obs WHERE id = ? AND caso_id = ?").bind(obsId, casoId).first();
  if (!o) throw new HttpError(404, "Tratativa não encontrada.");
  if (eu.perfil !== "admin" && o.autor !== eu.nome) throw new HttpError(403, "Só quem registrou a tratativa (ou um administrador) pode alterá-la.");
  return o;
}
async function editarObsJur(req, env, eu, casoId, obsId) {
  await obsDoCasoJur(env, eu, casoId, obsId);
  const t = texto((await corpo(req)).texto, 4000);
  if (!t) throw new HttpError(400, "A tratativa não pode ficar em branco. Para apagar, use Excluir.");
  await env.DB.prepare("UPDATE jur_obs SET texto = ?, editado_em = ?, editado_por = ? WHERE id = ?").bind(t, agoraISO(), eu.nome, obsId).run();
  return casoCompleto(env, casoId);
}
async function excluirObsJur(env, eu, casoId, obsId) {
  await obsDoCasoJur(env, eu, casoId, obsId);
  await env.DB.prepare("DELETE FROM jur_obs WHERE id = ?").bind(obsId).run();
  return casoCompleto(env, casoId);
}

// Carteira (RA, Aluno, Carteira, Ano letivo): aluno com o mesmo RA (e nome compatível) na mesma
// carteira é atualizado; os outros entram na carteira. Contato vem da Base de dados.
async function importarJuridico(req, env, eu) {
  const b = await corpo(req);
  const linhas = Array.isArray(b.linhas) ? b.linhas.slice(0, 3000) : [];
  const todos = (await env.DB.prepare("SELECT * FROM jur_casos WHERE arquivado = 0").all()).results;
  const porRa = {}, porNome = {};
  function indexar(c) {
    if (c.ra) (porRa[c.ra.toLowerCase()] = porRa[c.ra.toLowerCase()] || []).push(c);
    const n = normNome(c.aluno); if (n) (porNome[n] = porNome[n] || []).push(c);
  }
  todos.forEach(indexar);
  const base = await carregarBase(env);
  const stmts = [];
  let criados = 0, atualizados = 0, ignorados = 0;
  // tratativas que já existem (o mesmo texto não entra duas vezes no mesmo caso)
  const obsExist = new Set((await env.DB.prepare("SELECT caso_id, texto FROM jur_obs").all()).results.map((o) => o.caso_id + "|" + o.texto));
  const agora = agoraISO();
  let tratativas = 0, parcelasAcordo = 0;
  linhas.forEach((l0) => {
    l0 = l0 || {};
    const l = { ra: texto(l0.ra, 30), aluno: texto(l0.aluno, 150), carteira: texto(l0.carteira, 60), ano: texto(l0.ano, 10) };
    if (!l.ra && !l.aluno) { ignorados++; return; }
    // demais campos da planilha da carteira (só os que vieram preenchidos)
    if (l0.status && JUR_STATUS.includes(l0.status)) l.status = l0.status;
    ["cpf", "linkDrive", "motivo", "dataEnvio", "responsavel", "email", "celular"].forEach((k) => { if (texto(l0[k], 500)) l[k] = l0[k]; });
    if (valorOuNull(l0.extrato) != null) l.extrato = l0.extrato;
    if (b.comAcordos && l0.acordo && typeof l0.acordo === "object") l.acordo = l0.acordo;
    const cart = normNome(l.carteira);
    const mesma = (c) => !cart || !normNome(c.carteira) || normNome(c.carteira) === cart;
    const atual = (l.ra && (porRa[l.ra.toLowerCase()] || []).find((c) => nomesCompativeis(c.aluno, l.aluno) && mesma(c))) ||
      (l.aluno && (porNome[normNome(l.aluno)] || []).find((c) => (!l.ra || !c.ra) && mesma(c))) || null;
    const o = completarJurComBase(l, base);
    Object.keys(o).forEach((k) => { if (o[k] === "") delete o[k]; }); // célula vazia não apaga o que já está salvo
    if (l.acordo) o.acordo = l.acordo; // objeto (a limpeza de vazios acima não o afeta)
    const vals = casoValores(atual ? o : { status: "em_aberto", ...o, aluno: o.aluno || "Sem nome" }, atual, eu);
    stmts.push(env.DB.prepare(insertSQL("jur_casos", JUR_COLS)).bind(...vals));
    const id = vals[0];
    // observações da planilha viram tratativas (com a data de cada uma, quando houver)
    (Array.isArray(l0.obs) ? l0.obs : []).slice(0, 200).forEach((ob) => {
      const t = texto(ob && ob.texto, 4000); if (!t || obsExist.has(id + "|" + t)) return;
      obsExist.add(id + "|" + t); tratativas++;
      stmts.push(insertObsJur(env, id, dataISO(ob.data) ? ob.data + "T12:00:00.000Z" : agora, t, eu));
    });
    // parcelas do acordo GM: a planilha substitui as que já estavam gravadas neste caso
    if (b.comAcordos) {
      stmts.push(env.DB.prepare("DELETE FROM jur_acordo_parcelas WHERE caso_id = ?").bind(id));
      const ps = (Array.isArray(l0.parcelasAcordo) ? l0.parcelasAcordo : []).slice(0, 400);
      parcelasAcordo += ps.length;
      emLotes(ps, 9).forEach((lote) => {
        const v = [];
        lote.forEach((p) => v.push(novoId(), id, texto(p.acordo, 80), texto(p.parcela, 10), dataISO(p.vencimento), valorOuNull(p.valor), valorOuNull(p.pago), dataISO(p.dataPagamento), valorOuNull(p.saldo), texto(p.situacao, 40)));
        stmts.push(env.DB.prepare("INSERT INTO jur_acordo_parcelas (id, caso_id, acordo, parcela, vencimento, valor, pago, data_pagamento, saldo, situacao) VALUES " + lote.map(() => "(?,?,?,?,?,?,?,?,?,?)").join(",")).bind(...v));
      });
    }
    if (atual) atualizados++;
    else {
      criados++;
      const novo = {}; JUR_COLS.forEach((c, i) => { novo[c] = vals[i]; });
      indexar(novo); // o mesmo aluno repetido no arquivo não vira dois casos
    }
  });
  await executarEmLotes(env, stmts);
  return json({ criados, atualizados, ignorados, tratativas, parcelasAcordo });
}

// ---------------------------------------------------------------- Painel jurídico: comparação com relatórios

// Casos ativos por RA e por nome. Um aluno pode ter caso em mais de uma carteira: o relatório
// vale para o caso da carteira mais recente (os outros aparecem na prévia para conferência).
function indiceCasosJur(casos) {
  const porRa = {}, porNome = {};
  casos.forEach((c) => {
    if (c.ra) (porRa[c.ra.toLowerCase()] = porRa[c.ra.toLowerCase()] || []).push(c);
    const n = normNome(c.aluno); if (n) (porNome[n] = porNome[n] || []).push(c);
  });
  const ordem = (a, b) => normNome(b.carteira).localeCompare(normNome(a.carteira));
  Object.values(porRa).forEach((l) => l.sort(ordem));
  Object.values(porNome).forEach((l) => l.sort(ordem));
  return { porRa, porNome };
}
// Diferença de uma letra (GAYOTO × GAYOTTO, LUIZ × LUIS) conta como a mesma palavra.
function palavrasParecidas(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, dif = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++dif > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return dif + (a.length - i) + (b.length - j) <= 1;
}
// Mesmo aluno com grafia um pouco diferente e/ou nome cortado no relatório: primeiro nome igual e
// as palavras do nome mais curto batem, na ordem, com no máximo uma letra de diferença cada.
// A última palavra do nome cortado pode estar pela metade ("GAYOTTO DE" × "GAYOTO DE CASTRO").
function nomesParecidos(a, b) {
  if (nomesCompativeis(a, b)) return true;
  const x = normNome(a).split(" ").filter(Boolean), y = normNome(b).split(" ").filter(Boolean);
  if (!x.length || !y.length || x[0] !== y[0]) return false;
  const [cur, lon] = x.length <= y.length ? [x, y] : [y, x];
  if (cur.length < 2) return false;
  return cur.every((p, i) => palavrasParecidas(p, lon[i]) || (i === cur.length - 1 && p.length >= 3 && lon[i].startsWith(p)));
}
function acharCasosJur(idx, ra, nome) {
  ra = texto(ra, 30).toLowerCase();
  if (ra && idx.porRa[ra]) {
    const l = idx.porRa[ra].filter((c) => nomesCompativeis(c.aluno, nome)); if (l.length) return l;
    // RA igual e nome quase igual (erro de digitação em um dos dois lados)
    const p = idx.porRa[ra].filter((c) => nomesParecidos(c.aluno, nome)); if (p.length) return p;
  }
  const n = normNome(nome);
  if (n && idx.porNome[n]) return idx.porNome[n].filter((c) => !ra || !c.ra || c.ra.toLowerCase() === ra);
  // nome cortado no relatório (PDF): começo do nome, se só um aluno bater
  if (n && n.length >= 12) {
    const k = Object.keys(idx.porNome).filter((x) => x.startsWith(n) || n.startsWith(x));
    if (k.length === 1) return idx.porNome[k[0]];
    // sem RA na base: nome quase igual, se só um aluno bater (e o RA não contradiz)
    const q = Object.keys(idx.porNome).filter((x) => nomesParecidos(x, n)).map((x) => idx.porNome[x].filter((c) => !ra || !c.ra || c.ra.toLowerCase() === ra)).filter((l) => l.length);
    if (q.length === 1) return q[0];
  }
  return [];
}
// Contas financeiras do relatório de inadimplência. Grupo "aberto": débitos que ainda não foram
// negociados com a GM; grupo "negociado": renegociações da GM (extrajudicial ou judicial). Conta
// fora destas listas não entra em coluna nenhuma até alguém classificar na prévia da importação
// (a escolha fica salva para os próximos meses). O relatório pode trazer a conta pelo código do
// sistema ("14"), pelo nome ou pelos dois ("14 - Prestação de Serviço"): vale o código primeiro.
const GRUPOS_CONTA = ["aberto", "negociado", "ignorar"];
const CONTAS_PADRAO = [
  ["8", "Cheque devolvido", "aberto"], ["9", "Mensalidade 1", "aberto"], ["26", "Negociação de parcela a vencer", "aberto"],
  ["14", "Prestação de serviço", "aberto"], ["15", "Prestação de serviço extracurricular contraturno", "aberto"],
  ["11", "Renegociação 30 dias", "aberto"], ["4", "Renegociação acima 30 dias", "aberto"], ["5", "Taxas diversas", "aberto"],
  ["44", "Renegociação extrajudicial - GM Carvalho e Fraia", "negociado"], ["45", "Renegociação judicial - GM Carvalho e Fraia", "negociado"]
];
// "14", "14 - Prestação de Serviço", "Prestação de Serviço (14)" → { codigo: "14", nome: "Prestação de Serviço" }
function partesConta(s) {
  const t = String(s || "").trim();
  let m = /^(\d{1,4})(?:\s*[-–.:)]\s*|\s+|$)(.*)$/.exec(t);
  if (m) return { codigo: String(+m[1]), nome: m[2].trim() };
  m = /^(.*?)\s*\((\d{1,4})\)$/.exec(t);
  if (m) return { codigo: String(+m[2]), nome: m[1].trim() };
  return { codigo: "", nome: t };
}
function regraConta(conta, ...fontes) {
  const p = partesConta(conta), kc = p.codigo ? "cod:" + p.codigo : "", kn = chaveConta(p.nome);
  for (const f of fontes) if (kc && f[kc]) return f[kc];
  for (const f of fontes) if (kn && f[kn]) return f[kn];
  return null;
}
// nome que aparece no painel: descrição e código da conta, quando conhecidos
function rotuloConta(conta, ...fontes) {
  const p = partesConta(conta), r = regraConta(conta, ...fontes);
  const nome = (r && r.nome) || p.nome || "", cod = p.codigo || (r && r.codigo) || "";
  return nome ? (cod ? `${nome} (${cod})` : nome) : (cod ? `Conta ${cod}` : conta);
}
// "Negociação Parcelas a Vencer" = "Negociação de parcela a vencer"; "&" = "e"; plural = singular
function chaveConta(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/&/g, " e ")
    .replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((p) => p && !["de", "da", "do", "das", "dos", "e"].includes(p))
    .map((p) => p.length > 3 && p.endsWith("s") ? p.slice(0, -1) : p).join(" ");
}
async function regrasContas(env) {
  const regras = {};
  CONTAS_PADRAO.forEach(([codigo, nome, grupo]) => { regras["cod:" + codigo] = regras[chaveConta(nome)] = { grupo, nome, codigo, padrao: true }; });
  const m = await env.DB.prepare("SELECT valor FROM meta WHERE chave = 'jur_contas_regras'").first();
  let salvas = {};
  try { salvas = JSON.parse(m ? m.valor : "{}") || {}; } catch (e) { salvas = {}; }
  Object.keys(salvas).forEach((k) => { if (!regras[k] && salvas[k] && GRUPOS_CONTA.includes(salvas[k].grupo)) regras[k] = salvas[k]; });
  return { regras, salvas };
}
function reais(v) { return "R$ " + numero(v).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, "."); }
function mesBR(m) { return m ? m.slice(5, 7) + "/" + m.slice(0, 4) : ""; }
function r2(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function compSaida(r) {
  let resumo = {};
  try { resumo = JSON.parse(r.resumo || "{}"); } catch (e) { resumo = {}; }
  return { mes: r.mes, dataRelatorio: r.data_relatorio || "", importadoEm: r.importado_em || "", importadoPor: r.importado_por || "", arquivos: r.arquivos || "", ...resumo };
}
async function competenciasJuridico(env) {
  const r = (await env.DB.prepare("SELECT * FROM jur_competencias ORDER BY mes").all()).results;
  const { regras } = await regrasContas(env);
  return json({ competencias: r.map(compSaida), regras: Object.values(regras) });
}
// Casos escolhidos na tela que não têm valor nenhum (em aberto e negociado zerados ou vazios):
// ficam Quitado, com o aviso de conferência apagado e o registro nas tratativas. O servidor
// confere de novo: caso com valor não é alterado.
async function quitarSemValorJur(req, env, eu) {
  const b = await corpo(req);
  const ids = new Set((Array.isArray(b.ids) ? b.ids : []).slice(0, 2000).map((x) => texto(x, 40)));
  const casos = (await env.DB.prepare("SELECT * FROM jur_casos WHERE arquivado = 0 AND status <> 'quitado'").all()).results
    .filter((c) => ids.has(c.id) && !(Number(c.valor_aberto) > 0) && !(Number(c.valor_negociado) > 0));
  const agora = agoraISO(), stmts = [];
  casos.forEach((c) => {
    stmts.push(env.DB.prepare("UPDATE jur_casos SET status = 'quitado', valor_aberto = 0, parcelas = 0, flag_conflito = 0, conferir_motivo = '', atualizado_em = ?, atualizado_por = ? WHERE id = ?").bind(agora, eu.nome, c.id));
    stmts.push(insertObsJur(env, c.id, agora, `Status ${JUR_ST_ROTULO[c.status] || c.status} → Quitado (sem valor em aberto nem negociado; conferido no sistema).`, eu));
  });
  await executarEmLotes(env, stmts);
  return json({ quitados: casos.length });
}
async function historicoCasoJur(env, id) {
  await buscarCasoJur(env, id);
  const r = (await env.DB.prepare("SELECT * FROM jur_hist WHERE caso_id = ? ORDER BY mes").bind(id).all()).results;
  const ap = (await env.DB.prepare("SELECT * FROM jur_acordo_parcelas WHERE caso_id = ? ORDER BY acordo, vencimento").bind(id).all()).results;
  return json({ acordoParcelas: ap.map((p) => ({ acordo: p.acordo, parcela: p.parcela, vencimento: p.vencimento, valor: p.valor, pago: p.pago, dataPagamento: p.data_pagamento, saldo: p.saldo, situacao: p.situacao })), historico: r.map((h) => {
    let contas = {};
    try { contas = JSON.parse(h.contas || "{}"); } catch (e) { contas = {}; }
    return { mes: h.mes, valorAberto: h.valor_aberto, valorNegociado: h.valor_negociado, parcelasAberto: h.parcelas_aberto, parcelasNegociado: h.parcelas_negociado, contas, ausente: !!h.ausente, movimento: h.movimento, conferir: h.conferir };
  }) });
}

// Relatórios de inadimplência de uma competência (mês de referência). Só os alunos que já estão
// no Painel jurídico entram. Cada parcela vai para "valor em aberto" ou "valor negociado" conforme
// a conta financeira. Grava o mês no histórico (sem apagar os outros meses), compara com o mês
// anterior e registra a movimentação de cada caso. Quem não está no relatório NÃO é quitado:
// mantém os valores e fica sinalizado para conferência. Com "simular", só devolve o resumo.
async function inadimplenciaJuridico(req, env, eu) {
  const b = await corpo(req);
  const linhas = Array.isArray(b.linhas) ? b.linhas.slice(0, 20000) : [];
  if (!linhas.length) throw new HttpError(400, "Nenhum aluno encontrado no relatório.");
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(b.competencia || "") ? b.competencia : "";
  if (!mes) throw new HttpError(400, "Informe o mês de referência (competência) dos relatórios.");
  const { regras, salvas } = await regrasContas(env);
  // classificação escolhida agora, na prévia, para as contas que não estão nas regras
  const novas = {};
  Object.keys(b.regras || {}).forEach((nome) => {
    const g = b.regras[nome], p = partesConta(nome), k = p.codigo ? "cod:" + p.codigo : chaveConta(p.nome);
    if (k && !regraConta(nome, regras) && GRUPOS_CONTA.includes(g)) novas[k] = { grupo: g, nome: texto(p.nome, 120), codigo: p.codigo };
  });
  const grupoDe = (conta) => { const r = regraConta(conta, regras, novas); return r ? r.grupo : null; };

  const casos = (await env.DB.prepare("SELECT * FROM jur_casos WHERE arquivado = 0").all()).results;
  const idx = indiceCasosJur(casos);
  const comps = (await env.DB.prepare("SELECT * FROM jur_competencias ORDER BY mes").all()).results;
  const jaImportada = comps.find((c) => c.mes === mes) || null;
  const anteriores = comps.filter((c) => c.mes < mes);
  const compAnt = anteriores.length ? anteriores[anteriores.length - 1] : null, mesAnt = compAnt ? compAnt.mes : "";
  const ultima = comps.length ? comps[comps.length - 1].mes : "";
  // mês mais antigo que o último importado: só entra no histórico, o painel mostra o mês mais recente
  const atualizaPainel = !ultima || mes >= ultima;
  const ant = {};
  if (mesAnt) (await env.DB.prepare("SELECT * FROM jur_hist WHERE mes = ?").bind(mesAnt).all()).results.forEach((h) => { ant[h.caso_id] = h; });

  const porCaso = {}, fora = {}, contas = {}, outras = {};
  let registros = 0, semConta = 0;
  for (const l of linhas) {
    const nome = texto(l.aluno || l.nome, 150), ra = texto(l.ra, 30), conta = texto(l.conta, 120);
    const valor = numero(l.valor), n = Math.max(1, parseInt(l.parcelas, 10) || 1);
    if (!nome && !ra) continue;
    const achados = acharCasosJur(idx, ra, nome);
    if (!achados.length) {
      const k = ra + "|" + normNome(nome), f = fora[k] || (fora[k] = { ra, aluno: nome, valor: 0 });
      f.valor = r2(f.valor + valor); continue;
    }
    // aluno com caso em mais de uma carteira: a parcela vai para o caso cujo ano letivo é o ano do
    // vencimento; sem caso daquele ano, para a carteira mais recente
    const anoVenc = texto(l.ano, 4);
    const c = (anoVenc && achados.find((o) => texto(o.ano, 10) === anoVenc)) || achados[0];
    achados.forEach((o) => { if (o.id !== c.id && !outras[o.id]) outras[o.id] = { ra: o.ra, aluno: o.aluno, carteira: o.carteira, usado: c.carteira }; });
    // relatório exportado sem as linhas "Conta financeira" (já filtrado por grupo): vale o tipo
    // escolhido para o arquivo inteiro
    const gArq = ["aberto", "negociado"].includes(l.grupoArquivo) ? l.grupoArquivo : null;
    const g = conta ? grupoDe(conta) : gArq;
    const chave = conta ? rotuloConta(conta, regras, novas) : (gArq ? `(relatório de ${gArq === "aberto" ? "valor em aberto" : "valor negociado"}, sem conta)` : "");
    const ct = contas[chave] || (contas[chave] = { conta: conta ? conta : chave, rotulo: chave, grupo: g, registros: 0, valor: 0, casos: new Set(), semConta: !conta });
    ct.registros += n; ct.valor = r2(ct.valor + valor); ct.casos.add(c.id);
    registros += n;
    if (!conta) semConta += n;
    const p = porCaso[c.id] || (porCaso[c.id] = { c, aberto: 0, negociado: 0, pAb: 0, pNeg: 0, contas: {}, venc: [] });
    // vencimento e valor de cada parcela ("a" = em aberto, "n" = negociado), para vencidas × a vencer
    if (g === "aberto" || g === "negociado") (Array.isArray(l.venc) ? l.venc : []).slice(0, 600).forEach((x) => {
      if (Array.isArray(x) && dataISO(x[0]) && p.venc.length < 1500) p.venc.push([x[0], numero(x[1]), g === "aberto" ? "a" : "n"]);
    });
    const nomeConta = chave || "(sem conta)";
    p.contas[nomeConta] = r2((p.contas[nomeConta] || 0) + valor);
    if (g === "aberto") { p.aberto += valor; p.pAb += n; }
    else if (g === "negociado") { p.negociado += valor; p.pNeg += n; }
  }
  const pendentes = Object.values(contas).filter((c) => !c.grupo).map((c) => c.rotulo || c.conta);

  // movimento de cada caso em relação ao mês anterior
  const movs = [];
  Object.values(porCaso).forEach((p) => {
    const c = p.c, ab = r2(p.aberto), neg = r2(p.negociado), h = ant[c.id];
    const conferir = [];
    let tipo;
    if (!mesAnt) tipo = "primeira";
    else if (!h || h.ausente) tipo = "novo";
    else {
      const dAb = r2(numero(h.valor_aberto) - ab), dNeg = r2(neg - numero(h.valor_negociado));
      if (Math.abs(dAb) < 0.01 && Math.abs(dNeg) < 0.01) tipo = "sem_movimento";
      else if (dNeg >= 0.01 && dAb >= 0.01) {
        tipo = "reclassificado";
        // renegociação tem juros e descontos: sem valores equivalentes não dá para afirmar que é o mesmo débito
        if (Math.abs(dAb - dNeg) > Math.max(1, dAb * 0.02))
          conferir.push(`Parte do valor em aberto (−${reais(dAb)}) passou para renegociação GM (+${reais(dNeg)}), mas os valores não correspondem: conferir se é o mesmo débito.`);
      } else {
        tipo = "alterado";
        if (dNeg >= 0.01) conferir.push(`Valor negociado GM subiu ${reais(dNeg)} sem redução equivalente do valor em aberto: conferir a renegociação.`);
      }
    }
    if (c.status === "quitado" && (ab > 0 || neg > 0)) conferir.push("O caso está como Quitado, mas aparece no relatório de inadimplência.");
    const contaTxt = Object.keys(p.contas).sort((x, y) => p.contas[y] - p.contas[x]).join(", ").slice(0, 200);
    const vencTxt = JSON.stringify(p.venc.sort((x, y) => x[0].localeCompare(y[0])));
    movs.push({ c, presente: true, ab, neg, pAb: p.pAb, pNeg: p.pNeg, vencTxt, contas: p.contas, contaTxt, tipo, conferir: conferir.join(" "), h });
  });
  casos.forEach((c) => {
    if (porCaso[c.id]) return;
    const h = ant[c.id];
    // o aluno está no relatório, mas nenhuma parcela é do ano letivo desta carteira
    if (outras[c.id]) {
      // carteira antiga já paga (Quitado ou sem valor) é o normal: aluno pagou, voltou a dever e
      // entrou em outra carteira. Só avisa quando o caso ainda tem valor e é a 1ª vez que acontece.
      const temValor = c.status !== "quitado" && (Number(c.valor_aberto) > 0 || Number(c.valor_negociado) > 0);
      const avisar = temValor && !(h && h.movimento === "outra_carteira");
      movs.push({ c, presente: false, tipo: "outra_carteira", saiu: false, h,
        conferir: !avisar ? "" : `O aluno consta no relatório de ${mesBR(mes)}, mas nenhuma parcela vence no ano letivo desta carteira (as parcelas foram para o caso da ${outras[c.id].usado}). Valores mantidos: conferir se o débito desta carteira foi pago ou renegociado.` });
      return;
    }
    // "deixou de constar": estava no mês anterior (no 1º mês: tinha valor no painel)
    const saiu = mesAnt ? !!(h && !h.ausente) : atualizaPainel && (Number(c.valor_aberto) > 0 || Number(c.valor_negociado) > 0);
    movs.push({ c, presente: false, tipo: "ausente", saiu, h,
      conferir: saiu ? `Não consta no relatório de inadimplência de ${mesBR(mes)}: os valores foram mantidos. Conferir se houve pagamento, acordo ou baixa (o caso não foi marcado como quitado).` : "" });
  });

  const pres = movs.filter((m) => m.presente);
  const contar = (t) => movs.filter((m) => m.tipo === t).length;
  const resumo = {
    aberto: r2(pres.reduce((t, m) => t + m.ab, 0)), negociado: r2(pres.reduce((t, m) => t + m.neg, 0)),
    casos: casos.length, noRelatorio: pres.length, registros, semConta,
    casosAberto: pres.filter((m) => m.ab > 0).length, casosNegociado: pres.filter((m) => m.neg > 0).length,
    reclassificados: contar("reclassificado"), semMovimento: contar("sem_movimento"), novos: contar("novo"), alterados: contar("alterado"),
    ausentes: contar("ausente"), sairam: movs.filter((m) => m.saiu).length, conferir: movs.filter((m) => m.conferir).length,
    foraDoPainel: Object.keys(fora).length,
    porConta: Object.values(contas).map((c) => ({ conta: c.conta, rotulo: c.rotulo, grupo: c.grupo, registros: c.registros, valor: c.valor, casos: c.casos.size, semConta: c.semConta })).sort((x, y) => y.valor - x.valor)
  };
  const saida = {
    mes, mesAnt, anterior: compAnt ? compSaida(compAnt) : null, jaImportada: jaImportada ? jaImportada.importado_em : "", atualizaPainel, ultima,
    resumo, pendentes,
    movimentos: movs.map((m) => ({ id: m.c.id, ra: m.c.ra, aluno: m.c.aluno, carteira: m.c.carteira, tipo: m.tipo, presente: m.presente, saiu: !!m.saiu,
      abAntes: m.h && !m.h.ausente ? m.h.valor_aberto : m.c.valor_aberto, ab: m.presente ? m.ab : null,
      negAntes: m.h && !m.h.ausente ? m.h.valor_negociado : m.c.valor_negociado, neg: m.presente ? m.neg : null,
      pAb: m.pAb || 0, pNeg: m.pNeg || 0, contas: m.contas || {}, conferir: m.conferir })),
    foraDoPainel: Object.values(fora).sort((x, y) => y.valor - x.valor), outrasCarteiras: Object.keys(outras).map((id) => ({ ...outras[id], recebeuParcelas: !!porCaso[id] })), gravado: false
  };
  if (b.simular) return json(saida);
  if (pendentes.length) throw new HttpError(400, "Classifique as contas financeiras que não estão nas regras antes de gravar: " + pendentes.map((c) => c || "(sem conta)").join(", ") + ".");

  const agora = agoraISO(), stmts = [];
  if (Object.keys(novas).length) stmts.push(env.DB.prepare("INSERT OR REPLACE INTO meta (chave, valor) VALUES ('jur_contas_regras', ?)").bind(JSON.stringify({ ...salvas, ...novas })));
  // a competência é gravada inteira de novo: importar o mesmo mês outra vez não duplica nada
  stmts.push(env.DB.prepare("DELETE FROM jur_hist WHERE mes = ?").bind(mes));
  const HCOLS = "(mes, caso_id, valor_aberto, valor_negociado, parcelas_aberto, parcelas_negociado, contas, ausente, movimento, conferir)";
  emLotes(movs, 9).forEach((lote) => {
    const vals = [];
    lote.forEach((m) => vals.push(mes, m.c.id, m.presente ? m.ab : null, m.presente ? m.neg : null, m.pAb || 0, m.pNeg || 0, JSON.stringify(m.contas || {}), m.presente ? 0 : 1, m.tipo, m.conferir || ""));
    stmts.push(env.DB.prepare("INSERT INTO jur_hist " + HCOLS + " VALUES " + lote.map(() => "(?,?,?,?,?,?,?,?,?,?)").join(",")).bind(...vals));
  });
  const arquivos = (Array.isArray(b.arquivos) ? b.arquivos : []).map((a) => texto(a, 120)).filter(Boolean).join(" | ").slice(0, 500);
  stmts.push(env.DB.prepare("INSERT OR REPLACE INTO jur_competencias (mes, data_relatorio, importado_em, importado_por, arquivos, resumo) VALUES (?,?,?,?,?,?)")
    .bind(mes, dataISO(b.dataRelatorio), agora, eu.nome, arquivos, JSON.stringify(resumo)));
  let alterados = 0;
  if (atualizaPainel) {
    const ref = `Relatório de inadimplência — competência ${mesBR(mes)}`;
    movs.forEach((m) => {
      const c = m.c;
      if (m.presente) {
        const mudouValor = m.ab !== c.valor_aberto || m.neg !== c.valor_negociado || m.pAb !== (c.parcelas || 0);
        const mudouParcelas = m.pNeg !== (c.parcelas_negociado || 0) || m.vencTxt !== (c.parcelas_venc || "[]");
        const novoConf = m.conferir && m.conferir !== c.conferir_motivo;
        // status sugerido pelo relatório (Verificar é escolha manual e fica como está):
        // tem valor em aberto = Em aberto; só valor negociado = Em negociação GM
        const stAntes = jurStatusValido(c.status);
        const st = stAntes === "verificar" ? stAntes : m.ab > 0 ? "em_aberto" : m.neg > 0 ? "em_negociacao" : stAntes;
        const mudouStatus = st !== stAntes;
        if (!mudouValor && !mudouParcelas && !mudouStatus && !novoConf && m.contaTxt === c.conta_financeira && c.competencia === mes) return;
        alterados++;
        stmts.push(env.DB.prepare("UPDATE jur_casos SET status = ?, valor_aberto = ?, valor_negociado = ?, parcelas = ?, parcelas_negociado = ?, parcelas_venc = ?, conta_financeira = ?, competencia = ?, flag_conflito = CASE WHEN ? THEN 1 ELSE flag_conflito END, conferir_motivo = CASE WHEN ? THEN ? ELSE conferir_motivo END, atualizado_em = ?, atualizado_por = ? WHERE id = ?")
          .bind(st, m.ab, m.neg, m.pAb, m.pNeg, m.vencTxt, m.contaTxt, mes, m.conferir ? 1 : 0, m.conferir ? 1 : 0, m.conferir, agora, eu.nome, c.id));
        if (!mudouValor && !mudouStatus && !novoConf) return;
        let t = `${ref}: valor em aberto ${reais(m.ab)} (${m.pAb} parcela(s)) · valor negociado GM ${reais(m.neg)}${m.pNeg ? ` (${m.pNeg} parcela(s))` : ""}.`;
        if (m.tipo === "reclassificado") t += ` Movimentação: parte do débito passou para renegociação GM (em aberto ${reais(m.h.valor_aberto)} → ${reais(m.ab)}; negociado ${reais(m.h.valor_negociado)} → ${reais(m.neg)}).`;
        else if (m.tipo === "alterado") t += ` Em relação a ${mesBR(mesAnt)}: em aberto ${reais(m.h.valor_aberto)} → ${reais(m.ab)}; negociado ${reais(m.h.valor_negociado)} → ${reais(m.neg)}.`;
        else if (m.tipo === "novo") t += ` Não constava no relatório de ${mesBR(mesAnt)}.`;
        if (mudouStatus) t += ` Status ${JUR_ST_ROTULO[stAntes]} → ${JUR_ST_ROTULO[st]}.`;
        if (m.conferir) t += " Conferir: " + m.conferir;
        stmts.push(insertObsJur(env, c.id, agora, t, eu));
      } else if (m.conferir && m.conferir !== c.conferir_motivo) {
        alterados++;
        stmts.push(env.DB.prepare("UPDATE jur_casos SET flag_conflito = 1, conferir_motivo = ?, atualizado_em = ?, atualizado_por = ? WHERE id = ?").bind(m.conferir, agora, eu.nome, c.id));
        stmts.push(insertObsJur(env, c.id, agora, `${ref}: ${m.conferir}`, eu));
      }
    });
    stmts.push(env.DB.prepare("INSERT OR REPLACE INTO meta (chave, valor) VALUES ('jur_inad_data', ?)").bind(dataISO(b.dataRelatorio) || hojeISO()));
  }
  await executarEmLotes(env, stmts);
  const inad = await env.DB.prepare("SELECT valor FROM meta WHERE chave = 'jur_inad_data'").first();
  return json({ ...saida, gravado: true, alterados, inadData: inad ? inad.valor : "" });
}

// ---------------------------------------------------------------- Cheques
// Cheques devolvidos e cheques recebidos (as duas abas da planilha CHEQUES_SER). O mesmo cheque
// (tipo + banco + agência + conta + número + vencimento + valor) nunca entra duas vezes.

const CHQ_TIPOS = ["devolvido", "recebido"];
const CHQ_CAMPOS = {
  ra: ["ra", 30], aluno: ["aluno", 150], responsavel: ["responsavel", 150], emitente: ["emitente", 150], cpfEmitente: ["cpf_emitente", 25],
  banco: ["banco", 20], agencia: ["agencia", 20], conta: ["conta", 30], numero: ["numero", 30],
  motivo: ["motivo", 120], pagamento: ["pagamento", 60], geracaoMentor: ["geracao_mentor", 60], observacao: ["observacao", 1000],
  motivoDevolucao: ["motivo_devolucao", 120], identificacao: ["identificacao", 200]
};
const CHQ_DATAS = { vencimento: "vencimento", dataRecebimento: "data_recebimento", dataDevolucao: "data_devolucao", dataFormulario: "data_formulario" };
const CHQ_COLS = ["id", "tipo", "chave", "ra", "aluno", "responsavel", "emitente", "cpf_emitente", "banco", "agencia", "conta", "numero", "valor", "vencimento", "data_recebimento", "motivo", "pagamento", "geracao_mentor", "observacao", "motivo_devolucao", "data_devolucao", "data_formulario", "identificacao", "criado_em", "criado_por", "atualizado_em", "atualizado_por"];

function chequeSaida(r) {
  return {
    id: r.id, tipo: r.tipo, ra: r.ra, aluno: r.aluno, responsavel: r.responsavel, emitente: r.emitente, cpfEmitente: r.cpf_emitente,
    banco: r.banco, agencia: r.agencia, conta: r.conta, numero: r.numero, valor: r.valor, vencimento: r.vencimento, dataRecebimento: r.data_recebimento,
    motivo: r.motivo, pagamento: r.pagamento, geracaoMentor: r.geracao_mentor, observacao: r.observacao,
    motivoDevolucao: r.motivo_devolucao, dataDevolucao: r.data_devolucao, dataFormulario: r.data_formulario, identificacao: r.identificacao,
    criadoEm: r.criado_em, criadoPor: r.criado_por, atualizadoEm: r.atualizado_em, atualizadoPor: r.atualizado_por
  };
}
// só os números de banco/agência/conta/cheque contam (000419 = 419; 22734-2 = 227342)
function chaveCheque(tipo, o) {
  const dig = (v) => String(v || "").replace(/\D/g, "").replace(/^0+/, "");
  return [tipo, dig(o.banco), dig(o.agencia), dig(o.conta), dig(o.numero), o.vencimento || "", o.valor == null ? "" : numero(o.valor).toFixed(2)].join("|");
}
// junta o que veio (tela ou planilha) com o registro salvo: campo que não veio fica como está
function chequeValores(o, atual, eu) {
  const a = atual || {}, agora = agoraISO();
  const tem = (k) => Object.prototype.hasOwnProperty.call(o, k);
  const v = { id: a.id || novoId(), tipo: CHQ_TIPOS.includes(o.tipo) ? o.tipo : (a.tipo || "devolvido") };
  Object.keys(CHQ_CAMPOS).forEach((k) => { const [col, max] = CHQ_CAMPOS[k]; v[col] = tem(k) ? texto(o[k], max) : a[col] || ""; });
  Object.keys(CHQ_DATAS).forEach((k) => { const col = CHQ_DATAS[k]; v[col] = tem(k) ? dataISO(o[k]) : a[col] || ""; });
  v.valor = tem("valor") ? valorOuNull(o.valor) : (a.valor ?? null);
  v.chave = chaveCheque(v.tipo, { banco: v.banco, agencia: v.agencia, conta: v.conta, numero: v.numero, vencimento: v.vencimento, valor: v.valor });
  v.criado_em = a.criado_em || agora; v.criado_por = a.criado_por || (eu ? eu.nome : "");
  v.atualizado_em = agora; v.atualizado_por = eu ? eu.nome : "";
  return CHQ_COLS.map((c) => v[c]);
}
async function listarCheques(env) {
  const r = (await env.DB.prepare("SELECT * FROM cheques ORDER BY vencimento DESC, aluno").all()).results;
  return json({ cheques: r.map(chequeSaida) });
}
async function salvarCheque(req, env, eu, id) {
  const b = await corpo(req);
  const atual = id ? await env.DB.prepare("SELECT * FROM cheques WHERE id = ?").bind(id).first() : null;
  if (id && !atual) throw new HttpError(404, "Cheque não encontrado.");
  if (!id && !CHQ_TIPOS.includes(b.tipo)) throw new HttpError(400, "Tipo do cheque inválido.");
  const vals = chequeValores(b, atual, eu);
  const r = {}; CHQ_COLS.forEach((c, i) => { r[c] = vals[i]; });
  if (!r.aluno && !r.emitente) throw new HttpError(400, "Informe o aluno ou o emitente do cheque.");
  if (!(Number(r.valor) > 0)) throw new HttpError(400, "Informe o valor do cheque.");
  const igual = await env.DB.prepare("SELECT id FROM cheques WHERE tipo = ? AND chave = ? AND id <> ?").bind(r.tipo, r.chave, r.id).first();
  if (igual && r.numero) throw new HttpError(400, "Esse cheque já está cadastrado (mesmo banco, agência, conta, número, vencimento e valor).");
  await env.DB.prepare(insertSQL("cheques", CHQ_COLS)).bind(...vals).run();
  return json({ cheque: chequeSaida(r) });
}
async function excluirCheque(env, id) {
  const r = await env.DB.prepare("SELECT id FROM cheques WHERE id = ?").bind(id).first();
  if (!r) throw new HttpError(404, "Cheque não encontrado.");
  await env.DB.prepare("DELETE FROM cheques WHERE id = ?").bind(id).run();
  return json({ ok: true });
}
// Importação da planilha: cheque novo é criado; o que já existe (mesma chave) é atualizado com
// as células preenchidas (vazia não apaga o que está salvo).
async function importarCheques(req, env, eu) {
  const b = await corpo(req);
  const linhas = Array.isArray(b.linhas) ? b.linhas.slice(0, 3000) : [];
  const existentes = {};
  // mesmo banco, agência, conta, número e vencimento com outro valor: é o valor sendo corrigido
  const semValor = (ch) => (String(ch || "").split("|")[4] ? String(ch).replace(/\|[^|]*$/, "") : "");
  const existentesSV = {};
  (await env.DB.prepare("SELECT * FROM cheques").all()).results.forEach((c) => {
    existentes[c.tipo + "#" + c.chave] = c;
    const sv = semValor(c.chave); if (sv) existentesSV[c.tipo + "#" + sv] = c;
  });
  const stmts = [];
  let criados = 0, atualizados = 0, ignorados = 0;
  linhas.forEach((l0) => {
    if (!l0 || !CHQ_TIPOS.includes(l0.tipo)) { ignorados++; return; }
    const o = { tipo: l0.tipo };
    Object.keys(CHQ_CAMPOS).concat(Object.keys(CHQ_DATAS), ["valor"]).forEach((k) => { if (l0[k] !== undefined && l0[k] !== null && String(l0[k]).trim() !== "") o[k] = l0[k]; });
    if (!o.aluno && !o.emitente) { ignorados++; return; }
    const chave = chaveCheque(o.tipo, { banco: texto(o.banco, 20), agencia: texto(o.agencia, 20), conta: texto(o.conta, 30), numero: texto(o.numero, 30), vencimento: dataISO(o.vencimento), valor: valorOuNull(o.valor) });
    const sv = semValor(chave);
    const atual = existentes[o.tipo + "#" + chave] || (sv && existentesSV[o.tipo + "#" + sv]) || null;
    // o mesmo cheque repetido na planilha com outra observação: junta as observações
    if (atual && o.observacao && atual.observacao && !atual.observacao.includes(texto(o.observacao, 1000))) o.observacao = atual.observacao + " | " + o.observacao;
    const vals = chequeValores(o, atual, eu);
    stmts.push(env.DB.prepare(insertSQL("cheques", CHQ_COLS)).bind(...vals));
    const r = {}; CHQ_COLS.forEach((c, i) => { r[c] = vals[i]; });
    if (atual && atual.chave !== r.chave) delete existentes[atual.tipo + "#" + atual.chave];
    existentes[o.tipo + "#" + r.chave] = r; if (sv) existentesSV[o.tipo + "#" + sv] = r;
    if (atual) atualizados++; else criados++;
  });
  await executarEmLotes(env, stmts);
  return json({ criados, atualizados, ignorados });
}
