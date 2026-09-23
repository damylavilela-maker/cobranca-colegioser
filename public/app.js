// Painel de Cobrança — Colégio Ser (interface)
(function () {
  "use strict";

  var CANAIS = ["WhatsApp", "Ligação", "E-mail", "ClassApp", "Presencial"];
  var SETORES = ["Secretaria", "Financeiro", "Pedagógico", "Direção", "Rematrícula", "Jurídico"];
  var MOTIVOS = ["Cobrança de parcela em atraso", "Negociação de acordo", "Confirmação de pagamento", "Atualização de dados cadastrais", "Solicitação da família", "Retorno de contato agendado", "Encaminhamento ao jurídico", "Outro"];
  var STATUS = [
    { k: "sem_contato", l: "Sem contato", c: "gray" },
    { k: "em_negociacao", l: "Em negociação", c: "info" },
    { k: "amortizando", l: "Amortizando", c: "gold" },
    { k: "aguardando_retorno", l: "Aguardando retorno", c: "warn" },
    { k: "retornar_contato", l: "Retornar contato", c: "brand" },
    { k: "regularizado", l: "Regularizado", c: "success" },
    { k: "sem_previsao", l: "Sem previsão", c: "danger" }
  ];
  var MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  var DIAS_SEMANA = ["dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."];
  var GRP_PALETTE = ["brand", "gold", "info", "warn", "success", "danger", "gray"];
  var DIA_VENCIMENTO_MENSALIDADE = 5;

  // ---------------------------------------------------------------- utilidades
  function $(id) { return document.getElementById(id); }
  function st(k) { for (var i = 0; i < STATUS.length; i++) if (STATUS[i].k === k) return STATUS[i]; return STATUS[0]; }
  function pill(k, small) {
    var s = st(k);
    return '<span class="pill" style="color:var(--' + s.c + ');background:var(--' + s.c + '-soft)' + (small ? ';font-size:12px;padding:2px 8px' : '') + '"><i></i>' + s.l + '</span>';
  }
  function money(n) { return (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  function isoLocal(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function hoje() { return isoLocal(new Date()); }
  function mesAtual() { return hoje().slice(0, 7); }
  function br(s) { if (!s) return "—"; var p = String(s).slice(0, 10).split("-"); return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : s; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function diasAte(iso) { if (!iso) return null; var d = new Date(iso + "T00:00:00"), n = new Date(); n.setHours(0, 0, 0, 0); return Math.round((d - n) / 86400000); }
  function primeiroNome(n) { return String(n || "").split(" ")[0]; }
  function fill(sel, items, ph) {
    sel.innerHTML = (ph ? '<option value="">' + esc(ph) + '</option>' : "") + items.map(function (i) {
      var v = typeof i === "string" ? i : i.v, l = typeof i === "string" ? i : i.l;
      return '<option value="' + esc(v) + '">' + esc(l) + "</option>";
    }).join("");
  }
  function toast(m) {
    var t = $("toast"); t.textContent = m; t.hidden = false;
    clearTimeout(toast.h); toast.h = setTimeout(function () { t.hidden = true; }, 3200);
  }
  function mostrarErro(el, msg) { el.textContent = msg; el.hidden = !msg; }
  function baixar(nome, conteudo) {
    var blob = new Blob(["﻿" + conteudo], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function faixaAtrasoDe(venc, dataAt) {
    if (!venc || !dataAt) return "";
    var dias = Math.round((new Date(dataAt + "T00:00:00") - new Date(venc + "T00:00:00")) / 86400000);
    if (dias <= 0) return "em_dia"; if (dias <= 30) return "30"; if (dias <= 60) return "60"; if (dias <= 90) return "90"; return "90+";
  }

  // ---------------------------------------------------------------- API
  function api(method, path, body, opts) {
    opts = opts || {};
    var init = { method: method, credentials: "same-origin", headers: { "X-Painel": "1" } };
    if (body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
    return fetch(path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.status === 401 && !opts.silent401) { irParaLogin("Sua sessão expirou. Entre novamente."); }
        if (r.status === 403 && data && data.codigo === "trocar_senha") { mostrarTroca(); }
        if (!r.ok) { var e = new Error(data.erro || ("Erro " + r.status)); e.status = r.status; e.codigo = data.codigo; throw e; }
        return data;
      });
    }, function () { throw new Error("Sem conexão com o servidor. Verifique a internet e tente de novo."); });
  }

  // ---------------------------------------------------------------- estado
  var eu = null;
  var alunos = {};
  var atends = [];          // todos os atendimentos, mais recentes primeiro
  var atendentesAtivos = [];
  var usuarios = [];
  var view = "painel";
  var carteira = "regular";   // carteira mostrada na tela do painel (Painel ou Contraturno)
  var parcelas = [];          // aba Serasa
  var showArch = false, soHoje = false;
  var curId = null;
  var pollTimer = null;

  // ---------------------------------------------------------------- telas de acesso
  function telaAuth(form) {
    $("boot").hidden = true; $("app").hidden = true; $("auth").hidden = false;
    ["formLogin", "formSetup", "formTroca"].forEach(function (f) { $(f).hidden = f !== form; });
    fecharModais();
  }
  function irParaLogin(msg) {
    eu = null; pararPolling();
    telaAuth("formLogin");
    $("lPass").value = "";
    mostrarErro($("loginErr"), "");
    if (msg) toast(msg);
    setTimeout(function () { $("lUser").focus(); }, 30);
  }
  function mostrarTroca() {
    telaAuth("formTroca");
    ["tAtual", "tNova", "tNova2"].forEach(function (i) { $(i).value = ""; });
    mostrarErro($("trocaErr"), "");
    setTimeout(function () { $("tAtual").focus(); }, 30);
  }

  function iniciar() {
    api("GET", "/api/setup").then(function (s) {
      if (s.precisaSetup) { telaAuth("formSetup"); setTimeout(function () { $("sNome").focus(); }, 30); return; }
      return api("GET", "/api/me", undefined, { silent401: true }).then(function (d) {
        eu = d.usuario;
        if (eu.trocarSenha) return mostrarTroca();
        entrar();
      }, function (e) { if (e.status === 401) irParaLogin(); else throw e; });
    }).catch(function (e) {
      $("boot").textContent = e.message || "Não foi possível abrir o painel.";
    });
  }

  $("formLogin").addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = $("btnEntrar"); btn.disabled = true;
    api("POST", "/api/login", { usuario: $("lUser").value.trim().toLowerCase(), senha: $("lPass").value }, { silent401: true })
      .then(function (d) {
        eu = d.usuario;
        if (eu.trocarSenha) return mostrarTroca();
        entrar(); toast("Olá, " + primeiroNome(eu.nome) + "!");
      })
      .catch(function (err) { mostrarErro($("loginErr"), err.message); })
      .then(function () { btn.disabled = false; });
  });

  $("formSetup").addEventListener("submit", function (e) {
    e.preventDefault();
    var err = $("setupErr");
    if ($("sPass").value !== $("sPass2").value) return mostrarErro(err, "As duas senhas não conferem.");
    api("POST", "/api/setup", { chave: $("sChave").value, nome: $("sNome").value.trim(), usuario: $("sUser").value.trim().toLowerCase(), senha: $("sPass").value })
      .then(function (d) { eu = d.usuario; entrar(); toast("Painel configurado. Agora crie os acessos da equipe em Usuários."); })
      .catch(function (x) { mostrarErro(err, x.message); });
  });

  $("formTroca").addEventListener("submit", function (e) {
    e.preventDefault();
    var err = $("trocaErr");
    if ($("tNova").value !== $("tNova2").value) return mostrarErro(err, "As duas senhas novas não conferem.");
    api("POST", "/api/me/senha", { atual: $("tAtual").value, nova: $("tNova").value })
      .then(function () { return api("GET", "/api/me"); })
      .then(function (d) { eu = d.usuario; entrar(); toast("Senha criada. Tudo pronto!"); })
      .catch(function (x) { mostrarErro(err, x.message); });
  });

  document.querySelectorAll("[data-sair]").forEach(function (b) {
    b.addEventListener("click", function () {
      api("POST", "/api/logout", {}, { silent401: true }).catch(function () {}).then(function () { irParaLogin("Você saiu do painel."); });
    });
  });
  document.querySelectorAll(".pw-toggle").forEach(function (b) {
    b.addEventListener("click", function () {
      var i = $(b.getAttribute("data-pw")); var mostra = i.type === "password";
      i.type = mostra ? "text" : "password"; b.textContent = mostra ? "Ocultar" : "Mostrar";
    });
  });

  // ---------------------------------------------------------------- entrada no app
  function entrar() {
    $("boot").hidden = true; $("auth").hidden = true; $("app").hidden = false;
    $("uNome").textContent = eu.nome;
    $("uPerfil").textContent = eu.perfil === "admin" ? "Administrador(a)" : "Atendente";
    $("uAvatar").textContent = eu.nome.split(" ").map(function (p) { return p[0] || ""; }).slice(0, 2).join("").toUpperCase();
    document.querySelectorAll("[data-admin]").forEach(function (el) { el.hidden = eu.perfil !== "admin"; });
    var h = new Date().getHours();
    $("saudacao").textContent = (h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite") + ", " + primeiroNome(eu.nome) + " · " + cap(new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }));
    if (view === "usuarios" && eu.perfil !== "admin") view = "painel";
    ir(view);
    carregar();
    iniciarPolling();
  }

  function carregar() {
    return Promise.all([api("GET", "/api/alunos"), api("GET", "/api/atendimentos"), api("GET", "/api/atendentes"), api("GET", "/api/serasa"), api("GET", "/api/serasa/periodos")])
      .then(function (r) {
        alunos = {}; r[0].alunos.forEach(function (a) { alunos[a.id] = a; });
        atends = r[1].atendimentos;
        atendentesAtivos = r[2].atendentes;
        parcelas = r[3].parcelas;
        periodos = r[4].periodos;
        marcarSync(true);
        renderTudo();
      })
      .catch(function (e) { marcarSync(false); if (e.status !== 401 && e.status !== 403) toast(e.message); });
  }
  function marcarSync(ok) {
    $("sync").classList.toggle("off", !ok);
    $("syncLbl").textContent = ok ? "Atualizado às " + new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "Sem conexão";
  }
  function iniciarPolling() {
    pararPolling();
    pollTimer = setInterval(function () {
      if (document.hidden || !eu) return;
      if (!$("mDetalhe").hidden || !$("mImportar").hidden || !$("mSerasa").hidden || !$("mPeriodo").hidden) return; // não atrapalha quem está preenchendo
      carregar();
    }, 60000);
  }
  function pararPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
  document.addEventListener("visibilitychange", function () { if (!document.hidden && eu && $("mDetalhe").hidden) carregar(); });

  function renderTudo() {
    if (view === "painel" || view === "contraturno") renderPainel();
    if (view === "evolucao") renderEvolucao();
    if (view === "serasa") renderSerasa();
    if (view === "usuarios") renderUsuarios();
    atualizarBadge();
  }

  // As abas Painel e Contraturno usam a mesma tela, cada uma com a sua carteira de alunos
  // e os seus próprios filtros.
  var CARTEIRA_INFO = {
    regular: { titulo: "Painel de cobrança", arquivo: "relatorio_cobranca_" },
    contraturno: { titulo: "Contraturno", arquivo: "relatorio_contraturno_" }
  };
  var FILTROS = ["fBusca", "fStatus", "fSetor", "fAtend", "fOrdem"];
  var filtrosPorCarteira = {};
  function trocarCarteira(nova) {
    if (nova === carteira) return;
    var salvo = { showArch: showArch, soHoje: soHoje };
    FILTROS.forEach(function (id) { salvo[id] = $(id).value; });
    filtrosPorCarteira[carteira] = salvo;
    carteira = nova;
    var f = filtrosPorCarteira[nova] || { showArch: false, soHoje: false, fOrdem: "valor" };
    FILTROS.forEach(function (id) { $(id).value = f[id] || (id === "fOrdem" ? "valor" : ""); });
    showArch = f.showArch; soHoje = f.soHoje;
    $("painelTitulo").textContent = CARTEIRA_INFO[nova].titulo;
  }

  function ir(v) {
    view = v;
    if (v === "painel") trocarCarteira("regular");
    if (v === "contraturno") trocarCarteira("contraturno");
    var el = v === "contraturno" ? "painel" : v;
    document.querySelectorAll(".view").forEach(function (x) { x.hidden = x.id !== "v-" + el; });
    document.querySelectorAll("#nav button").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-view") === v); });
    if (v === "usuarios") carregarUsuarios();
    renderTudo();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll("#nav button").forEach(function (b) { b.addEventListener("click", function () { ir(b.getAttribute("data-view")); }); });

  // ---------------------------------------------------------------- painel / contraturno
  function lista() { return Object.keys(alunos).map(function (id) { return alunos[id]; }); }
  function carteiraDe(a) { return a && a.carteira === "contraturno" ? "contraturno" : "regular"; }
  function listaCarteira(c) { return lista().filter(function (a) { return carteiraDe(a) === c; }); }
  // O mesmo aluno pode estar nas duas carteiras: são ligados pelo RA (ou pelo nome, sem RA).
  function vinculadosDe(a) {
    var ra = (a.ra || "").trim().toLowerCase(), nome = (a.nome || "").trim().toLowerCase();
    return lista().filter(function (b) {
      if (b.id === a.id) return false;
      var rb = (b.ra || "").trim().toLowerCase(), nb = (b.nome || "").trim().toLowerCase();
      return ra ? (rb === ra || (!rb && nb === nome)) : nb === nome;
    });
  }
  function recuperadoNoMes(mes, c) {
    var t = 0;
    atends.forEach(function (a) { if (a.data && a.data.slice(0, 7) === mes && carteiraDe(alunos[a.alunoId]) === c) t += Number(a.valorRecuperado) || 0; });
    return t;
  }
  function nomesAtendentes() {
    var set = {};
    atendentesAtivos.forEach(function (n) { set[n] = 1; });
    lista().forEach(function (a) { if (a.atendenteResponsavel) set[a.atendenteResponsavel] = 1; });
    return Object.keys(set).sort(function (a, b) { return a.localeCompare(b); });
  }
  function atualizarBadge() {
    var h = hoje(), n = { regular: 0, contraturno: 0 };
    lista().forEach(function (a) { if (!a.arquivado && a.proximoRetorno && a.proximoRetorno <= h) n[carteiraDe(a)]++; });
    $("navBadge").hidden = !n.regular; $("navBadge").textContent = n.regular;
    $("navBadgeCt").hidden = !n.contraturno; $("navBadgeCt").textContent = n.contraturno;
    return n[carteira];
  }

  fill($("fStatus"), STATUS.map(function (s) { return { v: s.k, l: s.l }; }), "Todos os status");
  fill($("fSetor"), SETORES, "Todos os setores");
  fill($("nSetor"), SETORES); fill($("eSetor"), SETORES, "—");
  fill($("aCanal"), CANAIS); fill($("aSetor"), SETORES); fill($("aMotivo"), MOTIVOS);
  fill($("aStatus"), STATUS.map(function (s) { return { v: s.k, l: s.l }; }));

  function renderKpis(vis) {
    var tot = 0, c = {};
    vis.forEach(function (a) { tot += Number(a.valorAberto) || 0; var k = a.status || "sem_contato"; c[k] = (c[k] || 0) + 1; });
    var mesLbl = MESES[new Date().getMonth()];
    var tiles = [
      { n: vis.length, l: "Alunos em acompanhamento" },
      { n: money(tot), l: "Valor em aberto", cls: "lead" },
      { n: money(recuperadoNoMes(mesAtual(), carteira)), l: "Recuperado em " + mesLbl, c: "success" },
      { n: c.sem_contato || 0, l: "Sem contato", c: "gray" },
      { n: c.em_negociacao || 0, l: "Em negociação", c: "info" },
      { n: c.aguardando_retorno || 0, l: "Aguardando retorno", c: "warn" },
      { n: c.regularizado || 0, l: "Regularizados", c: "success" }
    ];
    $("kpis").innerHTML = tiles.map(function (t) {
      return '<div class="kpi ' + (t.cls || "") + '"><div class="num tabular"' + (t.c ? ' style="color:var(--' + t.c + ')"' : "") + ' title="' + esc(t.n) + '">' + t.n + '</div><div class="lbl">' + t.l + "</div></div>";
    }).join("");
  }

  function renderPainel() {
    var todos = listaCarteira(carteira);
    renderKpis(todos.filter(function (a) { return !a.arquivado; }));
    var sel = $("fAtend"), cur = sel.value;
    fill(sel, nomesAtendentes(), "Todas as atendentes"); sel.value = cur;
    var nh = atualizarBadge();
    $("btnHoje").textContent = "Retornos de hoje" + (nh ? " (" + nh + ")" : "");
    $("btnHoje").classList.toggle("on", soHoje);
    $("btnArquivados").textContent = showArch ? "Ver ativos" : "Arquivados";

    var q = $("fBusca").value.trim().toLowerCase(), fs = $("fStatus").value, fset = $("fSetor").value, fa = $("fAtend").value;
    var ord = soHoje ? "retorno" : $("fOrdem").value, h = hoje();
    var f = todos.filter(function (a) {
      if (!!a.arquivado !== showArch) return false;
      if (q && ((a.nome || "") + " " + (a.responsavel || "") + " " + (a.ra || "")).toLowerCase().indexOf(q) === -1) return false;
      if (fs && (a.status || "sem_contato") !== fs) return false;
      if (fset && a.setor !== fset) return false;
      if (fa && a.atendenteResponsavel !== fa) return false;
      if (soHoje && !(a.proximoRetorno && a.proximoRetorno <= h)) return false;
      return true;
    });
    f.sort(function (a, b) {
      if (ord === "valor") return (Number(b.valorAberto) || 0) - (Number(a.valorAberto) || 0);
      if (ord === "nome") return (a.nome || "").localeCompare(b.nome || "");
      if (ord === "recente") return ((b.ultimoContato && b.ultimoContato.data) || "").localeCompare((a.ultimoContato && a.ultimoContato.data) || "");
      return (a.proximoRetorno || "9999").localeCompare(b.proximoRetorno || "9999");
    });
    $("count").textContent = f.length + (f.length === 1 ? " aluno encontrado" : " alunos encontrados") + (showArch ? " · arquivados" : "") + (soHoje ? " · retorno hoje ou atrasado" : "");

    var tb = $("tbody");
    if (!f.length) {
      var vazio = !todos.length;
      tb.innerHTML = '<tr><td colspan="7" class="empty"><b>' + (vazio ? "Nenhum aluno cadastrado ainda" : "Nenhum resultado para estes filtros") + '</b><div class="muted">' +
        (vazio ? "Importe a planilha atual ou cadastre o primeiro caso para começar." : "Ajuste a busca ou os filtros acima.") + "</div></td></tr>";
      return;
    }
    tb.innerHTML = f.map(function (a) {
      var v = Number(a.valorAberto) || 0, uc = a.ultimoContato, pr = a.proximoRetorno, pc;
      if (pr) {
        var atras = !a.arquivado && pr < h, eHoje = pr === h;
        pc = '<span class="' + (atras ? "late" : eHoje ? "today" : "") + '">' + br(pr) + "</span>" + (atras ? '<div class="meta late" style="font-weight:400">atrasado</div>' : eHoje ? '<div class="meta">hoje</div>' : "");
      } else pc = '<span class="muted">—</span>';
      return '<tr class="click" data-id="' + esc(a.id) + '"><td><div class="nome">' + esc(a.nome || "—") + '</div><div class="meta">' +
        esc(a.responsavel || "sem responsável informado") + (a.ra ? " · RA " + esc(a.ra) : "") + (a.turma ? " · " + esc(a.turma) : "") + "</div></td>" +
        '<td><span class="money tabular' + (v ? "" : " zero") + '">' + money(v) + "</span>" + (a.parcelasAberto > 1 ? '<div class="meta">' + a.parcelasAberto + " parcelas</div>" : "") + "</td>" +
        "<td>" + pill(a.status || "sem_contato") + "</td>" +
        "<td>" + (a.setor ? esc(a.setor) : '<span class="muted">—</span>') + "</td>" +
        "<td>" + (uc && uc.data ? br(uc.data) + '<div class="meta">' + esc(uc.canal || "") + "</div>" : '<span class="muted">sem contato</span>') + "</td>" +
        "<td>" + pc + "</td>" +
        "<td>" + (a.atendenteResponsavel ? esc(a.atendenteResponsavel) : '<span class="muted">—</span>') + "</td></tr>";
    }).join("");
  }
  $("tbody").addEventListener("click", function (e) { var tr = e.target.closest("tr[data-id]"); if (tr) abrirAluno(tr.getAttribute("data-id")); });
  ["fBusca", "fStatus", "fSetor", "fAtend", "fOrdem"].forEach(function (id) { $(id).addEventListener("input", renderPainel); });
  $("btnHoje").addEventListener("click", function () { soHoje = !soHoje; if (soHoje) $("fOrdem").value = "retorno"; renderPainel(); });
  $("btnArquivados").addEventListener("click", function () { showArch = !showArch; renderPainel(); });

  // ---------------------------------------------------------------- modais
  function abrir(id) { $(id).hidden = false; }
  function fecharModais() { document.querySelectorAll(".overlay").forEach(function (o) { o.hidden = true; }); }
  document.querySelectorAll(".overlay").forEach(function (o) {
    o.addEventListener("mousedown", function (e) { if (e.target === o) o.hidden = true; });
    o.addEventListener("click", function (e) { if (e.target.closest("[data-close]")) o.hidden = true; });
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") fecharModais(); });

  // ---------------------------------------------------------------- ficha do aluno
  function abrirAluno(id) {
    var a = alunos[id]; if (!a) return; curId = id;
    $("dNome").textContent = a.nome || "—";
    $("dSub").textContent = (a.turma || "turma não informada") + (a.ra ? " · RA " + a.ra : "");
    var venc = a.vencimento ? (function () { var d = -diasAte(a.vencimento); return br(a.vencimento) + ' <span class="muted" style="font-weight:400">(' + (d > 0 ? d + " dias em atraso" : "ainda não vencida") + ")</span>"; })() : '<span class="muted">não informado</span>';
    $("dInfoView").innerHTML =
      '<div class="k">Responsável</div><div class="v">' + esc(a.responsavel || "—") + "</div>" +
      '<div class="k">Contato</div><div class="v">' + esc([a.telefone, a.email].filter(Boolean).join(" · ") || "—") + "</div>" +
      '<div class="k">Valor em aberto</div><div class="v tabular">' + money(a.valorAberto) + (a.parcelasAberto > 1 ? ' <span class="muted" style="font-weight:400">(' + a.parcelasAberto + " parcelas)</span>" : "") +
      (a.ultimaAtualizacaoFinanceira ? '<div class="meta" style="font-weight:400">atualizado em ' + br(a.ultimaAtualizacaoFinanceira) + " via importação</div>" : "") + "</div>" +
      '<div class="k">Vencimento</div><div class="v">' + venc + "</div>" +
      '<div class="k">Setor</div><div class="v">' + esc(a.setor || "—") + "</div>" +
      '<div class="k">Status atual</div><div class="v">' + pill(a.status || "sem_contato") + "</div>";
    var outra = vinculadosDe(a).filter(function (b) { return carteiraDe(b) !== carteiraDe(a); })[0];
    $("dArchBanner").innerHTML =
      (a.arquivado ? '<div class="arch-banner">Este aluno está arquivado. Um novo atendimento reativa o acompanhamento automaticamente.</div>' : "") +
      (outra ? '<div class="link-banner"><b>Também está no ' + (carteiraDe(outra) === "contraturno" ? "Contraturno" : "Painel") + "</b> (" + money(outra.valorAberto) + " em aberto, " + st(outra.status).l.toLowerCase() +
        "). Os atendimentos aparecem nas duas abas; o status e o valor em aberto são de cada aba.</div>" : "");
    $("btnArquivarAluno").textContent = a.arquivado ? "Reativar aluno" : "Arquivar aluno";
    $("dInfoView").hidden = false; $("dInfoEdit").hidden = true; $("btnEditarDados").hidden = false;
    $("eNome").value = a.nome || ""; $("eRa").value = a.ra || ""; $("eTurma").value = a.turma || "";
    $("eResp").value = a.responsavel || ""; $("eTel").value = a.telefone || ""; $("eEmail").value = a.email || "";
    $("eValor").value = a.valorAberto || 0; $("eVenc").value = a.vencimento || ""; $("eSetor").value = a.setor || "";
    limparFormAtendimento(a);
    renderTimeline();
    abrir("mDetalhe");
  }

  function limparFormAtendimento(a) {
    $("formAt").reset();
    $("aData").value = hoje();
    $("aAtend").value = eu ? eu.nome : "";
    if (a && a.setor) $("aSetor").value = a.setor;
    if (a) $("aStatus").value = a.status || "sem_contato";
    $("aMotivoOutroWrap").hidden = true;
    var anoSel = $("aMensAno");
    if (!anoSel.options.length) {
      var y = new Date().getFullYear();
      fill(anoSel, [String(y - 1), String(y), String(y + 1)]);
    }
    anoSel.value = String(new Date().getFullYear());
    renderMensGrid();
  }

  function renderTimeline() {
    var atual = alunos[curId], ids = {};
    ids[curId] = 1;
    if (atual) vinculadosDe(atual).forEach(function (b) { ids[b.id] = 1; });
    var itens = atends.filter(function (t) { return ids[t.alunoId]; });
    var el = $("dTl");
    if (!itens.length) { el.innerHTML = '<div class="muted">Nenhum atendimento registrado ainda.</div>'; return; }
    el.innerHTML = itens.map(function (t) {
      var podeExcluir = eu && (eu.perfil === "admin" || t.usuarioId === eu.id);
      var mens = t.mensalidadesNegociadas || [];
      var origem = t.alunoId !== curId && alunos[t.alunoId] ? ' <span class="tag origem">registrado no ' + (carteiraDe(alunos[t.alunoId]) === "contraturno" ? "Contraturno" : "Painel") + "</span>" : "";
      return '<div class="tl-it"><div class="tl-top"><span><b>' + br(t.data) + '</b> <span class="who2">' + esc(t.responsavel || "—") + "</span>" + origem + "</span>" +
        (podeExcluir ? '<button type="button" class="tl-del" data-del="' + esc(t.id) + '">Excluir</button>' : "") + "</div>" +
        '<div class="tags"><span class="tag">' + esc(t.canal || "—") + "</span>" + (t.setor ? '<span class="tag">' + esc(t.setor) + "</span>" : "") + pill(t.statusResultante || "sem_contato", true) + "</div>" +
        "<div><b>" + esc(t.motivo || "") + "</b>" + (t.observacao ? " — " + esc(t.observacao) : "") + "</div>" +
        (t.proximoRetorno ? '<div class="tl-extra">Próximo retorno: ' + br(t.proximoRetorno) + "</div>" : "") +
        (t.valorRecuperado ? '<div class="tl-extra rec">Valor recuperado: ' + money(t.valorRecuperado) + "</div>" : "") +
        (mens.length ? '<div class="tl-extra">Mensalidades negociadas: ' + mens.map(function (m) {
          var mm = parseInt(m.mes.slice(5, 7), 10); return cap(MESES[mm - 1]).slice(0, 3) + "/" + m.mes.slice(0, 4) + " (" + money(m.valor) + ")";
        }).join(", ") + " · total " + money(t.valorNegociadoTotal || 0) + "</div>" : "") +
        "</div>";
    }).join("");
  }
  $("dTl").addEventListener("click", function (e) {
    var b = e.target.closest(".tl-del"); if (!b) return;
    if (!b.classList.contains("armed")) {
      document.querySelectorAll(".tl-del.armed").forEach(function (x) { x.classList.remove("armed"); x.textContent = "Excluir"; });
      b.classList.add("armed"); b.textContent = "Confirmar exclusão?"; return;
    }
    var id = b.getAttribute("data-del"); b.disabled = true;
    api("DELETE", "/api/atendimentos/" + encodeURIComponent(id)).then(function () {
      atends = atends.filter(function (t) { return t.id !== id; });
      renderTimeline(); renderTudo(); toast("Atendimento excluído.");
    }).catch(function (x) { b.disabled = false; toast(x.message); });
  });

  $("aMotivo").addEventListener("change", function () { $("aMotivoOutroWrap").hidden = this.value !== "Outro"; });

  // mensalidades negociadas
  function renderMensGrid() {
    var ano = $("aMensAno").value;
    $("aMensGrid").innerHTML = MESES.map(function (nome, i) {
      var k = ano + "-" + pad2(i + 1);
      return '<div class="mens-item"><label><input type="checkbox" class="mens-chk" data-mes="' + k + '"> ' + cap(nome) + "</label>" +
        '<input type="number" step="0.01" min="0" class="mens-val" data-mes="' + k + '" placeholder="0,00" aria-label="Valor de ' + nome + '" hidden></div>';
    }).join("");
    atualizarMensTotal();
  }
  function coletarMensalidades() {
    var out = [];
    document.querySelectorAll(".mens-chk:checked").forEach(function (c) {
      var mes = c.getAttribute("data-mes"), inp = document.querySelector('.mens-val[data-mes="' + mes + '"]');
      out.push({ mes: mes, valor: parseFloat(inp.value) || 0 });
    });
    return out;
  }
  function atualizarMensTotal() { $("aMensTotal").textContent = money(coletarMensalidades().reduce(function (s, m) { return s + m.valor; }, 0)); }
  $("aMensAno").addEventListener("change", renderMensGrid);
  $("aMensGrid").addEventListener("change", function (e) {
    if (e.target.classList.contains("mens-chk")) {
      var inp = document.querySelector('.mens-val[data-mes="' + e.target.getAttribute("data-mes") + '"]');
      inp.hidden = !e.target.checked; if (!e.target.checked) inp.value = ""; else inp.focus();
    }
    atualizarMensTotal();
  });
  $("aMensGrid").addEventListener("input", function (e) { if (e.target.classList.contains("mens-val")) atualizarMensTotal(); });

  $("formAt").addEventListener("submit", function (e) {
    e.preventDefault();
    var motivo = $("aMotivo").value === "Outro" ? ($("aMotivoOutro").value.trim() || "Outro") : $("aMotivo").value;
    var btn = $("btnSalvarAt"); btn.disabled = true;
    api("POST", "/api/atendimentos", {
      alunoId: curId, data: $("aData").value || hoje(), canal: $("aCanal").value, setor: $("aSetor").value,
      motivo: motivo, observacao: $("aObs").value.trim(), statusResultante: $("aStatus").value,
      proximoRetorno: $("aProx").value || null, valorNovo: $("aValorNovo").value === "" ? null : $("aValorNovo").value,
      mensalidadesNegociadas: coletarMensalidades()
    }).then(function (d) {
      atends.unshift(d.atendimento); alunos[d.aluno.id] = d.aluno;
      (d.vinculados || []).forEach(function (v) { alunos[v.id] = v; });
      var nasDuas = (d.vinculados || []).some(function (v) { return carteiraDe(v) !== carteiraDe(d.aluno); });
      toast("Atendimento registrado em nome de " + primeiroNome(eu.nome) + (nasDuas ? " — aparece no Painel e no Contraturno." : "."));
      abrirAluno(d.aluno.id); renderTudo();
    }).catch(function (x) { toast("Não foi possível salvar: " + x.message); })
      .then(function () { btn.disabled = false; });
  });

  $("btnArquivarAluno").addEventListener("click", function () {
    var a = alunos[curId]; if (!a) return;
    api("PATCH", "/api/alunos/" + encodeURIComponent(curId), { arquivado: !a.arquivado }).then(function (d) {
      alunos[d.aluno.id] = d.aluno; fecharModais(); renderTudo();
      toast(d.aluno.arquivado ? "Aluno arquivado." : "Aluno reativado.");
    }).catch(function (x) { toast(x.message); });
  });
  $("btnEditarDados").addEventListener("click", function () { $("dInfoView").hidden = true; $("dInfoEdit").hidden = false; this.hidden = true; $("eNome").focus(); });
  $("btnCancelarEdit").addEventListener("click", function () { $("dInfoView").hidden = false; $("dInfoEdit").hidden = true; $("btnEditarDados").hidden = false; });
  $("btnSalvarEdit").addEventListener("click", function () {
    if (!$("eNome").value.trim()) { toast("O nome do aluno não pode ficar em branco."); return; }
    api("PATCH", "/api/alunos/" + encodeURIComponent(curId), {
      nome: $("eNome").value.trim(), ra: $("eRa").value.trim(), turma: $("eTurma").value.trim(), responsavel: $("eResp").value.trim(),
      telefone: $("eTel").value.trim(), email: $("eEmail").value.trim(), valorAberto: parseFloat($("eValor").value) || 0,
      vencimento: $("eVenc").value || "", setor: $("eSetor").value
    }).then(function (d) { alunos[d.aluno.id] = d.aluno; toast("Dados do aluno atualizados."); abrirAluno(d.aluno.id); renderTudo(); })
      .catch(function (x) { toast(x.message); });
  });

  // novo aluno
  $("btnNovo").addEventListener("click", function () { $("formNovo").reset(); abrir("mNovo"); setTimeout(function () { $("nNome").focus(); }, 30); });
  $("formNovo").addEventListener("submit", function (e) {
    e.preventDefault();
    api("POST", "/api/alunos", {
      nome: $("nNome").value.trim(), ra: $("nRa").value.trim(), turma: $("nTurma").value.trim(), responsavel: $("nResp").value.trim(),
      telefone: $("nTel").value.trim(), email: $("nEmail").value.trim(), valorAberto: parseFloat($("nValor").value) || 0,
      vencimento: $("nVenc").value || "", setor: $("nSetor").value, carteira: carteira
    }).then(function (d) { alunos[d.aluno.id] = d.aluno; fecharModais(); renderTudo(); toast(carteira === "contraturno" ? "Aluno cadastrado no Contraturno." : "Aluno cadastrado."); })
      .catch(function (x) { toast(x.message); });
  });

  // ---------------------------------------------------------------- modelo, exportação e importação de planilha
  $("btnModelo").addEventListener("click", function () {
    baixar("modelo_importacao_cobranca.csv",
      "RA;Nome do Aluno;Turma;Responsável Financeiro;Telefone;E-mail;Valor em Aberto;Vencimento\n" +
      "12345;MARIA EXEMPLO DA SILVA;3º ANO A EM;JOÃO DA SILVA;(11) 90000-0000;financeiro@exemplo.com;1234,56;10/08/2026\n");
    toast("Modelo baixado.");
  });
  $("btnExportar").addEventListener("click", function () {
    var cab = "Nome;RA;Turma;Responsavel;Telefone;Email;ValorAberto;Parcelas;Vencimento;Status;Setor;UltimoContatoData;UltimoContatoCanal;ProximoRetorno;Atendente;Arquivado\n";
    var linhas = listaCarteira(carteira).map(function (a) {
      var uc = a.ultimoContato || {};
      return [a.nome, a.ra, a.turma, a.responsavel, a.telefone, a.email, (Number(a.valorAberto) || 0).toFixed(2).replace(".", ","), a.parcelasAberto || "",
        a.vencimento ? br(a.vencimento) : "", st(a.status).l, a.setor || "", uc.data ? br(uc.data) : "", uc.canal || "", a.proximoRetorno ? br(a.proximoRetorno) : "",
        a.atendenteResponsavel || "", a.arquivado ? "sim" : "nao"]
        .map(function (v) { v = String(v == null ? "" : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(";");
    }).join("\n");
    baixar(CARTEIRA_INFO[carteira].arquivo + hoje() + ".csv", cab + linhas);
    toast("Relatório exportado.");
  });

  var pendentes = [];
  function normHeader(h) { return String(h || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim(); }
  var HEADER_TOKENS = ["ra", "codigo", "matricula", "nome", "nome do aluno", "nome completo", "aluno", "turma", "responsavel", "responsavel financeiro", "responsavel(a)", "telefone", "tel", "celular", "e-mail", "email", "valor", "valor em aberto", "valor devido", "total devido", "vencimento", "data de vencimento", "dt vencimento", "venc", "valor (r$)", "mentor", "serasa", "cpf", "tipo", "data inclusao", "resp. inclusao", "realizado"];
  // Lê o CSV caractere a caractere: uma quebra de linha só termina a linha fora de aspas
  // (o Excel exporta células com várias linhas entre aspas).
  function tokenizeCSV(text, delim) {
    var rows = [], row = [], field = "", inQ = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
      } else if (c === '"') inQ = true;
      else if (c === delim) { row.push(field); field = ""; }
      else if (c === "\r") { /* ignora */ }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.map(function (r) { return r.map(function (s) { return s.trim(); }); }).filter(function (r) { return r.some(function (c) { return c.length > 0; }); });
  }
  function scoreHeader(cells) {
    var s = 0;
    cells.map(normHeader).forEach(function (c) {
      if (!c) return;
      if (HEADER_TOKENS.indexOf(c) !== -1) s++;
      else if (HEADER_TOKENS.some(function (t) { return c.indexOf(t) !== -1 || t.indexOf(c) !== -1; })) s += 0.5;
    });
    return s;
  }
  // Algumas planilhas têm uma linha de título acima do cabeçalho: testamos as primeiras
  // linhas com ; e , e usamos a que mais parece cabeçalho.
  function parseCSV(text) {
    text = text.replace(/^﻿/, "");
    var best = { line: 0, score: -1, cells: [], rows: [] };
    [";", ","].forEach(function (d) {
      var all = tokenizeCSV(text, d);
      for (var i = 0; i < Math.min(all.length, 8); i++) {
        var cells = all[i]; if (cells.length < 2) continue;
        var sc = scoreHeader(cells);
        if (sc > best.score || (sc === best.score && cells.length > best.cells.length)) best = { line: i, score: sc, cells: cells, rows: all };
      }
    });
    return { headers: best.cells.map(normHeader), raw: best.cells, rows: best.rows.slice(best.line + 1) };
  }
  function colIndex(h, names) {
    for (var n = 0; n < names.length; n++) { var i = h.indexOf(names[n]); if (i !== -1) return i; }
    for (var j = 0; j < h.length; j++) for (var m = 0; m < names.length; m++) if (h[j] && h[j].indexOf(names[m]) !== -1) return j;
    return -1;
  }
  function parseMoneyBR(s) {
    if (s == null || s === "") return 0;
    s = String(s).replace(/[^\d,.-]/g, "");
    if (s.indexOf(",") !== -1 && s.indexOf(".") !== -1) s = s.replace(/\./g, "").replace(",", ".");
    else if (s.indexOf(",") !== -1) s = s.replace(",", ".");
    var n = parseFloat(s); return isNaN(n) ? 0 : n;
  }
  function parseDateBR(s) {
    if (!s) return ""; s = String(s).trim();
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + "-" + m[2] + "-" + m[3];
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) { var d = +m[1], mo = +m[2], y = +m[3]; if (y < 100) y += 2000; if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) return y + "-" + pad2(mo) + "-" + pad2(d); }
    return "";
  }
  // Relatórios do sistema trazem uma linha por parcela: agrupamos por RA (ou nome),
  // somando o valor e guardando o vencimento mais antigo.
  function agrupar(rows) {
    var map = {}, ordem = [];
    rows.forEach(function (r) {
      var k = r.ra && r.ra.trim() ? "ra:" + r.ra.trim().toLowerCase() : "nm:" + r.nome.trim().toLowerCase();
      if (!map[k]) { map[k] = { ra: r.ra || "", nome: r.nome, turma: r.turma || "", responsavel: r.responsavel || "", telefone: r.telefone || "", email: r.email || "", valorAberto: 0, parcelas: 0, vencimento: "" }; ordem.push(k); }
      var g = map[k];
      g.valorAberto += r.valorAberto || 0; g.parcelas++;
      ["ra", "turma", "responsavel", "telefone", "email"].forEach(function (c) { if (!g[c] && r[c]) g[c] = r[c]; });
      if (r.vencimento && (!g.vencimento || r.vencimento < g.vencimento)) g.vencimento = r.vencimento;
    });
    return ordem.map(function (k) { map[k].valorAberto = Math.round(map[k].valorAberto * 100) / 100; return map[k]; });
  }
  // A mesma janela de importação atende Painel/Contraturno (alunos) e Serasa (parcelas).
  var modoImport = "alunos";
  function processarCSV(text) {
    var p = parseCSV(text), h = p.headers;
    if (modoImport === "serasa") return processarCSVSerasa(p);
    var ix = {
      ra: colIndex(h, ["ra", "codigo", "matricula"]), nome: colIndex(h, ["nome", "nome do aluno", "nome completo", "aluno"]),
      turma: colIndex(h, ["turma"]), resp: colIndex(h, ["responsavel financeiro", "responsavel", "responsavel(a)"]),
      tel: colIndex(h, ["telefone", "tel", "celular"]), email: colIndex(h, ["e-mail", "email"]),
      valor: colIndex(h, ["valor em aberto", "valor devido", "total devido", "devido", "valor"]),
      venc: colIndex(h, ["vencimento", "data de vencimento", "dt vencimento", "venc"])
    };
    var out = $("importResult");
    if (ix.nome === -1) {
      var cols = (p.raw || []).filter(Boolean).join(", ");
      out.innerHTML = '<div class="import-summary" style="color:var(--danger)">Não encontrei uma coluna de nome do aluno neste arquivo.' +
        (cols ? " Colunas identificadas: " + esc(cols) + "." : " O arquivo parece vazio.") + ' Confira o modelo em "Baixar modelo".</div>';
      $("btnConfirmImport").disabled = true; return;
    }
    var brutos = p.rows.filter(function (r) {
      var n = (r[ix.nome] || "").trim();
      if (!n || n === "#N/A" || n.length > 80) return false;
      if (ix.ra !== -1 && (r[ix.ra] || "").indexOf(",") !== -1) return false;
      return true;
    }).map(function (r) {
      return {
        ra: ix.ra !== -1 ? r[ix.ra] : "", nome: r[ix.nome], turma: ix.turma !== -1 ? r[ix.turma] : "", responsavel: ix.resp !== -1 ? r[ix.resp] : "",
        telefone: ix.tel !== -1 ? r[ix.tel] : "", email: ix.email !== -1 ? r[ix.email] : "",
        valorAberto: ix.valor !== -1 ? parseMoneyBR(r[ix.valor]) : 0, vencimento: ix.venc !== -1 ? parseDateBR(r[ix.venc]) : ""
      };
    });
    pendentes = agrupar(brutos);
    var temVenc = pendentes.some(function (r) { return r.vencimento; });
    out.innerHTML = '<div class="import-preview"><table><thead><tr><th>Aluno</th><th>Turma</th><th>Responsável</th><th>Valor</th><th>Parcelas</th>' + (temVenc ? "<th>Vencimento</th>" : "") + "</tr></thead><tbody>" +
      pendentes.slice(0, 8).map(function (r) {
        return "<tr><td>" + esc(r.nome) + "</td><td>" + esc(r.turma) + "</td><td>" + esc(r.responsavel) + '</td><td class="tabular">' + money(r.valorAberto) + '</td><td class="tabular">' + r.parcelas + "</td>" + (temVenc ? "<td>" + br(r.vencimento) + "</td>" : "") + "</tr>";
      }).join("") + "</tbody></table></div>" +
      '<div class="import-summary">' + pendentes.length + " aluno(s) únicos encontrados" + (pendentes.length > 8 ? " (mostrando os 8 primeiros)" : "") +
      (brutos.length !== pendentes.length ? " — " + brutos.length + " linhas foram agrupadas por aluno (parcelas somadas)." : ".") +
      " Quem já existir " + (carteira === "contraturno" ? "no Contraturno" : "no Painel") + " (mesmo RA ou nome) será atualizado, não duplicado." +
      (temVenc ? "" : " Não encontrei coluna de vencimento — a análise por faixa de atraso só vale para alunos com essa data.") + "</div>";
    $("btnConfirmImport").disabled = !pendentes.length;
  }
  function abrirImportacao(modo) {
    modoImport = modo;
    pendentes = []; $("importResult").innerHTML = ""; $("pasteArea").value = ""; $("fileInput").value = "";
    var b = $("btnConfirmImport");
    b.disabled = true; b.hidden = false; b.textContent = modo === "serasa" ? "Importar parcelas" : "Importar alunos";
    $("mImpT").textContent = modo === "serasa" ? "Importar planilha — Serasa" : carteira === "contraturno" ? "Importar planilha — Contraturno" : "Importar planilha";
    $("mImpSub").textContent = modo === "serasa"
      ? "Envie o CSV do relatório de negativação (RA, Nome, Vencimento, Valor, Mentor, Serasa, Data inclusão). Também aceita Responsável financeiro, CPF, Tipo e Resp. inclusão."
      : "Envie um CSV exportado do relatório " + (carteira === "contraturno" ? "do contraturno" : "de cobrança") + " (RA, Nome, Turma, Responsável, Telefone, E-mail, Valor em aberto, Vencimento)";
    abrir("mImportar");
  }
  $("btnImportar").addEventListener("click", function () { abrirImportacao("alunos"); });
  function lerArquivo(f, cb) { var r = new FileReader(); r.onload = function () { cb(String(r.result)); }; r.readAsText(f, "utf-8"); }
  function ligarDropzone(dz, input, cb) {
    dz.addEventListener("click", function (e) { if (e.target !== input) input.click(); });
    dz.addEventListener("dragover", function (e) { e.preventDefault(); dz.classList.add("drag"); });
    dz.addEventListener("dragleave", function () { dz.classList.remove("drag"); });
    dz.addEventListener("drop", function (e) { e.preventDefault(); dz.classList.remove("drag"); var f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) lerArquivo(f, cb); });
    input.addEventListener("change", function () { if (input.files && input.files[0]) lerArquivo(input.files[0], cb); });
  }
  ligarDropzone($("dropzone"), $("fileInput"), processarCSV);
  $("btnProcessPaste").addEventListener("click", function () { var t = $("pasteArea").value; if (!t.trim()) return toast("Cole o conteúdo do CSV antes de processar."); processarCSV(t); });

  $("btnConfirmImport").addEventListener("click", function () {
    if (!pendentes.length) return;
    var btn = this; btn.disabled = true; btn.textContent = "Importando…";
    if (modoImport === "serasa") {
      return api("POST", "/api/serasa/importar", { linhas: pendentes }).then(function (d) {
        btn.hidden = true;
        $("importResult").innerHTML = '<div class="import-summary" style="color:var(--ink)"><b>' + d.criados + "</b> parcela(s) nova(s) · <b>" + d.atualizados +
          "</b> atualizada(s) · " + d.ignorados + " sem mudança ou incompletas (sem nome ou vencimento).</div>";
        toast("Planilha da Serasa importada.");
        return carregar();
      }).catch(function (x) { btn.disabled = false; btn.textContent = "Importar parcelas"; toast(x.message); });
    }
    api("POST", "/api/alunos/importar", { linhas: pendentes, carteira: carteira }).then(function (d) {
      btn.hidden = true;
      mostrarConciliacao(d);
      return carregar();
    }).catch(function (x) { btn.disabled = false; btn.textContent = "Importar alunos"; toast(x.message); });
  });
  function mostrarConciliacao(d) {
    var html = '<div class="import-summary" style="color:var(--ink)"><b>' + d.criados + "</b> aluno(s) novo(s) cadastrado(s) · <b>" + d.atualizados + "</b> já existiam e foram atualizados.</div>";
    var fora = d.foraDaPlanilha || [];
    if (fora.length) {
      html += '<div class="sec" style="border:none;padding-top:10px">Não apareceram neste relatório (' + fora.length + ")</div>" +
        '<div class="import-summary" style="margin-bottom:8px">Estavam ativos no painel mas não vieram na planilha — normalmente quitaram. Marque quem já resolveu:</div>' +
        '<div class="import-preview"><table><thead><tr><th><label class="check-line"><input type="checkbox" id="concTodos"> Selecionar todos</label></th><th>Valor em aberto</th></tr></thead><tbody>' +
        fora.map(function (a) { return '<tr><td><label class="check-line"><input type="checkbox" class="conc-chk" data-id="' + esc(a.id) + '"> ' + esc(a.nome) + '</label></td><td class="tabular">' + money(a.valorAberto) + "</td></tr>"; }).join("") +
        '</tbody></table></div><div class="m-foot" style="justify-content:flex-start"><button type="button" class="btn ghost small" id="btnRegularizar">Marcar selecionados como regularizados</button></div>';
    }
    $("importResult").innerHTML = html;
    var todos = $("concTodos");
    if (todos) todos.addEventListener("change", function () { document.querySelectorAll(".conc-chk").forEach(function (c) { c.checked = todos.checked; }); });
    var br2 = $("btnRegularizar");
    if (br2) br2.addEventListener("click", function () {
      var ids = [].map.call(document.querySelectorAll(".conc-chk:checked"), function (c) { return c.getAttribute("data-id"); });
      if (!ids.length) return toast("Selecione ao menos um aluno.");
      br2.disabled = true; br2.textContent = "Marcando…";
      api("POST", "/api/alunos/regularizar", { ids: ids }).then(function (r) {
        toast(r.regularizados + " aluno(s) marcados como regularizados e somados ao valor recuperado.");
        br2.closest(".m-foot").remove();
        document.querySelectorAll(".conc-chk:checked").forEach(function (c) { c.closest("tr").remove(); });
        return carregar();
      }).catch(function (x) { br2.disabled = false; br2.textContent = "Marcar selecionados como regularizados"; toast(x.message); });
    });
  }

  // ---------------------------------------------------------------- evolução
  function barras(el, rows, total, fmt) {
    total = total || 1;
    $(el).innerHTML = rows.map(function (r) {
      return '<div class="bar"><span class="l" title="' + esc(r.l) + '">' + esc(r.l) + '</span><span class="t"><span class="f" style="width:' + Math.round(r.v / total * 100) + "%" + (r.c ? ";background:var(--" + r.c + ")" : "") + '"></span></span><span class="n">' + (fmt ? fmt(r.v) : r.v) + "</span></div>";
    }).join("");
  }
  function anosDisponiveis(extra) {
    var set = {}; set[String(new Date().getFullYear())] = 1;
    atends.forEach(function (a) { if (a.data) set[a.data.slice(0, 4)] = 1; if (extra) (a.mensalidadesNegociadas || []).forEach(function (m) { set[m.mes.slice(0, 4)] = 1; }); });
    return Object.keys(set).sort().reverse();
  }
  function prepararSelect(sel, opcoes, padrao) {
    var prev = sel.value, html = opcoes.map(function (o) { return '<option value="' + o.v + '">' + o.l + "</option>"; }).join("");
    if (sel.getAttribute("data-html") !== html) { sel.innerHTML = html; sel.setAttribute("data-html", html); }
    var vals = opcoes.map(function (o) { return o.v; });
    sel.value = prev && vals.indexOf(prev) !== -1 ? prev : padrao;
    return sel.value;
  }

  function renderEvolucao() {
    var dias = [];
    for (var i = 13; i >= 0; i--) { var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i); dias.push(isoLocal(d)); }
    var porDia = {}; dias.forEach(function (x) { porDia[x] = 0; });
    atends.forEach(function (a) { if (porDia[a.data] !== undefined) porDia[a.data]++; });
    var mx = Math.max.apply(null, dias.map(function (x) { return porDia[x]; })) || 1, h = hoje();
    $("days").innerHTML = dias.map(function (x) {
      var v = porDia[x];
      return '<div class="day' + (x === h ? " is-today" : "") + '" title="' + br(x) + ": " + v + ' atendimento(s)"><span class="v">' + (v || "") + '</span><div class="b' + (v ? " has" : "") + '" style="height:' + Math.max(3, Math.round(v / mx * 112)) + 'px"></div></div>';
    }).join("");
    $("dayLbls").innerHTML = dias.map(function (x) { return "<span>" + Number(x.slice(8)) + "</span>"; }).join("");

    $("feed").innerHTML = atends.length ? atends.slice(0, 12).map(function (a) {
      return '<div class="feed-it"><span class="w">' + br(a.data) + "</span><b>" + esc(a.alunoNome || "—") + "</b> · " + esc(a.canal || "") +
        '<div class="o">' + (a.responsavel ? esc(a.responsavel) + ": " : "") + esc((a.observacao || a.motivo || "").slice(0, 120)) + "</div></div>";
    }).join("") : '<div class="muted">Nenhum atendimento registrado ainda.</div>';

    var cc = {}; atends.forEach(function (a) { cc[a.canal || "—"] = (cc[a.canal || "—"] || 0) + 1; });
    barras("barCanal", CANAIS.map(function (c) { return { l: c, v: cc[c] || 0 }; }), Math.max.apply(null, CANAIS.map(function (c) { return cc[c] || 0; })));
    var vis = listaCarteira("regular").filter(function (a) { return !a.arquivado; }), sc = {};
    vis.forEach(function (a) { var k = a.status || "sem_contato"; sc[k] = (sc[k] || 0) + 1; });
    barras("barStatus", STATUS.map(function (s) { return { l: s.l, v: sc[s.k] || 0, c: s.c }; }), vis.length);

    renderRecuperadoAnual();
    renderMensalidadesEvol();
    renderControleDiario();
  }

  function renderRecuperadoAnual() {
    var ano = prepararSelect($("anoEvolSel"), anosDisponiveis().map(function (y) { return { v: y, l: y }; }), String(new Date().getFullYear()));
    var rec = {}, tot = 0;
    atends.forEach(function (a) { if (a.data && a.data.slice(0, 4) === ano) { var m = a.data.slice(5, 7); rec[m] = (rec[m] || 0) + (Number(a.valorRecuperado) || 0); } });
    var rows = MESES.map(function (n, i) { var v = rec[pad2(i + 1)] || 0; tot += v; return "<tr><td>" + cap(n) + '</td><td class="tabular' + (v ? " rec" : "") + '">' + (v ? money(v) : "—") + "</td></tr>"; });
    $("anoEvolTable").innerHTML = "<thead><tr><th>Mês</th><th>Valor recuperado</th></tr></thead><tbody>" + rows.join("") + '</tbody><tfoot><tr><td>Total do ano</td><td class="tabular">' + (tot ? money(tot) : "—") + "</td></tr></tfoot>";
  }
  // As mensalidades negociadas contam no mês da MENSALIDADE (ex.: janeiro), não no mês
  // em que o atendimento aconteceu.
  function renderMensalidadesEvol() {
    var ano = prepararSelect($("mensEvolAnoSel"), anosDisponiveis(true).map(function (y) { return { v: y, l: y }; }), String(new Date().getFullYear()));
    var por = {}, tot = 0;
    atends.forEach(function (a) { (a.mensalidadesNegociadas || []).forEach(function (m) { if (m.mes && m.mes.slice(0, 4) === ano) { var k = m.mes.slice(5, 7); por[k] = (por[k] || 0) + (Number(m.valor) || 0); tot += Number(m.valor) || 0; } }); });
    var rows = MESES.map(function (n, i) { var v = por[pad2(i + 1)] || 0; return "<tr><td>" + cap(n) + '</td><td class="tabular' + (v ? " rec" : "") + '">' + (v ? money(v) : "—") + "</td></tr>"; });
    $("mensEvolTable").innerHTML = "<thead><tr><th>Mensalidade</th><th>Valor negociado</th></tr></thead><tbody>" + rows.join("") + '</tbody><tfoot><tr><td>Total do ano</td><td class="tabular">' + (tot ? money(tot) : "—") + "</td></tr></tfoot>";
  }

  function renderControleDiario() {
    var set = {}; set[mesAtual()] = 1; atends.forEach(function (a) { if (a.data) set[a.data.slice(0, 7)] = 1; });
    var meses = Object.keys(set).sort().reverse();
    var mesSel = prepararSelect($("ctrlMesSel"), meses.map(function (m) { return { v: m, l: cap(MESES[parseInt(m.slice(5, 7), 10) - 1]) + "/" + m.slice(0, 4) }; }), mesAtual());
    var ano = parseInt(mesSel.slice(0, 4), 10), mesN = parseInt(mesSel.slice(5, 7), 10);
    var doMes = atends.filter(function (a) { return a.data && a.data.slice(0, 7) === mesSel; });
    var tb = $("ctrlTable");
    if (!doMes.length) { tb.innerHTML = '<tbody><tr><td class="empty-ctrl">Nenhum atendimento registrado neste mês ainda.</td></tr></tbody>'; renderFaixa(doMes); return; }

    var porAt = {}; doMes.forEach(function (a) { var k = a.responsavel || "—"; porAt[k] = (porAt[k] || 0) + 1; });
    var ats = Object.keys(porAt).sort(function (a, b) { return porAt[b] - porAt[a]; });
    var diasNoMes = new Date(ano, mesN, 0).getDate();
    var ate = mesSel === mesAtual() ? new Date().getDate() : diasNoMes;
    var dados = {};
    for (var d = 1; d <= diasNoMes; d++) {
      var iso = mesSel + "-" + pad2(d); dados[iso] = {};
      ats.forEach(function (at) { var b = { total: 0, rec: 0 }; CANAIS.forEach(function (c) { b[c] = 0; }); dados[iso][at] = b; });
    }
    doMes.forEach(function (a) { var b = dados[a.data] && dados[a.data][a.responsavel || "—"]; if (!b) return; if (b[a.canal] !== undefined) b[a.canal]++; b.total++; b.rec += Number(a.valorRecuperado) || 0; });

    var n = CANAIS.length + 2;
    var th1 = '<tr><th class="date-cell" rowspan="2">Data</th>' + ats.map(function (at, i) { var p = GRP_PALETTE[i % GRP_PALETTE.length]; return '<th colspan="' + n + '" style="background:var(--' + p + "-soft);color:var(--" + p + ')">' + esc(at) + "</th>"; }).join("") + '<th colspan="2" style="background:var(--gray-soft)">Totais do dia</th></tr>';
    var th2 = "<tr>" + ats.map(function () { return CANAIS.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("") + "<th>Total</th><th>Vlr. recuperado</th>"; }).join("") + "<th>Contatos</th><th>Recuperado</th></tr>";
    var tAt = {}; ats.forEach(function (at) { tAt[at] = { total: 0, rec: 0 }; CANAIS.forEach(function (c) { tAt[at][c] = 0; }); });
    var tg = 0, tgr = 0, body = [], h = hoje();
    for (var d2 = 1; d2 <= ate; d2++) {
      var iso2 = mesSel + "-" + pad2(d2), dObj = new Date(iso2 + "T00:00:00");
      var cells = '<td class="date-cell">' + br(iso2) + " (" + DIAS_SEMANA[dObj.getDay()] + ")" + (iso2 === h ? " · hoje" : "") + "</td>", td = 0, tr = 0;
      ats.forEach(function (at) {
        var b = dados[iso2][at];
        CANAIS.forEach(function (c) { cells += "<td>" + (b[c] || 0) + "</td>"; tAt[at][c] += b[c] || 0; });
        cells += "<td><strong>" + b.total + "</strong></td><td" + (b.rec ? ' class="rec"' : "") + ">" + (b.rec ? money(b.rec) : "—") + "</td>";
        td += b.total; tr += b.rec; tAt[at].total += b.total; tAt[at].rec += b.rec;
      });
      cells += "<td><strong>" + td + "</strong></td><td" + (tr ? ' class="rec"' : "") + "><strong>" + (tr ? money(tr) : "—") + "</strong></td>";
      tg += td; tgr += tr; body.push("<tr>" + cells + "</tr>");
    }
    var foot = '<td class="date-cell">Total do mês</td>' + ats.map(function (at) { var t = tAt[at]; return CANAIS.map(function (c) { return "<td>" + t[c] + "</td>"; }).join("") + "<td>" + t.total + "</td><td>" + (t.rec ? money(t.rec) : "—") + "</td>"; }).join("") + "<td>" + tg + "</td><td>" + (tgr ? money(tgr) : "—") + "</td>";
    tb.innerHTML = "<thead>" + th1 + th2 + "</thead><tbody>" + body.join("") + "</tbody><tfoot><tr>" + foot + "</tr></tfoot>";
    renderFaixa(doMes);
  }

  var FAIXAS = [{ k: "30", l: "Até 30 dias", c: "info" }, { k: "60", l: "31–60 dias", c: "warn" }, { k: "90", l: "61–90 dias", c: "gold" }, { k: "90+", l: "Mais de 90 dias", c: "danger" }];
  function renderFaixa(doMes) {
    var por = { "30": 0, "60": 0, "90": 0, "90+": 0, em_dia: 0 }, semVenc = 0;
    function somar(f, v) { if (!v) return; if (por[f] !== undefined) por[f] += v; else semVenc += v; }
    doMes.forEach(function (a) {
      var mens = a.mensalidadesNegociadas || [];
      if (mens.length) {
        // cada mensalidade tem seu próprio mês de referência (vence no dia 5)
        mens.forEach(function (m) { somar(faixaAtrasoDe(m.mes + "-" + pad2(DIA_VENCIMENTO_MENSALIDADE), a.data), Number(m.valor) || 0); });
        somar(a.faixaAtraso, Number(a.valorRecuperadoAberto) || 0);
      } else somar(a.faixaAtraso, Number(a.valorRecuperado) || 0);
    });
    var total = por["30"] + por["60"] + por["90"] + por["90+"] + por.em_dia + semVenc;
    if (total <= 0) { $("faixaVencList").innerHTML = '<div class="muted">Nenhum valor recuperado neste mês ainda (ou os alunos recuperados não têm vencimento cadastrado).</div>'; return; }
    var rows = FAIXAS.map(function (f) { return { l: f.l, v: por[f.k], c: f.c }; });
    if (por.em_dia) rows.push({ l: "Em dia (ainda não vencida)", v: por.em_dia, c: "success" });
    if (semVenc) rows.push({ l: "Sem vencimento cadastrado", v: semVenc, c: "gray" });
    barras("faixaVencList", rows, total, money);
  }
  ["anoEvolSel", "mensEvolAnoSel", "ctrlMesSel"].forEach(function (id) { $(id).addEventListener("change", renderEvolucao); });

  // ---------------------------------------------------------------- Serasa
  // Situação da parcela no Mentor e no Serasa. "" = ainda não incluída (pendente).
  var SER_ST = [
    { v: "", l: "Pendente", c: "gray" },
    { v: "ok", l: "OK", c: "success" },
    { v: "pago", l: "Pago", c: "info" },
    { v: "negociado", l: "Negociado", c: "brand" },
    { v: "juridico", l: "Jurídico", c: "danger" },
    { v: "bloqueio", l: "Bloqueio", c: "warn" },
    { v: "nao_negativar", l: "Não negativar", c: "gold" }
  ];
  function serSt(v) { for (var i = 0; i < SER_ST.length; i++) if (SER_ST[i].v === (v || "")) return SER_ST[i]; return SER_ST[0]; }
  function serPill(v) { var s = serSt(v); return '<span class="pill" style="color:var(--' + s.c + ');background:var(--' + s.c + '-soft)"><i></i>' + s.l + "</span>"; }
  // Converte o texto da planilha (OK, PAGO, J, BLOQ, uma data…) para a situação.
  function serNormalizar(txt) {
    var t = String(txt || "").trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (!t) return "";
    if (t === "OK" || t === "INCLUIDO") return "ok";
    if (t.indexOf("PAG") === 0) return "pago";
    if (t.indexOf("NEGOC") === 0) return "negociado";
    if (t === "J" || t.indexOf("JURID") === 0) return "juridico";
    if (t.indexOf("BLOQ") === 0) return "bloqueio";
    if (t.indexOf("NAO NEGATIVAR") === 0 || t.indexOf("NAO INCLUIR") === 0) return "nao_negativar";
    if (/^\d{4}-\d{2}-\d{2}/.test(t) || /^\d{1,2}\/\d{1,2}\/?\d{2,4}/.test(t)) return "ok"; // planilhas antigas guardavam a data de inclusão
    return "";
  }
  var serSel = {}, serLimite = 300, serFiltrada = [];

  // Períodos de vencimento (abas). A aba escolhida fica lembrada neste navegador.
  var periodos = [], periodoSel = "";
  try { periodoSel = localStorage.getItem("ser_periodo") || ""; } catch (e) { periodoSel = ""; }
  function periodoAtual() { for (var i = 0; i < periodos.length; i++) if (periodos[i].id === periodoSel) return periodos[i]; return null; }
  function noPeriodo(x, p) { return !p || (x.vencimento && x.vencimento >= p.inicio && x.vencimento <= p.fim); }
  function renderPeriodos() {
    var cont = function (p) { var n = 0; parcelas.forEach(function (x) { if (noPeriodo(x, p)) n++; }); return n; };
    var abas = [{ id: "", nome: "Todos os períodos" }].concat(periodos);
    $("serPeriodos").innerHTML = abas.map(function (p) {
      var ativo = p.id === periodoSel;
      return '<button type="button" class="per-tab' + (ativo ? " active" : "") + '" role="tab" aria-selected="' + ativo + '" data-per="' + esc(p.id) + '"' +
        (p.id ? ' title="' + br(p.inicio) + " a " + br(p.fim) + '"' : "") + ">" + esc(p.nome) + ' <span class="n">' + cont(p.id ? p : null) + "</span>" +
        (ativo && p.id ? '<span class="edit" data-editar-per="' + esc(p.id) + '" title="Editar período" aria-label="Editar período">✎</span>' : "") + "</button>";
    }).join("");
    var at = $("serPeriodos").querySelector(".per-tab.active");
    if (at && at.scrollIntoView) at.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  $("serPeriodos").addEventListener("click", function (e) {
    var ed = e.target.closest("[data-editar-per]");
    if (ed) { abrirPeriodo(ed.getAttribute("data-editar-per")); return; }
    var b = e.target.closest(".per-tab"); if (!b) return;
    periodoSel = b.getAttribute("data-per");
    try { localStorage.setItem("ser_periodo", periodoSel); } catch (x) { /* navegador sem armazenamento */ }
    serSel = {}; serLimite = 300; renderSerasa();
  });

  var periodoEdit = null;
  function ultimoDiaMes(ano, mes) { return isoLocal(new Date(ano, mes, 0)); } // mes 1-12
  function nomePeriodo(ini, fim) {
    if (!ini || !fim) return "";
    var a = br(ini), b = br(fim);
    return (ini.slice(0, 4) === fim.slice(0, 4) ? a.slice(0, 5) : a) + " - " + b;
  }
  function abrirPeriodo(id) {
    var p = null; periodos.forEach(function (x) { if (x.id === id) p = x; });
    periodoEdit = p;
    mostrarErro($("perErr"), "");
    delete $("perNome").dataset.mexeu;
    $("perTitulo").textContent = p ? "Editar período" : "Novo período";
    if (p) { $("perInicio").value = p.inicio; $("perFim").value = p.fim; $("perNome").value = p.nome; }
    else {
      // sugere os 3 meses seguintes ao último período criado
      var ult = periodos.length ? periodos[periodos.length - 1].fim : isoLocal(new Date(new Date().getFullYear(), new Date().getMonth(), 0));
      var d = new Date(ult + "T00:00:00"); d.setDate(d.getDate() + 1);
      var ini = isoLocal(d), fim = ultimoDiaMes(d.getFullYear(), d.getMonth() + 3);
      $("perInicio").value = ini; $("perFim").value = fim; $("perNome").value = nomePeriodo(ini, fim);
    }
    var bx = $("perExcluir"); bx.hidden = !p; bx.classList.remove("armed"); bx.textContent = "Excluir período";
    abrir("mPeriodo"); setTimeout(function () { $("perInicio").focus(); }, 30);
  }
  ["perInicio", "perFim"].forEach(function (id) {
    $(id).addEventListener("change", function () { if (!$("perNome").dataset.mexeu) $("perNome").value = nomePeriodo($("perInicio").value, $("perFim").value); });
  });
  $("perNome").addEventListener("input", function () { this.dataset.mexeu = "1"; });
  $("btnNovoPeriodo").addEventListener("click", function () { abrirPeriodo(null); });
  $("formPeriodo").addEventListener("submit", function (e) {
    e.preventDefault();
    var dados = { nome: $("perNome").value.trim() || nomePeriodo($("perInicio").value, $("perFim").value), inicio: $("perInicio").value, fim: $("perFim").value };
    var req = periodoEdit ? api("PATCH", "/api/serasa/periodos/" + encodeURIComponent(periodoEdit.id), dados) : api("POST", "/api/serasa/periodos", dados);
    req.then(function (d) {
      var i = periodos.findIndex(function (p) { return p.id === d.periodo.id; });
      if (i === -1) periodos.push(d.periodo); else periodos[i] = d.periodo;
      periodos.sort(function (a, b) { return (a.inicio + a.fim).localeCompare(b.inicio + b.fim); });
      periodoSel = d.periodo.id;
      try { localStorage.setItem("ser_periodo", periodoSel); } catch (x) { /* sem armazenamento */ }
      fecharModais(); renderSerasa(); toast(periodoEdit ? "Período atualizado." : "Período criado.");
    }).catch(function (x) { mostrarErro($("perErr"), x.message); });
  });
  $("perExcluir").addEventListener("click", function () {
    var b = this;
    if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Confirmar exclusão"; return; }
    api("DELETE", "/api/serasa/periodos/" + encodeURIComponent(periodoEdit.id)).then(function () {
      periodos = periodos.filter(function (p) { return p.id !== periodoEdit.id; });
      periodoSel = ""; fecharModais(); renderSerasa(); toast("Período excluído. As parcelas continuam salvas.");
    }).catch(function (x) { toast(x.message); });
  });
  var SER_OPC = [{ v: "", l: "" }, { v: "__pendente", l: "Pendente" }].concat(SER_ST.slice(1));
  fill($("sMentor"), SER_OPC.slice(1), "Mentor: todas"); fill($("sSerasa"), SER_OPC.slice(1), "Serasa: todas");
  fill($("srMentor"), SER_ST); fill($("srSerasa"), SER_ST);

  function renderSerasa() {
    if (periodoSel && !periodoAtual()) periodoSel = "";
    renderPeriodos();
    var per = periodoAtual();
    var p = per ? parcelas.filter(function (x) { return noPeriodo(x, per); }) : parcelas;
    // indicadores
    var negVal = 0, neg = 0, pend = 0, pagas = 0, jur = 0, alunosSet = {};
    p.forEach(function (x) {
      alunosSet[(x.ra || "").trim() || (x.nome || x.responsavel || "").toLowerCase()] = 1;
      if (x.serasa === "ok") { neg++; negVal += Number(x.valor) || 0; }
      if (!x.serasa && ["", "ok", "negociado"].indexOf(x.mentor || "") !== -1) pend++;
      if (x.mentor === "pago" || x.serasa === "pago") pagas++;
      if (x.mentor === "juridico" || x.serasa === "juridico") jur++;
    });
    var tiles = [
      { n: p.length, l: "Parcelas · " + Object.keys(alunosSet).length + " alunos" },
      { n: money(negVal), l: "Valor negativado no Serasa", cls: "lead" },
      { n: neg, l: "Parcelas negativadas", c: "success" },
      { n: pend, l: "Aguardando inclusão", c: "warn" },
      { n: pagas, l: "Pagas", c: "info" },
      { n: jur, l: "No jurídico", c: "danger" }
    ];
    $("serKpis").innerHTML = tiles.map(function (t) {
      return '<div class="kpi ' + (t.cls || "") + '"><div class="num tabular"' + (t.c ? ' style="color:var(--' + t.c + ')"' : "") + ">" + t.n + '</div><div class="lbl">' + t.l + "</div></div>";
    }).join("");

    // anos de vencimento
    var anos = {}; p.forEach(function (x) { if (x.vencimento) anos[x.vencimento.slice(0, 4)] = 1; });
    prepararSelect($("sAno"), [{ v: "", l: "Todos os anos" }].concat(Object.keys(anos).sort().reverse().map(function (y) { return { v: y, l: "Vencimento em " + y }; })), $("sAno").value || "");

    var q = $("sBusca").value.trim().toLowerCase(), fm = $("sMentor").value, fs = $("sSerasa").value, fa = $("sAno").value, ord = $("sOrdem").value;
    var qDig = q.replace(/\D/g, "");
    function bate(filtro, v) { return !filtro || (filtro === "__pendente" ? !v : v === filtro); }
    serFiltrada = p.filter(function (x) {
      if (q) {
        var hay = ((x.nome || "") + " " + (x.responsavel || "") + " " + (x.ra || "")).toLowerCase();
        if (hay.indexOf(q) === -1 && !(qDig.length >= 3 && (x.cpf || "").replace(/\D/g, "").indexOf(qDig) !== -1)) return false;
      }
      if (!bate(fm, x.mentor) || !bate(fs, x.serasa)) return false;
      if (fa && (x.vencimento || "").slice(0, 4) !== fa) return false;
      return true;
    });
    serFiltrada.sort(function (a, b) {
      if (ord === "valor") return (Number(b.valor) || 0) - (Number(a.valor) || 0);
      if (ord === "nome") return (a.nome || a.responsavel || "").localeCompare(b.nome || b.responsavel || "");
      if (ord === "venc_asc") return (a.vencimento || "").localeCompare(b.vencimento || "");
      return (b.vencimento || "").localeCompare(a.vencimento || "");
    });
    var total = serFiltrada.reduce(function (s, x) { return s + (Number(x.valor) || 0); }, 0);
    $("serCount").textContent = serFiltrada.length + (serFiltrada.length === 1 ? " parcela" : " parcelas") + " · " + money(total);

    var tb = $("serTbody");
    if (!serFiltrada.length) {
      tb.innerHTML = '<tr><td colspan="8" class="empty"><b>' + (p.length ? "Nenhuma parcela com estes filtros" : "Nenhuma parcela cadastrada ainda") + '</b><div class="muted">' +
        (p.length ? "Ajuste a busca ou os filtros acima." : "Importe a planilha da Serasa ou cadastre a primeira parcela.") + "</div></td></tr>";
    } else {
      tb.innerHTML = serFiltrada.slice(0, serLimite).map(function (x) {
        var quem = x.nome || x.responsavel || "—";
        var meta = [x.ra ? "RA " + x.ra : "", x.nome && x.responsavel ? x.responsavel : ""].filter(Boolean).join(" · ");
        return '<tr class="click" data-id="' + esc(x.id) + '"><td><input type="checkbox" class="ser-chk" data-id="' + esc(x.id) + '"' + (serSel[x.id] ? " checked" : "") + ' aria-label="Selecionar"></td>' +
          '<td><div class="nome">' + esc(quem) + "</div>" + (meta ? '<div class="meta">' + esc(meta) + "</div>" : "") + "</td>" +
          '<td class="tabular">' + br(x.vencimento) + "</td>" +
          '<td class="tabular money">' + money(x.valor) + "</td>" +
          "<td>" + (x.tipo ? esc(x.tipo) : '<span class="muted">—</span>') + "</td>" +
          "<td>" + serPill(x.mentor) + "</td><td>" + serPill(x.serasa) + "</td>" +
          "<td>" + (x.dataInclusao ? br(x.dataInclusao) : '<span class="muted">—</span>') + (x.respInclusao ? '<div class="meta">' + esc(x.respInclusao) + "</div>" : "") + "</td></tr>";
      }).join("");
    }
    $("serMais").hidden = serFiltrada.length <= serLimite;
    $("serMais").textContent = "Mostrar mais (" + (serFiltrada.length - serLimite) + " restantes)";
    atualizarSelecao();
  }
  function atualizarSelecao() {
    var n = Object.keys(serSel).length;
    $("serBulk").hidden = !n;
    $("serSelCount").textContent = n + (n === 1 ? " selecionada" : " selecionadas");
    var vis = serFiltrada.slice(0, serLimite);
    $("serSelTodos").checked = vis.length > 0 && vis.every(function (x) { return serSel[x.id]; });
  }
  ["sBusca", "sMentor", "sSerasa", "sAno", "sOrdem"].forEach(function (id) { $(id).addEventListener("input", function () { serLimite = 300; renderSerasa(); }); });
  $("serMais").addEventListener("click", function () { serLimite += 300; renderSerasa(); });
  $("serTbody").addEventListener("click", function (e) {
    var chk = e.target.closest(".ser-chk");
    if (chk) { if (chk.checked) serSel[chk.getAttribute("data-id")] = 1; else delete serSel[chk.getAttribute("data-id")]; atualizarSelecao(); return; }
    var tr = e.target.closest("tr[data-id]"); if (tr) abrirParcela(tr.getAttribute("data-id"));
  });
  $("serSelTodos").addEventListener("change", function () {
    var on = this.checked;
    serFiltrada.slice(0, serLimite).forEach(function (x) { if (on) serSel[x.id] = 1; else delete serSel[x.id]; });
    renderSerasa();
  });
  $("serLimparSel").addEventListener("click", function () { serSel = {}; renderSerasa(); });
  document.querySelectorAll("[data-lote]").forEach(function (b) {
    b.addEventListener("click", function () {
      var ids = Object.keys(serSel); if (!ids.length) return;
      var campos = JSON.parse(b.getAttribute("data-lote")); campos.ids = ids;
      b.disabled = true;
      api("POST", "/api/serasa/lote", campos).then(function (d) {
        toast(d.atualizados + " parcela(s) atualizada(s)."); serSel = {}; return carregar();
      }).catch(function (x) { toast(x.message); }).then(function () { b.disabled = false; });
    });
  });

  // cadastro / edição de parcela
  var parcelaAtual = null;
  function porIdParcela(id) { for (var i = 0; i < parcelas.length; i++) if (parcelas[i].id === id) return parcelas[i]; return null; }
  function abrirParcela(id) {
    var x = id ? porIdParcela(id) : null; parcelaAtual = x;
    $("formSerasa").reset(); mostrarErro($("srErr"), "");
    $("serTitulo").textContent = x ? (x.nome || x.responsavel || "Parcela") : "Nova parcela";
    $("serSub").textContent = x ? "Parcela de " + br(x.vencimento) + " · " + money(x.valor) : "Registro de negativação";
    var v = x || {};
    $("srRa").value = v.ra || ""; $("srNome").value = v.nome || ""; $("srResp").value = v.responsavel || ""; $("srCpf").value = v.cpf || "";
    $("srVenc").value = v.vencimento || ""; $("srValor").value = v.valor != null && x ? v.valor : ""; $("srTipo").value = v.tipo || "";
    $("srInclusao").value = v.dataInclusao || ""; $("srMentor").value = v.mentor || ""; $("srSerasa").value = v.serasa || "";
    $("srRespInc").value = v.respInclusao || ""; $("srObs").value = v.observacao || "";
    $("srAtualizado").textContent = x && x.atualizadoPor ? "Última alteração por " + x.atualizadoPor + " em " + br(x.atualizadoEm) : "";
    var bx = $("srExcluir"); bx.hidden = !x || !eu || eu.perfil !== "admin"; bx.classList.remove("armed"); bx.textContent = "Excluir parcela";
    abrir("mSerasa"); setTimeout(function () { (x ? $("srMentor") : $("srRa")).focus(); }, 30);
  }
  // Ao marcar como incluída, preenche data e responsável pela inclusão (se ainda vazios).
  ["srMentor", "srSerasa"].forEach(function (id) {
    $(id).addEventListener("change", function () {
      if (this.value !== "ok") return;
      if (!$("srInclusao").value) $("srInclusao").value = hoje();
      if (!$("srRespInc").value && eu) $("srRespInc").value = eu.nome;
    });
  });
  $("btnSerNovo").addEventListener("click", function () { abrirParcela(null); });
  $("formSerasa").addEventListener("submit", function (e) {
    e.preventDefault();
    var err = $("srErr");
    if (!$("srNome").value.trim() && !$("srResp").value.trim()) return mostrarErro(err, "Informe o nome do aluno ou do responsável.");
    if (!$("srVenc").value) return mostrarErro(err, "Informe o vencimento da parcela.");
    var dados = {
      ra: $("srRa").value.trim(), nome: $("srNome").value.trim(), responsavel: $("srResp").value.trim(), cpf: $("srCpf").value.trim(),
      vencimento: $("srVenc").value, valor: parseFloat($("srValor").value) || 0, tipo: $("srTipo").value.trim().toUpperCase(),
      mentor: $("srMentor").value, serasa: $("srSerasa").value, dataInclusao: $("srInclusao").value, respInclusao: $("srRespInc").value.trim(),
      observacao: $("srObs").value.trim()
    };
    var req = parcelaAtual ? api("PATCH", "/api/serasa/" + encodeURIComponent(parcelaAtual.id), dados) : api("POST", "/api/serasa", dados);
    req.then(function (d) {
      var i = parcelas.findIndex(function (p) { return p.id === d.parcela.id; });
      if (i === -1) parcelas.unshift(d.parcela); else parcelas[i] = d.parcela;
      fecharModais(); renderSerasa(); toast(parcelaAtual ? "Parcela atualizada." : "Parcela cadastrada.");
    }).catch(function (x) { mostrarErro(err, x.message); });
  });
  $("srExcluir").addEventListener("click", function () {
    var b = this;
    if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Confirmar exclusão"; return; }
    api("DELETE", "/api/serasa/" + encodeURIComponent(parcelaAtual.id)).then(function () {
      parcelas = parcelas.filter(function (p) { return p.id !== parcelaAtual.id; }); delete serSel[parcelaAtual.id];
      fecharModais(); renderSerasa(); toast("Parcela excluída.");
    }).catch(function (x) { toast(x.message); });
  });

  // modelo, exportação e importação
  var SER_CAB = ["RA", "NOME", "RESPONSÁVEL FINANCEIRO", "CPF", "VENCIMENTO", "VALOR (R$)", "TIPO", "MENTOR", "SERASA", "DATA INCLUSÃO", "RESP. INCLUSÃO", "OBSERVAÇÃO"];
  function csvCampo(v) { v = String(v == null ? "" : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function serStTexto(v) { return v ? serSt(v).l.toUpperCase() : ""; }
  $("btnSerModelo").addEventListener("click", function () {
    baixar("modelo_importacao_serasa.csv", SER_CAB.join(";") + "\n" +
      "12345;MARIA EXEMPLO DA SILVA;JOÃO DA SILVA;000.000.000-00;10/08/2026;1234,56;MENSALIDADE;OK;;;;\n");
    toast("Modelo baixado.");
  });
  $("btnSerExportar").addEventListener("click", function () {
    var linhas = serFiltrada.map(function (x) {
      return [x.ra, x.nome, x.responsavel, x.cpf, br(x.vencimento), (Number(x.valor) || 0).toFixed(2).replace(".", ","), x.tipo,
        serStTexto(x.mentor), serStTexto(x.serasa), x.dataInclusao ? br(x.dataInclusao) : "", x.respInclusao, x.observacao].map(csvCampo).join(";");
    });
    baixar("relatorio_serasa_" + hoje() + ".csv", SER_CAB.join(";") + "\n" + linhas.join("\n"));
    toast("Relatório exportado (" + linhas.length + " parcelas, conforme os filtros).");
  });
  $("btnSerImportar").addEventListener("click", function () { abrirImportacao("serasa"); });
  // Na Serasa as colunas são reconhecidas pelo nome exato (a coluna "SERASA" contém "ra" e
  // confundiria a busca aproximada usada no Painel).
  function colExata(h, nomes) { for (var i = 0; i < nomes.length; i++) { var j = h.indexOf(nomes[i]); if (j !== -1) return j; } return -1; }
  function processarCSVSerasa(p) {
    var h = p.headers, out = $("importResult");
    var ix = {
      ra: colExata(h, ["ra", "codigo", "matricula"]), nome: colExata(h, ["nome", "nome do aluno", "aluno"]),
      resp: colExata(h, ["responsavel financeiro", "responsavel"]), cpf: colExata(h, ["cpf"]),
      venc: colExata(h, ["vencimento", "data de vencimento", "venc"]), valor: colExata(h, ["valor (r$)", "valor", "valor r$"]),
      tipo: colExata(h, ["tipo"]), mentor: colExata(h, ["mentor"]), serasa: colExata(h, ["serasa"]),
      dataInc: colExata(h, ["data inclusao", "data de inclusao", "inclusao"]), respInc: colExata(h, ["resp. inclusao", "resp inclusao", "responsavel inclusao"]),
      obs: colExata(h, ["observacao", "obs"])
    };
    if ((ix.nome === -1 && ix.resp === -1) || ix.venc === -1) {
      out.innerHTML = '<div class="import-summary" style="color:var(--danger)">Não encontrei as colunas de nome (ou responsável) e vencimento. Colunas identificadas: ' +
        esc((p.raw || []).filter(Boolean).join(", ") || "nenhuma") + '. Confira o modelo em "Baixar modelo".</div>';
      $("btnConfirmImport").disabled = true; return;
    }
    function c(r, i) { return i !== -1 ? (r[i] || "").trim() : ""; }
    pendentes = p.rows.map(function (r) {
      var mentorTxt = c(r, ix.mentor), serasaTxt = c(r, ix.serasa), dataInc = parseDateBR(c(r, ix.dataInc));
      if (!dataInc && /^\d/.test(serasaTxt)) dataInc = parseDateBR(serasaTxt);
      if (!dataInc && /^\d/.test(mentorTxt)) dataInc = parseDateBR(mentorTxt);
      return {
        ra: c(r, ix.ra), nome: c(r, ix.nome), responsavel: c(r, ix.resp), cpf: c(r, ix.cpf), vencimento: parseDateBR(c(r, ix.venc)),
        valor: parseMoneyBR(c(r, ix.valor)), tipo: c(r, ix.tipo).toUpperCase(), mentor: serNormalizar(mentorTxt), serasa: serNormalizar(serasaTxt),
        dataInclusao: dataInc, respInclusao: c(r, ix.respInc), observacao: c(r, ix.obs)
      };
    }).filter(function (r) {
      var quem = (r.nome || r.responsavel).toUpperCase();
      return quem && quem !== "NOME" && quem !== "RESPONSÁVEL FINANCEIRO" && r.vencimento;
    });
    out.innerHTML = '<div class="import-preview"><table><thead><tr><th>Aluno / responsável</th><th>Vencimento</th><th>Valor</th><th>Mentor</th><th>Serasa</th><th>Inclusão</th></tr></thead><tbody>' +
      pendentes.slice(0, 8).map(function (r) {
        return "<tr><td>" + esc(r.nome || r.responsavel) + (r.ra ? ' <span class="muted">RA ' + esc(r.ra) + "</span>" : "") + "</td><td>" + br(r.vencimento) + '</td><td class="tabular">' + money(r.valor) +
          "</td><td>" + serSt(r.mentor).l + "</td><td>" + serSt(r.serasa).l + "</td><td>" + br(r.dataInclusao) + "</td></tr>";
      }).join("") + "</tbody></table></div>" +
      '<div class="import-summary">' + pendentes.length + " parcela(s) encontradas" + (pendentes.length > 8 ? " (mostrando as 8 primeiras)" : "") +
      ". Parcelas que já existirem (mesmo aluno, vencimento, valor e tipo) só recebem os campos que vierem preenchidos — nada que a equipe já marcou é apagado.</div>";
    $("btnConfirmImport").disabled = !pendentes.length;
  }

  // ---------------------------------------------------------------- usuários
  var armado = null;
  function carregarUsuarios() {
    if (!eu || eu.perfil !== "admin") return;
    api("GET", "/api/usuarios").then(function (d) { usuarios = d.usuarios; renderUsuarios(); }).catch(function (x) { toast(x.message); });
  }
  function renderUsuarios() {
    if (!eu || eu.perfil !== "admin") return;
    $("tbodyUsers").innerHTML = usuarios.length ? usuarios.map(function (u) {
      var self = u.id === eu.id;
      return "<tr><td><div class=\"nome\">" + esc(u.nome) + (self ? ' <span class="muted" style="font-weight:400">(você)</span>' : "") + "</div></td>" +
        "<td><code>" + esc(u.usuario) + "</code></td>" +
        '<td><span class="role ' + (u.perfil === "admin" ? "admin" : "atend") + '">' + (u.perfil === "admin" ? "Administrador" : "Atendente") + "</span></td>" +
        "<td>" + (u.ativo ? '<span class="st-on">Ativo</span>' : '<span class="st-off">Desativado</span>') + (u.trocarSenha ? '<div class="meta">senha provisória</div>' : "") + "</td>" +
        "<td>" + (u.ultimoAcesso ? br(u.ultimoAcesso) : '<span class="muted">nunca entrou</span>') + "</td>" +
        '<td><div class="row-actions">' +
        '<button type="button" class="btn small ghost" data-act="editar" data-id="' + u.id + '">Editar</button>' +
        '<button type="button" class="btn small ghost" data-act="senha" data-id="' + u.id + '">Redefinir senha</button>' +
        (self ? "" : '<button type="button" class="btn small ghost" data-act="ativo" data-id="' + u.id + '">' + (u.ativo ? "Desativar" : "Reativar") + "</button>" +
          '<button type="button" class="btn small danger' + (armado === u.id ? " armed" : "") + '" data-act="excluir" data-id="' + u.id + '">' + (armado === u.id ? "Confirmar exclusão" : "Excluir") + "</button>") +
        "</div></td></tr>";
    }).join("") : '<tr><td colspan="6" class="empty muted">Carregando…</td></tr>';
  }
  function usuarioPorId(id) { for (var i = 0; i < usuarios.length; i++) if (usuarios[i].id === id) return usuarios[i]; return null; }
  $("tbodyUsers").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-act]"); if (!b) return;
    var u = usuarioPorId(b.getAttribute("data-id")), act = b.getAttribute("data-act"); if (!u) return;
    if (act !== "excluir") armado = null;
    if (act === "editar") return abrirEditarUsuario(u);
    if (act === "senha") return abrirFormUsuario(u);
    if (act === "ativo") {
      return api("PATCH", "/api/usuarios/" + u.id, { ativo: !u.ativo }).then(function () {
        toast(u.ativo ? u.nome + " não consegue mais entrar. O histórico continua salvo." : u.nome + " pode entrar de novo.");
        carregarUsuarios(); atualizarAtendentes();
      }).catch(function (x) { toast(x.message); });
    }
    if (act === "excluir") {
      if (armado !== u.id) { armado = u.id; renderUsuarios(); return; }
      armado = null;
      api("DELETE", "/api/usuarios/" + u.id).then(function () { toast("Acesso de " + u.nome + " excluído. Os atendimentos continuam no histórico."); carregarUsuarios(); atualizarAtendentes(); })
        .catch(function (x) { toast(x.message); renderUsuarios(); });
    }
  });
  function atualizarAtendentes() { api("GET", "/api/atendentes").then(function (d) { atendentesAtivos = d.atendentes; }).catch(function () {}); }

  var editando = null;
  function forca(p) { var s = 0; if (p.length >= 8) s++; if (p.length >= 12) s++; if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++; if (/\d/.test(p)) s++; if (/[^A-Za-z0-9]/.test(p)) s++; return s; }
  $("uFPass").addEventListener("input", function () { var s = forca(this.value), b = $("uStr"); b.style.width = s * 20 + "%"; b.style.background = s < 3 ? "var(--danger)" : s < 4 ? "var(--warn)" : "var(--success)"; });
  $("btnGerar").addEventListener("click", function () {
    var ch = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789", a = new Uint32Array(12), p = "";
    crypto.getRandomValues(a); for (var i = 0; i < 12; i++) p += ch[a[i] % ch.length];
    p = p.slice(0, 6) + "-" + p.slice(6);
    $("uFPass").value = p; $("uFPass2").value = p; $("uFPass").type = "text";
    document.querySelector('[data-pw="uFPass"]').textContent = "Ocultar";
    $("uFPass").dispatchEvent(new Event("input"));
  });
  function abrirFormUsuario(u) {
    editando = u || null;
    $("formUser").reset(); mostrarErro($("uErr"), ""); $("uStr").style.width = "0";
    $("uFPass").type = "password"; document.querySelector('[data-pw="uFPass"]').textContent = "Mostrar";
    delete $("uFNome").dataset.mexeu;
    $("uIdent").hidden = !!u; $("uPerfilWrap").hidden = !!u;
    $("uTitle").textContent = u ? "Redefinir senha" : "Criar acesso";
    $("uSub").textContent = u ? "Nova senha provisória para " + u.nome + " (" + u.usuario + "). Passe a senha pessoalmente ou por um canal seguro." : "A pessoa entra com este usuário e a senha provisória.";
    $("uSubmit").textContent = u ? "Redefinir senha" : "Criar acesso";
    abrir("mUser"); setTimeout(function () { (u ? $("uFPass") : $("uFNome")).focus(); }, 30);
  }
  $("btnNovoUser").addEventListener("click", function () { abrirFormUsuario(null); });
  $("uFNome").addEventListener("input", function () {
    if (this.dataset.mexeu) return;
    var p = this.value.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
    $("uFUser").value = p.length > 1 ? p[0] + "." + p[p.length - 1] : p[0] || "";
  });
  $("uFUser").addEventListener("input", function () { $("uFNome").dataset.mexeu = "1"; });
  $("formUser").addEventListener("submit", function (e) {
    e.preventDefault();
    var err = $("uErr"), p = $("uFPass").value;
    if (p.length < 8) return mostrarErro(err, "A senha precisa ter pelo menos 8 caracteres.");
    if (p !== $("uFPass2").value) return mostrarErro(err, "As duas senhas não conferem.");
    var req = editando
      ? api("PATCH", "/api/usuarios/" + editando.id, { senha: p, trocarSenha: $("uFTroca").checked })
      : api("POST", "/api/usuarios", { nome: $("uFNome").value.trim(), usuario: $("uFUser").value.trim().toLowerCase(), perfil: $("uFPerfil").value, senha: p, trocarSenha: $("uFTroca").checked });
    req.then(function (d) {
      fecharModais();
      toast(editando ? "Senha de " + primeiroNome(editando.nome) + " redefinida." : "Acesso criado. " + primeiroNome(d.usuario.nome) + " já pode entrar com “" + d.usuario.usuario + "”.");
      carregarUsuarios(); atualizarAtendentes();
    }).catch(function (x) { mostrarErro(err, x.message); });
  });
  function abrirEditarUsuario(u) {
    editando = u; mostrarErro($("euErr"), "");
    $("euSub").textContent = "Usuário " + u.usuario;
    $("euNome").value = u.nome; $("euPerfil").value = u.perfil;
    abrir("mEditUser"); setTimeout(function () { $("euNome").focus(); }, 30);
  }
  $("formEditUser").addEventListener("submit", function (e) {
    e.preventDefault();
    api("PATCH", "/api/usuarios/" + editando.id, { nome: $("euNome").value.trim(), perfil: $("euPerfil").value }).then(function (d) {
      fecharModais(); toast("Acesso atualizado.");
      if (d.usuario.id === eu.id) { eu = d.usuario; $("uNome").textContent = eu.nome; }
      carregarUsuarios(); atualizarAtendentes();
    }).catch(function (x) { mostrarErro($("euErr"), x.message); });
  });

  // backup do painel antigo
  ligarDropzone($("backupDrop"), $("backupFile"), function (txt) {
    var out = $("backupResult"), dados;
    try { dados = JSON.parse(txt); } catch (e) { out.innerHTML = '<span style="color:var(--danger)">Este arquivo não é um JSON válido.</span>'; return; }
    var na = Object.keys(dados.alunos || {}).length, nt = Object.keys(dados.atendimentos || {}).length;
    out.textContent = "Enviando " + na + " alunos e " + nt + " atendimentos…";
    api("POST", "/api/admin/importar-backup", dados).then(function (r) {
      out.innerHTML = '<b style="color:var(--success)">Pronto:</b> ' + r.alunos + " alunos e " + r.atendimentos + " atendimentos gravados no banco.";
      toast("Dados do painel antigo importados."); carregar();
    }).catch(function (x) { out.innerHTML = '<span style="color:var(--danger)">' + esc(x.message) + "</span>"; });
    $("backupFile").value = "";
  });

  // minha senha
  $("btnMinhaSenha").addEventListener("click", function () { $("formSenha").reset(); mostrarErro($("msErr"), ""); abrir("mSenha"); setTimeout(function () { $("msAtual").focus(); }, 30); });
  $("formSenha").addEventListener("submit", function (e) {
    e.preventDefault();
    if ($("msNova").value !== $("msNova2").value) return mostrarErro($("msErr"), "As duas senhas novas não conferem.");
    api("POST", "/api/me/senha", { atual: $("msAtual").value, nova: $("msNova").value })
      .then(function () { fecharModais(); toast("Senha alterada."); })
      .catch(function (x) { mostrarErro($("msErr"), x.message); });
  });

  iniciar();
})();
