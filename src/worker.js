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
  `CREATE TABLE IF NOT EXISTS meta (chave TEXT PRIMARY KEY, valor TEXT NOT NULL)`
];

// Períodos que já existiam na planilha "SERASA - SER", criados uma única vez.
const PERIODOS_INICIAIS = [
  ["RF 2024 - Janeiro a Abril", "2023-12-01", "2024-04-30"],
  ["01/05 - 30/09/2024", "2024-05-01", "2024-09-30"],
  ["01/10/2024 - 31/01/2025", "2024-10-01", "2025-01-31"],
  ["01/02 - 30/04/2025", "2025-02-01", "2025-04-30"],
  ["01/05 - 31/07/2025", "2025-05-01", "2025-07-31"],
  ["01/08 - 31/10/2025", "2025-08-01", "2025-10-31"],
  ["01/11 - 31/01/26", "2025-11-01", "2026-01-31"],
  ["01/02 - 31/03/2026", "2026-02-01", "2026-03-31"],
  ["01/04 - 30/06/2026", "2026-04-01", "2026-06-30"]
];

// Carteiras de alunos: "regular" (aba Painel) e "contraturno" (aba Contraturno).
const CARTEIRAS = ["regular", "contraturno"];
function carteiraValida(v) { return CARTEIRAS.includes(v) ? v : "regular"; }

// Situação da parcela no Mentor e no Serasa ("" = pendente).
const SERASA_STATUS = ["", "ok", "pago", "negociado", "juridico", "bloqueio", "nao_negativar"];
function statusSerasaValido(v) { return SERASA_STATUS.includes(v) ? v : ""; }

const ALUNO_COLS = ["id", "nome", "ra", "turma", "responsavel", "telefone", "email", "valor_aberto", "parcelas_aberto", "vencimento", "status", "setor", "atendente_responsavel", "ultimo_contato_data", "ultimo_contato_canal", "proximo_retorno", "arquivado", "ultima_atualizacao_financeira", "criado_em", "atualizado_em", "carteira"];
const SERASA_COLS = ["id", "ra", "nome", "responsavel", "cpf", "vencimento", "valor", "tipo", "mentor", "serasa", "data_inclusao", "resp_inclusao", "observacao", "criado_em", "atualizado_em", "atualizado_por"];
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
        // Cria os períodos da planilha uma única vez (se forem apagados, não voltam).
        // Só quem conseguir gravar a marca "periodos_iniciais" cria os períodos (evita duplicar
        // se duas pessoas abrirem o site ao mesmo tempo logo após a atualização).
        const agora = agoraISO();
        const marca = await env.DB.prepare("INSERT OR IGNORE INTO meta (chave, valor) VALUES ('periodos_iniciais', ?)").bind(agora).run();
        if (!marca.meta || marca.meta.changes > 0) {
          await env.DB.batch(PERIODOS_INICIAIS.map(([nome, ini, fim]) => env.DB.prepare(
            "INSERT INTO serasa_periodos (id, nome, inicio, fim, criado_em, criado_por) VALUES (?,?,?,?,?, 'planilha')").bind(novoId(), nome, ini, fim, agora)));
        }
        schemaPronto = true;
      }
      return await rotear(request, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ erro: e.message, codigo: e.code || null }, e.status);
      console.error(e && e.stack || e);
      return json({ erro: "Erro interno no servidor. Tente de novo em instantes." }, 500);
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
      await env.DB.prepare("DELETE FROM serasa_periodos WHERE id = ?").bind(partes[2]).run();
      return json({ ok: true });
    }
  }

  if (partes[0] === "serasa") {
    if (partes.length === 1 && m === "GET") return listarSerasa(env);
    if (partes.length === 1 && m === "POST") return criarSerasa(req, env, eu);
    if (partes[1] === "importar" && m === "POST") return importarSerasa(req, env, eu);
    if (partes[1] === "lote" && m === "POST") return loteSerasa(req, env, eu);
    if (partes.length === 2 && m === "PATCH") return alterarSerasa(req, env, eu, partes[1]);
    if (partes.length === 2 && m === "DELETE") { exigirAdmin(eu); return excluirSerasa(env, partes[1]); }
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
    createdAt: r.criado_em, updatedAt: r.atualizado_em, carteira: r.carteira || "regular"
  };
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
  let criados = 0, atualizados = 0;

  for (const r of linhas) {
    const nome = texto(r.nome, 150);
    if (!nome) continue;
    const ra = texto(r.ra, 30);
    const achado = (ra && porRa[ra.toLowerCase()]) || porNome[nome.toLowerCase()];
    if (achado) {
      if (tocados.has(achado.id)) continue;
      const sets = ["valor_aberto = ?", "parcelas_aberto = ?", "ultima_atualizacao_financeira = ?", "atualizado_em = ?"];
      const vals = [numero(r.valorAberto), parseInt(r.parcelas, 10) || 1, agora, agora];
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
      porNome[nome.toLowerCase()] = { id, nome, ra };
      if (ra) porRa[ra.toLowerCase()] = { id, nome, ra };
      tocados.add(id);
      criados++;
    }
  }
  await executarEmLotes(env, stmts);
  const foraDaPlanilha = ativosAntes.filter((a) => !tocados.has(a.id)).map((a) => ({ id: a.id, nome: a.nome, valorAberto: a.valor_aberto }));
  return json({ criados, atualizados, foraDaPlanilha });
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
  return lista.slice(0, 36)
    .filter((m) => m && typeof m.mes === "string" && /^\d{4}-\d{2}$/.test(m.mes))
    .map((m) => ({ mes: m.mes, valor: numero(m.valor) }));
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
    atualizadoEm: r.atualizado_em, atualizadoPor: r.atualizado_por
  };
}

function serasaValores(o, id, eu, criadoEm) {
  const agora = agoraISO();
  return [
    id, texto(o.ra, 30), texto(o.nome, 150), texto(o.responsavel, 150), texto(o.cpf, 20), dataISO(o.vencimento),
    numero(o.valor), texto(o.tipo, 40), statusSerasaValido(o.mentor), statusSerasaValido(o.serasa),
    dataISO(o.dataInclusao), texto(o.respInclusao, 80), texto(o.observacao, 2000),
    criadoEm || agora, agora, eu ? eu.nome : ""
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
  return json({ parcelas: r.results.map(serasaSaida) });
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

// Importa o relatório: parcela nova é cadastrada; parcela que já existe (mesma chave) só
// recebe os campos que vieram preenchidos na planilha — nada que a equipe já marcou é apagado.
async function importarSerasa(req, env, eu) {
  const b = await corpo(req);
  const linhas = Array.isArray(b.linhas) ? b.linhas.slice(0, 10000) : [];
  if (!linhas.length) throw new HttpError(400, "Nenhuma linha para importar.");
  const existentes = {};
  (await env.DB.prepare("SELECT * FROM serasa").all()).results.forEach((r) => { existentes[chaveSerasa(serasaSaida(r))] = r; });
  const stmts = [];
  let criados = 0, atualizados = 0, ignorados = 0;
  const vistos = new Set();
  for (const l of linhas) {
    if ((!texto(l.nome) && !texto(l.responsavel)) || !dataISO(l.vencimento)) { ignorados++; continue; }
    const k = chaveSerasa(l);
    if (vistos.has(k)) { ignorados++; continue; }
    vistos.add(k);
    const achado = existentes[k];
    if (achado) {
      const base = serasaSaida(achado);
      const junto = { ...base };
      ["nome", "responsavel", "cpf", "tipo", "respInclusao", "observacao"].forEach((c) => { if (texto(l[c])) junto[c] = l[c]; });
      ["mentor", "serasa"].forEach((c) => { if (statusSerasaValido(l[c])) junto[c] = l[c]; });
      if (dataISO(l.dataInclusao)) junto.dataInclusao = l.dataInclusao;
      const mudou = JSON.stringify(serasaValores(junto, achado.id, null).slice(0, 13)) !== JSON.stringify(serasaValores(base, achado.id, null).slice(0, 13));
      if (!mudou) { ignorados++; continue; }
      stmts.push(env.DB.prepare(insertSQL("serasa", SERASA_COLS)).bind(...serasaValores(junto, achado.id, eu, achado.criado_em)));
      atualizados++;
    } else {
      stmts.push(env.DB.prepare(insertSQL("serasa", SERASA_COLS)).bind(...serasaValores(l, novoId(), eu)));
      criados++;
    }
  }
  await executarEmLotes(env, stmts);
  return json({ criados, atualizados, ignorados });
}

// Atualiza várias parcelas de uma vez (ex.: "incluídas no Serasa hoje").
async function loteSerasa(req, env, eu) {
  const b = await corpo(req);
  const ids = Array.isArray(b.ids) ? b.ids.slice(0, 5000).map(String) : [];
  if (!ids.length) throw new HttpError(400, "Selecione ao menos uma parcela.");
  const sets = [], vals = [];
  if (b.mentor !== undefined) { sets.push("mentor = ?"); vals.push(statusSerasaValido(b.mentor)); }
  if (b.serasa !== undefined) { sets.push("serasa = ?"); vals.push(statusSerasaValido(b.serasa)); }
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
