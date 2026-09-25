// Painel de Cobrança — Colégio Ser (interface)
(function () {
  "use strict";
  // muda a cada publicação: aparece embaixo do menu para conferir se o navegador carregou a versão nova
  var VERSAO = "25/09 · v5";

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
        if (!r.ok) { var e = new Error(data.erro || ("O servidor não conseguiu concluir (erro " + r.status + "). Tente de novo em instantes; se continuar, avise quem cuida do sistema.")); e.status = r.status; e.codigo = data.codigo; throw e; }
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
    $("versao").textContent = "Versão " + VERSAO;
    $("uPerfil").textContent = eu.perfil === "admin" ? "Administrador(a)" : "Atendente";
    $("uAvatar").textContent = eu.nome.split(" ").map(function (p) { return p[0] || ""; }).slice(0, 2).join("").toUpperCase();
    document.querySelectorAll("[data-admin]").forEach(function (el) { el.hidden = eu.perfil !== "admin"; });
    var h = new Date().getHours();
    $("saudacao").textContent = (h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite") + ", " + primeiroNome(eu.nome) + " · " + cap(new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }));
    if (view === "usuarios" && eu.perfil !== "admin") view = "painel";
    ir(view);
    carregar();
    carregarBaseDados();
    iniciarPolling();
  }

  // Todas as telas (Painel, Contraturno, Evolução…) são calculadas a partir destes dados.
  // Eles são recarregados a cada 30 s, ao voltar para o site e ao trocar de aba.
  var ultimaCarga = 0;
  function carregar() {
    return Promise.all([api("GET", "/api/alunos"), api("GET", "/api/atendimentos"), api("GET", "/api/atendentes"), api("GET", "/api/serasa"), api("GET", "/api/serasa/periodos")])
      .then(function (r) {
        alunos = {}; r[0].alunos.forEach(function (a) { alunos[a.id] = a; });
        atends = r[1].atendimentos;
        atendentesAtivos = r[2].atendentes;
        parcelas = r[3].parcelas;
        negInicio = r[3].negInicio || "";
        periodos = r[4].periodos;
        ultimaCarga = Date.now();
        marcarSync(true);
        renderTudo();
        // ficha aberta: o histórico mostra na hora o que colegas registraram (o formulário não é mexido)
        if (!$("mDetalhe").hidden && alunos[curId]) renderTimeline();
      })
      .catch(function (e) { marcarSync(false); if (e.status !== 401 && e.status !== 403) toast(e.message); });
  }
  function marcarSync(ok) {
    var txt = ok ? "Atualizado às " + new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "Sem conexão";
    document.querySelectorAll(".sync").forEach(function (s) { s.classList.toggle("off", !ok); });
    document.querySelectorAll(".sync-lbl").forEach(function (s) { s.textContent = txt; });
  }
  function iniciarPolling() {
    pararPolling();
    pollTimer = setInterval(function () {
      if (document.hidden || !eu) return;
      // as janelas abertas não são redesenhadas (quem está preenchendo não perde nada); só a
      // importação em andamento espera
      if (!$("mImportar").hidden) return;
      carregar();
    }, 30000);
  }
  function pararPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
  document.addEventListener("visibilitychange", function () { if (!document.hidden && eu) carregar(); });

  function renderTudo() {
    if (view === "painel" || view === "contraturno") renderPainel();
    if (view === "evolucao") renderEvolucao();
    if (view === "serasa") renderSerasa();
    if (view === "base") renderBase();
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
    // ao trocar de aba, busca o que foi registrado por todos desde a última atualização
    if (eu && Date.now() - ultimaCarga > 5000) carregar();
    if (v === "base" && !baseCarregada) carregarBaseDados();
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
      fill(anoSel, [y - 1, y, y + 1].map(function (n) { return { v: String(n), l: "Ano " + n }; }));
    }
    anoSel.value = String(new Date().getFullYear());
    negSel = {};
    document.querySelectorAll("#aNegSelects .msel").forEach(function (b) { b.classList.remove("aberto", "cima"); });
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
        (mens.length ? '<div class="tl-extra">Negociado: ' + NEG_TIPOS.map(function (tp) {
          var d = mens.filter(function (m) { return (m.tipo || "mensalidade") === tp.k; });
          return d.length ? "<b>" + tp.pl + "</b> " + d.map(function (m) { return mesCurto(m.mes) + " (" + money(m.valor) + ")"; }).join(", ") : "";
        }).filter(Boolean).join(" · ") + " · total " + money(t.valorNegociadoTotal || 0) + "</div>" : "") +
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
  // Valores negociados: três listas suspensas (Mensalidade, Acordo, Cheques) em que se marcam
  // os meses do ano escolhido; cada mês marcado ganha uma linha para o valor negociado.
  var NEG_TIPOS = [{ k: "mensalidade", l: "Mensalidade", pl: "Mensalidades" }, { k: "acordo", l: "Acordo", pl: "Acordo" }, { k: "cheque", l: "Cheques", pl: "Cheques" }];
  function tipoNeg(k) { for (var i = 0; i < NEG_TIPOS.length; i++) if (NEG_TIPOS[i].k === k) return NEG_TIPOS[i]; return NEG_TIPOS[0]; }
  function mesCurto(mes) { var mm = parseInt(mes.slice(5, 7), 10); return cap(MESES[mm - 1]).slice(0, 3) + "/" + mes.slice(0, 4); }
  var negSel = {}; // "tipo|AAAA-MM" -> { tipo, mes, valor }
  function renderMensGrid() {
    // renderiza os três campos suspensos (mantém aberto o que estava aberto)
    var ano = $("aMensAno").value;
    document.querySelectorAll("#aNegSelects .msel").forEach(function (box) {
      var tipo = box.getAttribute("data-tipo"), t = tipoNeg(tipo), aberto = box.classList.contains("aberto");
      var marcados = Object.keys(negSel).filter(function (k) { return negSel[k].tipo === tipo; }).length;
      var busca = box.querySelector(".msel-busca"), q = busca ? busca.value : "";
      box.innerHTML = '<button type="button" class="msel-btn' + (marcados ? " tem" : "") + '" aria-haspopup="listbox" aria-expanded="' + aberto + '">' + t.l +
        (marcados ? ' <span class="msel-n">' + marcados + "</span>" : "") + '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg></button>' +
        '<div class="msel-pop"' + (aberto ? "" : " hidden") + '><div class="msel-busca-wrap"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>' +
        '<input class="msel-busca" placeholder="Buscar mês" aria-label="Buscar mês" value="' + esc(q) + '"></div><div class="msel-lista" role="listbox" aria-multiselectable="true">' +
        MESES.map(function (nome, i) {
          var mes = ano + "-" + pad2(i + 1), on = !!negSel[tipo + "|" + mes];
          var oculto = q && normNome(nome).indexOf(normNome(q)) === -1;
          return '<button type="button" class="msel-op' + (on ? " on" : "") + '" role="option" aria-selected="' + on + '" data-mes="' + mes + '"' + (oculto ? " hidden" : "") + '><span class="msel-chip">' + cap(nome) + "</span>" +
            '<svg class="msel-ok" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12l5 5L20 7"/></svg></button>';
        }).join("") + '</div><div class="msel-rodape">' + ano + '<button type="button" class="linkbtn msel-fechar">Pronto</button></div></div>';
    });
    renderNegLinhas();
  }
  function renderNegLinhas() {
    var ks = Object.keys(negSel).sort(function (a, b) {
      var x = negSel[a], y = negSel[b];
      return NEG_TIPOS.indexOf(tipoNeg(x.tipo)) - NEG_TIPOS.indexOf(tipoNeg(y.tipo)) || x.mes.localeCompare(y.mes);
    });
    $("aNegLinhas").innerHTML = ks.map(function (k) {
      var m = negSel[k];
      return '<div class="neg-linha"><span class="tag">' + tipoNeg(m.tipo).l + '</span><b class="tabular">' + mesCurto(m.mes) + "</b>" +
        '<input type="number" step="0.01" min="0" class="neg-val" data-k="' + esc(k) + '" value="' + (m.valor === "" || m.valor == null ? "" : esc(m.valor)) + '" placeholder="Valor negociado" aria-label="Valor negociado de ' + tipoNeg(m.tipo).l + " " + mesCurto(m.mes) + '">' +
        '<button type="button" class="x neg-tirar" data-k="' + esc(k) + '" aria-label="Remover">×</button></div>';
    }).join("");
    atualizarMensTotal();
  }
  function coletarMensalidades() {
    return Object.keys(negSel).map(function (k) { var m = negSel[k]; return { tipo: m.tipo, mes: m.mes, valor: parseFloat(m.valor) || 0 }; });
  }
  function atualizarMensTotal() { $("aMensTotal").textContent = money(coletarMensalidades().reduce(function (s, m) { return s + m.valor; }, 0)); }
  $("aMensAno").addEventListener("change", renderMensGrid);
  $("aNegSelects").addEventListener("click", function (e) {
    var box = e.target.closest(".msel"); if (!box) return;
    var tipo = box.getAttribute("data-tipo");
    if (e.target.closest(".msel-btn")) {
      var abrirEste = !box.classList.contains("aberto");
      document.querySelectorAll("#aNegSelects .msel").forEach(function (b) { b.classList.remove("aberto", "cima"); });
      if (abrirEste) { box.classList.add("aberto"); var bi = box.querySelector(".msel-busca"); if (bi) bi.value = ""; }
      renderMensGrid();
      if (abrirEste) {
        var nova = document.querySelector('#aNegSelects .msel[data-tipo="' + tipo + '"]'), pop = nova.querySelector(".msel-pop"), r = pop.getBoundingClientRect();
        // sem espaço embaixo: abre para cima
        if (r.bottom > window.innerHeight && nova.getBoundingClientRect().top > r.height) nova.classList.add("cima");
        nova.querySelector(".msel-busca").focus();
      }
      return;
    }
    if (e.target.closest(".msel-fechar")) { box.classList.remove("aberto", "cima"); renderMensGrid(); return; }
    var op = e.target.closest(".msel-op"); if (!op) return;
    var k = tipo + "|" + op.getAttribute("data-mes");
    if (negSel[k]) delete negSel[k]; else negSel[k] = { tipo: tipo, mes: op.getAttribute("data-mes"), valor: "" };
    renderMensGrid();
  });
  $("aNegSelects").addEventListener("input", function (e) {
    if (!e.target.classList.contains("msel-busca")) return;
    var q = normNome(e.target.value), lista = e.target.closest(".msel-pop").querySelectorAll(".msel-op");
    lista.forEach(function (op) { op.hidden = !!q && normNome(op.textContent).indexOf(q) === -1; });
  });
  // fecha a lista ao clicar fora dela
  document.addEventListener("mousedown", function (e) {
    if (e.target.closest && e.target.closest("#aNegSelects .msel")) return;
    var abertos = document.querySelectorAll("#aNegSelects .msel.aberto");
    if (!abertos.length) return;
    abertos.forEach(function (b) { b.classList.remove("aberto", "cima"); });
    renderMensGrid();
  });
  $("aNegLinhas").addEventListener("input", function (e) {
    if (!e.target.classList.contains("neg-val")) return;
    var m = negSel[e.target.getAttribute("data-k")]; if (m) m.valor = e.target.value;
    atualizarMensTotal();
  });
  $("aNegLinhas").addEventListener("click", function (e) {
    var b = e.target.closest(".neg-tirar"); if (!b) return;
    delete negSel[b.getAttribute("data-k")]; renderMensGrid();
  });

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
  var HEADER_TOKENS = ["ra", "codigo", "matricula", "nome", "nome do aluno", "nome completo", "aluno", "turma", "responsavel", "responsavel financeiro", "responsavel(a)", "telefone", "tel", "celular", "e-mail", "email", "valor", "valor em aberto", "valor devido", "total devido", "vencimento", "data de vencimento", "dt vencimento", "venc", "valor (r$)", "mentor", "serasa", "cpf", "tipo", "data inclusao", "resp. inclusao", "realizado", "periodo", "situacao", "serie", "data de nascimento", "endereco", "cpf do responsavel", "celular do responsavel"];
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
  var confirmouPeriodo = false; // o aviso de período já foi mostrado para este arquivo
  var simulado = false; // "igual ao arquivo": a prévia do que muda já foi mostrada
  function processarCSV(text) { processarTabela(parseCSV(text)); }
  // tabela já separada em colunas (vinda do CSV ou do PDF)
  function processarTabela(p) {
    var h = p.headers;
    confirmouPeriodo = false; simulado = false;
    if (modoImport === "serasa") return processarCSVSerasa(p);
    if (modoImport === "base") return processarCSVBase(p);
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
    mostrarPreviaAlunos(brutos, "");
  }
  function mostrarPreviaAlunos(brutos, nota) {
    var out = $("importResult");
    pendentes = agrupar(brutos);
    var temVenc = pendentes.some(function (r) { return r.vencimento; });
    out.innerHTML = '<div class="import-preview"><table><thead><tr><th>Aluno</th><th>Turma</th><th>Responsável</th><th>Valor</th><th>Parcelas</th>' + (temVenc ? "<th>Vencimento</th>" : "") + "</tr></thead><tbody>" +
      pendentes.slice(0, 8).map(function (r) {
        return "<tr><td>" + esc(r.nome) + "</td><td>" + esc(r.turma) + "</td><td>" + esc(r.responsavel) + '</td><td class="tabular">' + money(r.valorAberto) + '</td><td class="tabular">' + r.parcelas + "</td>" + (temVenc ? "<td>" + br(r.vencimento) + "</td>" : "") + "</tr>";
      }).join("") + "</tbody></table></div>" +
      '<div class="import-summary">' + pendentes.length + " aluno(s) únicos encontrados" + (pendentes.length > 8 ? " (mostrando os 8 primeiros)" : "") +
      (brutos.length !== pendentes.length ? " — " + brutos.length + " linhas foram agrupadas por aluno (parcelas somadas)." : ".") +
      " Quem já existir " + (carteira === "contraturno" ? "no Contraturno" : "no Painel") + " (mesmo RA ou nome) será atualizado, não duplicado." +
      (temVenc ? "" : " Não encontrei coluna de vencimento — a análise por faixa de atraso só vale para alunos com essa data.") + (nota || "") + "</div>";
    $("btnConfirmImport").disabled = !pendentes.length;
  }

  // ---- relatório de inadimplência em PDF (exportado pelo sistema acadêmico)
  // O PDF não tem células: lemos o texto com a posição de cada pedaço, montamos as linhas
  // pela altura na página e usamos o cabeçalho (Código, Nome, Data vcto., Devido) para
  // saber o que é cada número. Uma linha do relatório = uma parcela.
  var PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  function carregarPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise(function (ok, falhou) {
      var s = document.createElement("script"); s.src = PDFJS + "pdf.min.js";
      s.onload = function () { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js"; ok(window.pdfjsLib); };
      s.onerror = function () { falhou(new Error("Não consegui carregar o leitor de PDF. Confira a internet e tente de novo.")); };
      document.head.appendChild(s);
    });
  }
  function linhasDaPagina(pg) {
    var vp = pg.getViewport({ scale: 1 });
    return pg.getTextContent().then(function (tc) {
      var itens = [];
      tc.items.forEach(function (it) {
        var s = (it.str || "").trim(); if (!s) return;
        var t = window.pdfjsLib.Util.transform(vp.transform, it.transform); // posição como aparece na tela (vale para página deitada)
        itens.push({ x: t[4], y: t[5], w: it.width || 0, h: Math.hypot(t[2], t[3]) || it.height || 8, cx: t[4] + (it.width || 0) / 2, s: s });
      });
      itens.sort(function (a, b) { return a.y - b.y || a.x - b.x; });
      var linhas = [];
      itens.forEach(function (it) {
        var l = linhas.length ? linhas[linhas.length - 1] : null;
        if (l && Math.abs(l.y - it.y) <= 3) l.cels.push(it); else linhas.push({ y: it.y, cels: [it] });
      });
      linhas.forEach(function (l) { l.cels.sort(function (a, b) { return a.x - b.x; }); l.texto = l.cels.map(function (c) { return c.s; }).join(" "); });
      return linhas;
    });
  }
  function lerRelatorioPDF(buf) {
    return carregarPdfJs().then(function (pdfjs) { return pdfjs.getDocument({ data: buf }).promise; }).then(function (pdf) {
      var paginas = [];
      for (var n = 1; n <= pdf.numPages; n++) paginas.push(pdf.getPage(n).then(linhasDaPagina));
      return Promise.all(paginas);
    }).then(function (paginas) {
      var brutos = [], achouCabecalho = false;
      paginas.forEach(function (linhas) {
        var colDevido = null;
        linhas.forEach(function (l) {
          var cab = l.cels.filter(function (c) { return /^devido$/i.test(c.s); })[0];
          if (cab && l.cels.some(function (c) { return /^c[oó]digo$/i.test(c.s); })) { colDevido = cab.cx; achouCabecalho = true; return; }
          var m = l.texto.match(/^(\d{1,12})\s+(.+?)\s+(\d{2}\/\d{2}\/\d{4})\s+(.*)$/);
          if (!m || !/[A-Za-zÀ-ú]/.test(m[2])) return;
          var nums = l.cels.filter(function (c) { return /^-?[\d.]*\d[.,]\d{2}$/.test(c.s); });
          if (!nums.length) return;
          var dev = nums[nums.length - 1];
          if (colDevido != null) nums.forEach(function (c) { if (Math.abs(c.cx - colDevido) < Math.abs(dev.cx - colDevido)) dev = c; });
          brutos.push({ ra: m[1], nome: m[2].trim(), valorAberto: parseMoneyBR(dev.s), vencimento: parseDateBR(m[3]), turma: "", responsavel: "", telefone: "", email: "" });
        });
      });
      return { brutos: brutos, cabecalho: achouCabecalho };
    });
  }
  function processarPDF(buf) {
    var out = $("importResult");
    confirmouPeriodo = false; simulado = false;
    out.innerHTML = '<div class="import-summary">Lendo o PDF…</div>';
    $("btnConfirmImport").disabled = true;
    // Painel/Contraturno: primeiro tenta o leitor próprio do relatório de Inadimplência
    var especifico = modoImport === "alunos" ? lerRelatorioPDF(buf) : Promise.resolve(null);
    especifico.then(function (r) {
      if (r && r.brutos.length) {
        return mostrarPreviaAlunos(r.brutos, " Valor em aberto = coluna <b>Devido</b> do relatório (saldo + multa + juros). No PDF os nomes longos vêm cortados; para quem já está cadastrado, o nome completo é mantido.");
      }
      // qualquer outro relatório em tabela: vira linhas e colunas e segue o mesmo caminho do CSV
      return pdfParaTabela(buf).then(function (p) {
        if (!p) {
          out.innerHTML = '<div class="import-summary" style="color:var(--danger)">Não encontrei uma tabela com cabeçalho neste PDF (ex.: colunas RA, Nome, Vencimento, Valor…). ' +
            "Se o PDF for uma imagem digitalizada, exporte de novo direto do sistema, ou use o CSV.</div>";
          return;
        }
        processarTabela(p);
        var aviso = document.createElement("div");
        aviso.className = "import-summary";
        aviso.textContent = "Lido do PDF: " + p.rows.length + " linha(s) em " + p.paginas + " página(s). Confira a prévia; se alguma coluna vier trocada, use o CSV do mesmo relatório.";
        out.appendChild(aviso);
      });
    }).catch(function (x) {
      out.innerHTML = '<div class="import-summary" style="color:var(--danger)">Não consegui ler este PDF: ' + esc(x.message || x) + "</div>";
    });
  }

  // Leitor genérico de tabela em PDF. O PDF não tem células, só texto posicionado:
  // 1) acha a linha de cabeçalho (a que mais parece nomes de coluna, juntando títulos em 2 linhas);
  // 2) cada coluna começa onde começa o seu título; números (alinhados à direita) vão para a
  //    coluna cujo título termina mais perto de onde o número termina;
  // 3) texto que invade a coluna seguinte (ex.: "14881 NOME DO ALUNO") é separado por palavra;
  // 4) linha que só continua o texto da anterior (nome quebrado em 2 linhas) é juntada a ela.
  function pdfParaTabela(buf) {
    return carregarPdfJs().then(function (pdfjs) { return pdfjs.getDocument({ data: buf }).promise; }).then(function (pdf) {
      var paginas = [];
      for (var n = 1; n <= pdf.numPages; n++) paginas.push(pdf.getPage(n).then(linhasDaPagina));
      return Promise.all(paginas);
    }).then(function (paginas) {
      var cols = null, rows = [];
      function ehNumero(s) { return /^-?(R\$\s*)?[\d.]*\d([.,]\d{1,2})?$/.test(s) && !/^\d{2}\/\d{2}/.test(s); }
      function juntarPerto(cels) {
        // junta pedaços do mesmo título/célula separados só por um espaço
        var out = [];
        cels.forEach(function (c) {
          var u = out[out.length - 1];
          if (u && c.x - (u.x + u.w) < Math.max(2, (c.h || 8) * 0.35)) { u.s += " " + c.s; u.w = c.x + c.w - u.x; }
          else out.push({ x: c.x, w: c.w, h: c.h, s: c.s });
        });
        return out;
      }
      function acharCabecalho(linhas) {
        var melhor = null;
        linhas.forEach(function (l, i) {
          var cs = juntarPerto(l.cels);
          if (cs.length < 3) return;
          var sc = scoreHeader(cs.map(function (c) { return c.s; }));
          if (sc >= 2 && (!melhor || sc > melhor.sc)) melhor = { i: i, sc: sc, cs: cs };
        });
        if (!melhor) return null;
        var cab = melhor.cs.map(function (c) { return { x: c.x, fim: c.x + c.w, s: c.s }; }), usadas = [melhor.i];
        // título em duas linhas: completa com a linha logo acima/abaixo (só texto, perto)
        [melhor.i - 1, melhor.i + 1].forEach(function (j) {
          var l = linhas[j]; if (!l) return;
          var lim = (l.cels[0].h || 8) * 1.8;
          if (Math.abs(l.y - linhas[melhor.i].y) > lim || l.cels.some(function (c) { return ehNumero(c.s); })) return;
          var ok = false;
          juntarPerto(l.cels).forEach(function (c) {
            var meio = c.x + c.w / 2, alvo = null;
            cab.forEach(function (k) { if (meio >= k.x - 6 && meio <= k.fim + 6) alvo = k; });
            if (alvo) { alvo.s = j < melhor.i ? c.s + " " + alvo.s : alvo.s + " " + c.s; alvo.x = Math.min(alvo.x, c.x); alvo.fim = Math.max(alvo.fim, c.x + c.w); ok = true; }
          });
          if (ok) usadas.push(j);
        });
        return { cab: cab, ate: Math.max.apply(null, usadas) };
      }
      // Coluna de um pedaço de texto: a do título que fica em cima dele (maior sobreposição
      // horizontal — vale para título alinhado à esquerda, centralizado ou à direita). Sem
      // sobreposição: número vai para o título que termina mais perto; texto, para o centro mais perto.
      function sobrepoe(a0, a1, c) { return Math.max(0, Math.min(a1, c.fim) - Math.max(a0, c.x)); }
      function colunasSob(x0, x1) { return cols.map(function (c, i) { return { i: i, s: sobrepoe(x0, x1, c) }; }).filter(function (o) { return o.s > 0; }); }
      function colunaDaCelula(x0, x1, numero) {
        var sob = colunasSob(x0, x1);
        if (sob.length) return sob.sort(function (a, b) { return b.s - a.s; })[0].i;
        var k = 0, d = Infinity, meio = (x0 + x1) / 2;
        cols.forEach(function (c, i) { var dd = numero ? Math.abs(c.fim - x1) : Math.abs((c.x + c.fim) / 2 - meio); if (dd < d) { d = dd; k = i; } });
        return k;
      }
      paginas.forEach(function (linhas) {
        var achado = acharCabecalho(linhas), inicio = 0;
        if (achado) { cols = achado.cab; inicio = achado.ate + 1; }
        if (!cols) return;
        var daPagina = [];
        for (var i = inicio; i < linhas.length; i++) {
          var l = linhas[i], vals = cols.map(function () { return []; });
          l.cels.forEach(function (c) {
            var x1 = c.x + c.w;
            if (ehNumero(c.s)) { vals[colunaDaCelula(c.x, x1, true)].push(c.s); return; }
            if (colunasSob(c.x, x1).length >= 2 && c.s.indexOf(" ") !== -1) {
              // um pedaço que fica embaixo de dois títulos (ex.: "14881 NOME DO ALUNO"): separa as
              // palavras pela posição estimada; palavra que não fica sob título nenhum segue a anterior
              var larg = c.w / c.s.length, pos = 0, atual = null;
              c.s.split(" ").forEach(function (p) {
                if (p) {
                  var p0 = c.x + pos * larg, p1 = p0 + p.length * larg, sob = colunasSob(p0, p1);
                  atual = sob.length ? sob.sort(function (a, b) { return b.s - a.s; })[0].i : (atual != null ? atual : colunaDaCelula(p0, p1, false));
                  vals[atual].push(p);
                }
                pos += p.length + 1;
              });
            } else vals[colunaDaCelula(c.x, x1, false)].push(c.s);
          });
          var row = vals.map(function (v) { return v.join(" "); });
          var cheias = row.filter(Boolean).length;
          if (!cheias) continue;
          // pedaço de texto quebrado (ex.: nome em 2 linhas): sem a 1ª coluna, sem números e com poucas células
          var frag = !row[0] && cheias <= Math.max(1, cols.length / 3) && !l.cels.some(function (c) { return ehNumero(c.s); });
          daPagina.push({ y: l.y, h: l.cels[0].h || 8, row: row, frag: frag });
        }
        // Cada pedaço vai para a linha de dados mais próxima, acima OU abaixo: planilhas exportadas
        // com alinhamento embaixo põem o começo do nome na linha de cima. Pedaço longe de tudo
        // (título, rodapé) é descartado.
        var cheiasPag = daPagina.filter(function (d) { return !d.frag; });
        cheiasPag.forEach(function (c) { c.partes = [c]; });
        // cada pedaço segue a linha vizinha mais perto (as linhas de uma mesma célula ficam mais
        // juntas que duas linhas da tabela); a corrente de pedaços termina numa linha de dados
        daPagina.forEach(function (d, i) {
          if (!d.frag) return;
          var ant = daPagina[i - 1], prox = daPagina[i + 1];
          var ga = ant ? d.y - ant.y : Infinity, gp = prox ? prox.y - d.y : Infinity;
          var viz = ga < gp || (ga === gp && ant && !ant.frag) ? ant : prox, gap = Math.min(ga, gp);
          d.segue = viz && gap <= d.h * 2.6 ? viz : null;
        });
        daPagina.forEach(function (d) {
          if (!d.frag) return;
          var alvo = d.segue, passos = 0;
          while (alvo && alvo.frag && passos++ < 10) alvo = alvo.segue;
          if (alvo && !alvo.frag) alvo.partes.push(d);
        });
        cheiasPag.forEach(function (c) {
          // junta as partes de cima para baixo, coluna por coluna
          c.partes.sort(function (a, b) { return a.y - b.y; });
          rows.push(cols.map(function (x, k) { return c.partes.map(function (p) { return p.row[k]; }).filter(Boolean).join(" "); }));
        });
      });
      if (!cols) return null;
      var raw = cols.map(function (c) { return c.s; });
      // cabeçalho repetido nas páginas seguintes não é dado
      var hn = raw.map(normHeader).join("|");
      rows = rows.filter(function (r) { return r.map(normHeader).join("|") !== hn; });
      return { headers: raw.map(normHeader), raw: raw, rows: rows, paginas: paginas.length };
    });
  }
  function ehPDF(f) { return /\.pdf$/i.test(f.name || "") || f.type === "application/pdf"; }
  function receberArquivoImport(f) {
    if (!ehPDF(f)) return lerArquivo(f, processarCSV);
    var r = new FileReader(); r.onload = function () { processarPDF(new Uint8Array(r.result)); }; r.readAsArrayBuffer(f);
  }
  function mostrarErroImport(msg) {
    var el = document.getElementById("erroImport") || document.createElement("div");
    el.id = "erroImport"; el.className = "form-err"; el.hidden = false; el.textContent = "Não foi possível importar: " + msg;
    $("importResult").prepend(el);
  }
  function abrirImportacao(modo) {
    modoImport = modo; confirmouPeriodo = false; simulado = false;
    $("impEspelhar").checked = true; // sempre começa marcado: o período fica igual ao arquivo
    pendentes = []; $("importResult").innerHTML = ""; $("pasteArea").value = ""; $("fileInput").value = "";
    var b = $("btnConfirmImport");
    b.disabled = true; b.hidden = false; b.textContent = modo === "serasa" ? "Importar parcelas" : modo === "base" ? "Importar para a base" : "Importar alunos";
    $("mImpT").textContent = modo === "serasa" ? "Importar planilha — Serasa" : modo === "base" ? "Importar relatório de alunos — Base de dados" : carteira === "contraturno" ? "Importar planilha — Contraturno" : "Importar planilha";
    $("mImpSub").textContent = modo === "base"
      ? "Envie o relatório total de alunos em CSV ou PDF. Só são importados: aluno, matrícula, descrição da turma e nome, e-mail e telefone do responsável financeiro. As demais colunas (dados sensíveis) são ignoradas e não saem do seu computador."
      : modo === "serasa"
      ? "Envie uma aba da planilha em CSV ou PDF (RA, Nome, Vencimento, Valor, Mentor, Serasa, Data inclusão). Também aceita Responsável financeiro, CPF, Tipo, Resp. inclusão e Período."
      : "Envie o relatório " + (carteira === "contraturno" ? "do contraturno" : "de cobrança") + " em CSV ou PDF (RA, Nome, Turma, Responsável, Telefone, E-mail, Valor em aberto, Vencimento). O PDF do relatório de Inadimplência do sistema também é aceito.";
    $("impPeriodoWrap").hidden = modo !== "serasa";
    $("impPeriodo").disabled = false;
    $("impPeriodoHint").textContent = "Todas as linhas do arquivo vão para este período. Se o período ainda não existe, crie em “+ Novo período” antes.";
    if (modo === "serasa") {
      fill($("impPeriodo"), opcoesPeriodos(), periodos.length ? "Escolha o período…" : "Nenhum período criado ainda");
      // já vem escolhido o período que está aberto no filtro
      if (periodoAtual()) $("impPeriodo").value = periodoSel;
    }
    abrir("mImportar");
  }
  $("btnImportar").addEventListener("click", function () { abrirImportacao("alunos"); });
  $("impEspelhar").addEventListener("change", function () { simulado = false; var b = $("btnConfirmImport"); if (!b.hidden && pendentes.length) b.textContent = "Importar parcelas"; });
  $("impPeriodo").addEventListener("change", function () {
    simulado = false;
    // o aviso aparece uma vez por arquivo; depois dele, vale o período que a pessoa escolher
    var b = $("btnConfirmImport");
    if (!b.hidden && pendentes.length) b.textContent = confirmouPeriodo ? "Importar em " + nomeDoPeriodo(this.value) : "Importar parcelas";
  });
  function lerArquivo(f, cb) { var r = new FileReader(); r.onload = function () { cb(String(r.result)); }; r.readAsText(f, "utf-8"); }
  function ligarDropzone(dz, input, cb, porArquivo) {
    var receber = porArquivo || function (f) { lerArquivo(f, cb); };
    dz.addEventListener("click", function (e) { if (e.target !== input) input.click(); });
    dz.addEventListener("dragover", function (e) { e.preventDefault(); dz.classList.add("drag"); });
    dz.addEventListener("dragleave", function () { dz.classList.remove("drag"); });
    dz.addEventListener("drop", function (e) { e.preventDefault(); dz.classList.remove("drag"); var f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) receber(f); });
    input.addEventListener("change", function () { if (input.files && input.files[0]) receber(input.files[0]); });
  }
  ligarDropzone($("dropzone"), $("fileInput"), processarCSV, receberArquivoImport);
  $("btnProcessPaste").addEventListener("click", function () { var t = $("pasteArea").value; if (!t.trim()) return toast("Cole o conteúdo do CSV antes de processar."); processarCSV(t); });

  $("btnConfirmImport").addEventListener("click", function () {
    if (!pendentes.length) return;
    var btn = this; btn.disabled = true; btn.textContent = "Importando…";
    if (modoImport === "base") return importarBaseEmPartes(btn).catch(function (x) { btn.disabled = false; btn.textContent = "Importar para a base"; toast(x.message); });
    if (modoImport === "serasa") {
      var destino = $("impPeriodo").value;
      var temColunaPeriodo = pendentes.some(function (l) { return l.periodo; });
      if (!temColunaPeriodo && !destino) {
        btn.disabled = false; btn.textContent = "Importar parcelas";
        $("impPeriodo").focus();
        return toast("Escolha para qual período (aba) vão estas parcelas.");
      }
      // Proteção: se os vencimentos do arquivo não combinam com as datas do período escolhido,
      // pede confirmação (evita mandar a aba errada para o período errado).
      var alvo = null; periodos.forEach(function (p) { if (p.id === destino) alvo = p; });
      if (!temColunaPeriodo && alvo && !confirmouPeriodo) {
        var dentro = pendentes.filter(function (l) { return l.vencimento >= alvo.inicio && l.vencimento <= alvo.fim; }).length;
        if (dentro < pendentes.length / 2) {
          var vs = pendentes.map(function (l) { return l.vencimento; }).sort();
          var sugestao = null, melhor = 0;
          periodos.forEach(function (p) {
            var n = pendentes.filter(function (l) { return l.vencimento >= p.inicio && l.vencimento <= p.fim; }).length;
            if (n > melhor) { melhor = n; sugestao = p; }
          });
          var aviso = document.getElementById("avisoImport") || document.createElement("div");
          aviso.id = "avisoImport"; aviso.className = "aviso-import";
          aviso.innerHTML = "<b>Confira o período.</b> As parcelas deste arquivo vencem entre " + br(vs[0]) + " e " + br(vs[vs.length - 1]) +
            ", mas o período escolhido é <b>" + esc(alvo.nome) + "</b> (" + br(alvo.inicio) + " a " + br(alvo.fim) + ")." +
            (sugestao && sugestao.id !== alvo.id ? " Pelas datas, parece ser do período <b>" + esc(sugestao.nome) + "</b> — já troquei acima; confira antes de importar." : " Confira antes de importar.");
          $("importResult").prepend(aviso);
          confirmouPeriodo = true;
          btn.disabled = false;
          if (sugestao && sugestao.id !== alvo.id) { $("impPeriodo").value = sugestao.id; btn.textContent = "Importar em " + sugestao.nome; }
          else btn.textContent = "Importar mesmo assim";
          return;
        }
      }
      var espelhar = $("impEspelhar").checked;
      if (espelhar && !simulado) {
        // 1º clique: mostra o que vai mudar no período, sem gravar nada
        return api("POST", "/api/serasa/importar", { linhas: pendentes, periodoId: destino, espelhar: true, simular: true }).then(function (d) {
          simulado = true;
          var html = '<div class="aviso-import" id="avisoEspelho"><b>Conferência antes de gravar' + (temColunaPeriodo ? "" : " — período " + esc(nomeDoPeriodo(destino))) + ":</b> " +
            d.criados + " parcela(s) nova(s), " + d.atualizados + " atualizada(s), " + d.iguais + " já iguais." +
            (d.copiasApagadas || d.paraSemPeriodo ? " <b>Saem do período " + (d.copiasApagadas + d.paraSemPeriodo) + " parcela(s)</b> que não estão no arquivo: " +
              d.copiasApagadas + " cópia(s) apagada(s) e " + d.paraSemPeriodo + " para “Sem período”." : " Nada sai do período.") +
            " Depois disso o período fica com <b>" + (Object.keys(d.porPeriodo).reduce(function (s, k) { return s + d.porPeriodo[k]; }, 0)) + "</b> parcela(s), como no arquivo.</div>" +
            (d.saem && d.saem.length ? '<div class="import-preview" style="margin-top:8px"><table><thead><tr><th>Sai do período</th><th>RA</th><th>Vencimento</th><th>Valor</th><th>Destino</th></tr></thead><tbody>' +
              d.saem.map(function (s) { return "<tr><td>" + esc(s.nome) + "</td><td>" + esc(s.ra) + "</td><td>" + br(s.vencimento) + '</td><td class="tabular">' + money(s.valor) + "</td><td>" + esc(s.destino) + "</td></tr>"; }).join("") + "</tbody></table></div>" : "");
          var velho = document.getElementById("avisoEspelhoWrap"); if (velho) velho.remove();
          var box = document.createElement("div"); box.id = "avisoEspelhoWrap"; box.innerHTML = html;
          $("importResult").prepend(box);
          btn.disabled = false; btn.textContent = "Confirmar e importar";
        }).catch(function (x) { btn.disabled = false; btn.textContent = "Importar parcelas"; toast(x.message); mostrarErroImport(x.message); });
      }
      return api("POST", "/api/serasa/importar", { linhas: pendentes, periodoId: destino, espelhar: espelhar }).then(function (d) {
        btn.hidden = true;
        var partes = [];
        if (d.periodosCriados && d.periodosCriados.length) partes.push("<b>" + d.periodosCriados.length + "</b> período(s) criado(s): " + d.periodosCriados.map(esc).join(", "));
        partes.push("<b>" + d.criados + "</b> parcela(s) nova(s)");
        partes.push("<b>" + d.atualizados + "</b> atualizada(s) com o que veio na planilha");
        if (d.copiasApagadas) partes.push("<b>" + d.copiasApagadas + "</b> cópia(s) apagada(s)");
        if (d.paraSemPeriodo) partes.push("<b>" + d.paraSemPeriodo + "</b> que não estavam no arquivo foram para “Sem período”");
        if (d.iguais) partes.push("<b>" + d.iguais + "</b> já estavam no painel exatamente iguais (nada a mudar)");
        if (d.repetidas) partes.push(d.repetidas + " linha(s) iguais a outra da mesma aba (importadas também, como na planilha)");
        if (d.incompletas) partes.push(d.incompletas + " sem nome ou vencimento (não importadas)");
        var nada = !d.criados && !d.atualizados;
        $("importResult").innerHTML = '<div class="import-summary" style="color:var(--ink)">' + partes.join(" · ") + ".</div>" +
          (nada ? '<div class="import-summary">Nenhuma parcela precisou mudar: o painel já tem estes dados. Parcelas que a equipe já marcou no painel não são sobrescritas por campos vazios da planilha.</div>' : "") +
          '<div class="m-foot" style="justify-content:flex-start"><button type="button" class="btn primary small" id="btnVerImportadas">Ver estas parcelas</button></div>';
        $("btnVerImportadas").addEventListener("click", function () { fecharModais(); });
        toast(nada ? "Nada a atualizar: as parcelas já estavam no painel." : "Planilha da Serasa importada.");
        return carregar().then(function () { mostrarImportadas(d.porPeriodo || {}); });
      }).catch(function (x) { btn.disabled = false; btn.textContent = "Importar parcelas"; toast(x.message); mostrarErroImport(x.message); });
    }
    api("POST", "/api/alunos/importar", { linhas: pendentes, carteira: carteira }).then(function (d) {
      btn.hidden = true;
      mostrarConciliacao(d);
      return carregar();
    }).catch(function (x) { btn.disabled = false; btn.textContent = "Importar alunos"; toast(x.message); });
  });
  function mostrarConciliacao(d) {
    var html = '<div class="import-summary" style="color:var(--ink)"><b>' + d.criados + "</b> aluno(s) novo(s) cadastrado(s) · <b>" + d.atualizados + "</b> já existiam e foram atualizados.</div>";
    if (d.daBase) html += '<div class="import-summary">' + d.daBase + " aluno(s) completados com os dados da <b>Base de dados</b> (nome completo, turma, responsável e contato).</div>";
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
    $("anoEvolTable").innerHTML = "<thead><tr><th>Mês</th><th>Total recuperado</th></tr></thead><tbody>" + rows.join("") + '</tbody><tfoot><tr><td>Total do ano</td><td class="tabular">' + (tot ? money(tot) : "—") + "</td></tr></tfoot>";
  }
  // As mensalidades negociadas contam no mês da MENSALIDADE (ex.: janeiro), não no mês
  // em que o atendimento aconteceu.
  function renderMensalidadesEvol() {
    var ano = prepararSelect($("mensEvolAnoSel"), anosDisponiveis(true).map(function (y) { return { v: y, l: y }; }), String(new Date().getFullYear()));
    var por = {}, tot = { total: 0 };
    NEG_TIPOS.forEach(function (tp) { tot[tp.k] = 0; });
    atends.forEach(function (a) {
      (a.mensalidadesNegociadas || []).forEach(function (m) {
        if (!m.mes || m.mes.slice(0, 4) !== ano) return;
        var k = m.mes.slice(5, 7), tp = tipoNeg(m.tipo || "mensalidade").k, v = Number(m.valor) || 0;
        por[k] = por[k] || { total: 0 }; por[k][tp] = (por[k][tp] || 0) + v; por[k].total += v; tot[tp] += v; tot.total += v;
      });
    });
    function cel(v, cls) { return '<td class="tabular' + (v ? " " + (cls || "") : "") + '">' + (v ? money(v) : "—") + "</td>"; }
    var rows = MESES.map(function (n, i) {
      var p = por[pad2(i + 1)] || {};
      return "<tr><td>" + cap(n) + "</td>" + NEG_TIPOS.map(function (tp) { return cel(p[tp.k]); }).join("") + cel(p.total, "rec") + "</tr>";
    });
    $("mensEvolTable").innerHTML = "<thead><tr><th>Mês</th>" + NEG_TIPOS.map(function (tp) { return "<th>" + tp.l + "</th>"; }).join("") + "<th>Total</th></tr></thead><tbody>" + rows.join("") +
      "</tbody><tfoot><tr><td>Total do ano</td>" + NEG_TIPOS.map(function (tp) { return cel(tot[tp.k]); }).join("") + cel(tot.total) + "</tr></tfoot>";
  }

  function renderControleDiario() {
    var set = {}; set[mesAtual()] = 1; atends.forEach(function (a) { if (a.data) set[a.data.slice(0, 7)] = 1; });
    var meses = Object.keys(set).sort().reverse();
    var mesSel = prepararSelect($("ctrlMesSel"), meses.map(function (m) { return { v: m, l: cap(MESES[parseInt(m.slice(5, 7), 10) - 1]) + "/" + m.slice(0, 4) }; }), mesAtual());
    var ano = parseInt(mesSel.slice(0, 4), 10), mesN = parseInt(mesSel.slice(5, 7), 10);
    var doMes = atends.filter(function (a) { return a.data && a.data.slice(0, 7) === mesSel; });
    var tb = $("ctrlTable");
    // colunas só para atendimentos com atendente identificada (registros antigos sem nome ficam de fora)
    var semNome = doMes.filter(function (a) { var n = (a.responsavel || "").trim(); return !n || n === "—"; }).length;
    $("ctrlNota").textContent = semNome ? semNome + " atendimento(s) deste mês sem atendente identificada não aparecem nesta tabela." : "";
    var doMesFaixa = doMes;
    doMes = doMes.filter(function (a) { var n = (a.responsavel || "").trim(); return n && n !== "—"; });
    if (!doMes.length) { tb.innerHTML = '<tbody><tr><td class="empty-ctrl">Nenhum atendimento registrado neste mês ainda.</td></tr></tbody>'; renderFaixa(doMesFaixa); return; }

    var porAt = {}; doMes.forEach(function (a) { var k = a.responsavel; porAt[k] = (porAt[k] || 0) + 1; });
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
    renderFaixa(doMesFaixa);
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
  $("btnEvolAtualizar").addEventListener("click", function () { var b = this; b.disabled = true; carregar().then(function () { b.disabled = false; toast("Evolução atualizada."); }); });

  // ---------------------------------------------------------------- Base de dados
  // Cadastro completo dos alunos (relatório total do sistema). O servidor usa esta base para
  // completar os dados do Painel, do Contraturno e do Serasa a cada importação.
  var baseAlunos = [], baseUltima = null, baseCarregada = false, baseLimite = 300, baseFiltrada = [];
  function carregarBaseDados() {
    return api("GET", "/api/base").then(function (d) {
      baseAlunos = d.alunos; baseUltima = d.ultimaImportacao; baseCarregada = true;
      if (view === "base") renderBase();
    }).catch(function (x) { if (x.status !== 401 && x.status !== 403) toast(x.message); });
  }
  // Em quais abas o aluno aparece (pelo RA; sem RA, pelo nome)
  function indiceAbas() {
    var ix = { ra: {}, nome: {} };
    function marca(ra, nome, aba) {
      if (ra) (ix.ra[String(ra).trim().toLowerCase()] = ix.ra[String(ra).trim().toLowerCase()] || {})[aba] = 1;
      var n = normNome(nome); if (n) (ix.nome[n] = ix.nome[n] || {})[aba] = 1;
    }
    Object.keys(alunos).forEach(function (id) { var a = alunos[id]; if (!a.arquivado) marca(a.ra, a.nome, carteiraDe(a)); });
    parcelas.forEach(function (x) { marca(x.ra, x.nome, "serasa"); });
    return function (b) {
      var out = {}, a = b.ra ? ix.ra[b.ra.trim().toLowerCase()] : null, n = ix.nome[normNome(b.nome)];
      [a, n].forEach(function (o) { if (o) Object.keys(o).forEach(function (k) { out[k] = 1; }); });
      return out;
    };
  }
  var ABAS_NOME = { regular: "Painel", contraturno: "Contraturno", serasa: "Serasa" };
  function tagsAbas(abas) {
    var t = ["regular", "contraturno", "serasa"].filter(function (k) { return abas[k]; });
    return t.length ? t.map(function (k) { return '<span class="tag">' + ABAS_NOME[k] + "</span>"; }).join(" ") : '<span class="muted">—</span>';
  }
  function renderBase() {
    if (!baseCarregada) { $("baseTbody").innerHTML = '<tr><td colspan="6" class="empty">Carregando…</td></tr>'; return; }
    var b = baseAlunos, n = b.length;
    function conta(f) { return b.filter(function (x) { return x[f]; }).length; }
    $("baseKpis").innerHTML = [
      { n: n, l: "Alunos na base", cls: "lead" },
      { n: conta("responsavel"), l: "Com responsável financeiro" },
      { n: conta("telefone"), l: "Com telefone" },
      { n: conta("email"), l: "Com e-mail" }
    ].map(function (t) { return '<div class="kpi ' + (t.cls || "") + '"><div class="num tabular">' + t.n + '</div><div class="lbl">' + t.l + "</div></div>"; }).join("");
    $("baseSub").textContent = baseUltima
      ? "Última importação em " + br(baseUltima.em) + " às " + new Date(baseUltima.em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) + " por " + baseUltima.por + " · completa automaticamente o Painel, o Contraturno e o Serasa"
      : "Alunos e responsáveis financeiros — completa automaticamente o Painel, o Contraturno e o Serasa";
    var turmas = {};
    b.forEach(function (x) { if (x.turma) turmas[x.turma] = 1; });
    prepararSelect($("bTurma"), [{ v: "", l: "Todas as turmas" }].concat(Object.keys(turmas).sort().map(function (t) { return { v: esc(t), l: esc(t) }; })), "");
    var q = $("bBusca").value.trim().toLowerCase(), qDig = q.replace(/\D/g, ""), ft = $("bTurma").value, fa = $("bAba").value;
    var abasDe = indiceAbas();
    baseFiltrada = b.filter(function (x) {
      if (ft && x.turma !== ft) return false;
      if (fa) { var ab = abasDe(x); if (fa === "nenhuma" ? Object.keys(ab).length : !ab[fa]) return false; }
      if (q) {
        var hay = [x.ra, x.nome, x.responsavel, x.email, x.turma].join(" ").toLowerCase();
        var digOk = qDig.length >= 4 && (x.telefone || "").replace(/\D/g, "").indexOf(qDig) !== -1;
        if (hay.indexOf(q) === -1 && !digOk) return false;
      }
      return true;
    });
    $("baseCount").textContent = baseFiltrada.length + (baseFiltrada.length === 1 ? " aluno" : " alunos");
    var tb = $("baseTbody");
    if (!baseFiltrada.length) {
      tb.innerHTML = '<tr><td colspan="6" class="empty"><b>' + (n ? "Nenhum aluno com estes filtros" : "A base ainda está vazia") + '</b><div class="muted">' +
        (n ? "Ajuste a busca ou os filtros acima." : "Importe o relatório total de alunos do sistema em “Importar relatório de alunos”.") + "</div></td></tr>";
    } else {
      tb.innerHTML = baseFiltrada.slice(0, baseLimite).map(function (x) {
        return '<tr class="click" data-id="' + esc(x.id) + '"><td class="tabular">' + (esc(x.ra) || '<span class="muted">—</span>') + '</td><td><div class="nome">' + esc(x.nome) + "</div>" +
          "</td><td>" + (esc(x.turma) || '<span class="muted">—</span>') + "</td>" +
          "<td>" + (esc(x.responsavel) || '<span class="muted">—</span>') + "</td>" +
          "<td>" + (x.telefone ? '<div class="tabular">' + esc(x.telefone) + "</div>" : "") + (x.email ? '<div class="meta">' + esc(x.email) + "</div>" : "") + (!x.telefone && !x.email ? '<span class="muted">—</span>' : "") + "</td>" +
          "<td>" + tagsAbas(abasDe(x)) + "</td></tr>";
      }).join("");
    }
    $("baseMais").hidden = baseFiltrada.length <= baseLimite;
    $("baseMais").textContent = "Mostrar mais (" + (baseFiltrada.length - baseLimite) + " restantes)";
  }
  ["bBusca", "bTurma", "bAba"].forEach(function (id) { $(id).addEventListener("input", function () { baseLimite = 300; renderBase(); }); });
  $("baseMais").addEventListener("click", function () { baseLimite += 300; renderBase(); });
  $("baseTbody").addEventListener("click", function (e) {
    var tr = e.target.closest("tr[data-id]"); if (!tr) return;
    var x = null; baseAlunos.forEach(function (y) { if (y.id === tr.getAttribute("data-id")) x = y; });
    if (!x) return;
    $("bsTitulo").textContent = x.nome;
    $("bsSub").textContent = [x.ra ? "Matrícula " + x.ra : "", x.turma].filter(Boolean).join(" · ");
    var abas = indiceAbas()(x);
    $("bsAbas").innerHTML = "Aparece em: " + tagsAbas(abas);
    var campos = [["Matrícula", x.ra], ["Aluno", x.nome], ["Descrição da turma", x.turma], ["Responsável financeiro", x.responsavel], ["E-mail do resp. financeiro", x.email], ["Telefone do resp. financeiro", x.telefone]];
    $("bsDados").innerHTML = campos.filter(function (c) { return c[1]; }).map(function (c) { return "<dt>" + esc(c[0]) + "</dt><dd>" + esc(c[1]) + "</dd>"; }).join("");
    $("bsAtualizado").textContent = x.atualizadoEm ? "Atualizado em " + br(x.atualizadoEm) + (x.atualizadoPor ? " por " + x.atualizadoPor : "") + " (importação do relatório)" : "";
    abrir("mBase");
  });
  $("btnBaseImportar").addEventListener("click", function () { abrirImportacao("base"); });
  $("btnBaseExportar").addEventListener("click", function () {
    var lista = baseFiltrada.length ? baseFiltrada : baseAlunos;
    var cab = ["MATRÍCULA", "ALUNO", "DESCRIÇÃO DA TURMA", "RESPONSÁVEL FINANCEIRO", "E-MAIL DO RESP. FINANCEIRO", "TELEFONE DO RESP. FINANCEIRO"];
    var linhas = lista.map(function (x) { return [x.ra, x.nome, x.turma, x.responsavel, x.email, x.telefone].map(csvCampo).join(";"); });
    baixar("base_alunos_" + hoje() + ".csv", cab.map(csvCampo).join(";") + "\n" + linhas.join("\n"));
    toast("Base exportada (" + linhas.length + " alunos).");
  });

  // Relatório de alunos: a base guarda SÓ estes campos (os demais são dados sensíveis e nem
  // saem do navegador): aluno, matrícula, descrição da turma e nome, e-mail e telefone do
  // responsável financeiro. A coluna é escolhida pelo nome do cabeçalho: primeiro o nome
  // exato, depois "contém", evitando colunas de outro assunto (ex.: telefone do aluno).
  function colunaBase(h, exatos, contem, evitar) {
    evitar = evitar || [];
    function ok(c) { return c && !evitar.some(function (e) { return c.indexOf(e) !== -1; }); }
    for (var i = 0; i < exatos.length; i++) { var j = h.indexOf(exatos[i]); if (j !== -1) return j; }
    for (var m = 0; m < contem.length; m++) for (var k = 0; k < h.length; k++) if (ok(h[k]) && h[k].indexOf(contem[m]) !== -1) return k;
    return -1;
  }
  // colunas de contato do responsável financeiro (todas as que houver, ex.: celular e telefone)
  function colunasContatoResp(h, tipos) {
    function achar(filtro) {
      var out = [];
      h.forEach(function (c, i) { if (c && tipos.some(function (t) { return c.indexOf(t) !== -1; }) && filtro(c)) out.push(i); });
      return out;
    }
    var fin = achar(function (c) { return c.indexOf("financ") !== -1; });
    return fin.length ? fin : achar(function (c) { return /resp/.test(c) && !/pedag|academ|mae|pai/.test(c); });
  }
  var BASE_CAMPOS_IMP = [["ra", "Matrícula"], ["nome", "Aluno"], ["turma", "Descrição da turma"], ["responsavel", "Responsável financeiro"], ["email", "E-mail do resp. financeiro"], ["telefone", "Telefone do resp. financeiro"]];
  function processarCSVBase(p) {
    var h = p.headers, out = $("importResult");
    var ix = {
      ra: colunaBase(h, ["matricula", "ra", "codigo", "codigo do aluno", "cod. aluno", "registro academico"], ["matricula", "codigo do aluno", "cod. aluno"], ["resp", "turma", "curso", "data", "situacao", "tipo"]),
      nome: colunaBase(h, ["aluno", "nome do aluno", "nome", "nome completo", "nome aluno", "nome completo do aluno"], ["nome do aluno", "aluno"], ["resp", "mae", "pai", "social", "cpf", "codigo", "matricula", "mail", "tel", "nasc"]),
      turma: colunaBase(h, ["descricao da turma", "turma", "descricao turma"], ["descricao da turma", "turma"], ["cod", "id "]),
      responsavel: colunaBase(h, ["nome do responsavel financeiro", "responsavel financeiro", "nome resp. financeiro", "resp. financeiro", "resp financeiro"], ["nome do responsavel financeiro", "responsavel financeiro", "resp. financeiro", "resp financeiro"], ["cpf", "tel", "cel", "fone", "mail", "rg", "cod", "endereco", "nasc", "profiss"])
    };
    var tels = colunasContatoResp(h, ["telefone", "celular", "fone", "whats"]), mails = colunasContatoResp(h, ["e-mail", "email"]);
    if (ix.nome === -1) {
      out.innerHTML = '<div class="import-summary" style="color:var(--danger)">Não encontrei a coluna com o nome do aluno. Colunas identificadas: ' + esc((p.raw || []).filter(Boolean).join(", ") || "nenhuma") + ".</div>";
      $("btnConfirmImport").disabled = true; return;
    }
    function c(r, i) { return i !== -1 ? (r[i] || "").trim() : ""; }
    function juntar(r, lista, padrao) {
      // telefone e e-mail: guarda só o que tem cara de telefone / e-mail (nada de outro dado
      // que tenha vindo junto na mesma célula)
      var v = [];
      lista.forEach(function (i) { (c(r, i).match(padrao) || []).forEach(function (s) { s = s.trim(); if (s && v.indexOf(s) === -1) v.push(s); }); });
      return v.join(" / ");
    }
    var TEL = /(\+?55\s?)?\(?\d{2}\)?[\s.-]?\d{4,5}[\s.-]?\d{4}|\b\d{4,5}-\d{4}\b/g, MAIL = /[^\s@;,/]+@[^\s@;,/]+\.[^\s@;,/]+/g;
    // só os 6 campos seguem para o servidor
    pendentes = p.rows.map(function (r) {
      return { ra: c(r, ix.ra), nome: c(r, ix.nome), turma: c(r, ix.turma), responsavel: c(r, ix.responsavel), email: juntar(r, mails, MAIL), telefone: juntar(r, tels, TEL) };
    }).filter(function (r) { var n = r.nome.toUpperCase(); return n && n !== "NOME" && n !== "ALUNO" && n.length <= 150; });
    function nomesCol(lista) { return lista.map(function (i) { return p.raw[i]; }).join(" + "); }
    var origem = { ra: ix.ra !== -1 ? p.raw[ix.ra] : "", nome: p.raw[ix.nome], turma: ix.turma !== -1 ? p.raw[ix.turma] : "", responsavel: ix.responsavel !== -1 ? p.raw[ix.responsavel] : "", email: nomesCol(mails), telefone: nomesCol(tels) };
    var mapa = BASE_CAMPOS_IMP.map(function (m) {
      return '<span class="tag">' + m[1] + " ← " + (origem[m[0]] ? esc(origem[m[0]]) : '<i class="muted">não encontrada</i>') + "</span>";
    }).join(" ");
    var usadas = {};
    [ix.ra, ix.nome, ix.turma, ix.responsavel].concat(mails, tels).forEach(function (i) { if (i !== -1) usadas[i] = 1; });
    var ignoradas = (p.raw || []).filter(function (x, i) { return x && !usadas[i]; }).length;
    out.innerHTML = '<div class="base-mapa">' + mapa + "</div>" +
      '<div class="import-preview"><table><thead><tr><th>Matrícula</th><th>Aluno</th><th>Turma</th><th>Resp. financeiro</th><th>E-mail</th><th>Telefone</th></tr></thead><tbody>' +
      pendentes.slice(0, 8).map(function (r) {
        return "<tr><td>" + esc(r.ra) + "</td><td>" + esc(r.nome) + "</td><td>" + esc(r.turma) + "</td><td>" + esc(r.responsavel) + "</td><td>" + esc(r.email) + "</td><td>" + esc(r.telefone) + "</td></tr>";
      }).join("") + "</tbody></table></div>" +
      '<div class="import-summary"><b>' + pendentes.length + " aluno(s)</b> no arquivo" + (pendentes.length > 8 ? " (mostrando os 8 primeiros)" : "") + "." +
      (ignoradas ? " <b>" + ignoradas + " coluna(s) não são importadas</b> (dados sensíveis como CPF, RG, endereço e nascimento ficam fora do sistema)." : "") +
      " Quem já está na base é atualizado pela matrícula; campos vazios no arquivo não apagam o que já existe. Ao terminar, o Painel, o Contraturno e o Serasa são completados com estes dados.</div>";
    $("btnConfirmImport").disabled = !pendentes.length;
  }
  function importarBaseEmPartes(btn) {
    var partes = [], TAM = 700;
    for (var i = 0; i < pendentes.length; i += TAM) partes.push(pendentes.slice(i, i + TAM));
    var tot = { criados: 0, atualizados: 0, iguais: 0, incompletas: 0, sincronizados: null }, feitas = 0;
    var cadeia = Promise.resolve();
    partes.forEach(function (lote, k) {
      cadeia = cadeia.then(function () {
        btn.textContent = "Importando… " + Math.round(feitas / pendentes.length * 100) + "%";
        return api("POST", "/api/base/importar", { linhas: lote, ultimaParte: k === partes.length - 1 }).then(function (d) {
          feitas += lote.length;
          ["criados", "atualizados", "iguais", "incompletas"].forEach(function (c) { tot[c] += d[c] || 0; });
          if (d.sincronizados) tot.sincronizados = d.sincronizados;
        });
      });
    });
    return cadeia.then(function () {
      btn.hidden = true;
      var s = tot.sincronizados || { alunos: 0, serasa: 0 };
      $("importResult").innerHTML = '<div class="import-summary" style="color:var(--ink)"><b>' + tot.criados + "</b> aluno(s) novo(s) na base · <b>" + tot.atualizados + "</b> atualizado(s)" +
        (tot.iguais ? " · " + tot.iguais + " já estavam iguais" : "") + (tot.incompletas ? " · " + tot.incompletas + " sem nome (não importados)" : "") + ".</div>" +
        '<div class="import-summary">Completados com a base: <b>' + s.alunos + "</b> aluno(s) no Painel/Contraturno e <b>" + s.serasa + "</b> parcela(s) no Serasa.</div>";
      toast("Base de dados importada.");
      return Promise.all([carregar(), carregarBaseDados()]);
    });
  }

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

  // Períodos = abas da planilha. Cada parcela pertence a um período (periodoId), como uma
  // linha pertence a uma aba; a mesma parcela pode estar em mais de um período.
  // O período escolhido fica lembrado neste navegador. "__sem" = parcelas ainda sem período.
  var SEM_PERIODO = "__sem";
  var periodos = [], periodoSel = "";
  try { periodoSel = localStorage.getItem("ser_periodo") || ""; } catch (e) { periodoSel = ""; }
  function periodoAtual() { for (var i = 0; i < periodos.length; i++) if (periodos[i].id === periodoSel) return periodos[i]; return null; }
  function doPeriodo(x, sel) { return !sel || (sel === SEM_PERIODO ? !x.periodoId : x.periodoId === sel); }
  function nomeDoPeriodo(id) { for (var i = 0; i < periodos.length; i++) if (periodos[i].id === id) return periodos[i].nome; return ""; }
  function opcoesPeriodos() { return periodos.slice().reverse().map(function (p) { return { v: p.id, l: p.nome }; }); }
  // Lista do campo "Período": mais recentes primeiro, com a quantidade de parcelas.
  function renderPeriodos() {
    var n = {}, sem = 0;
    parcelas.forEach(function (x) { if (x.periodoId) n[x.periodoId] = (n[x.periodoId] || 0) + 1; else sem++; });
    var opcoes = [{ v: "", l: "Período: todos (" + parcelas.length + ")" }].concat(periodos.slice().reverse().map(function (p) {
      return { v: p.id, l: "Período: " + p.nome + " (" + (n[p.id] || 0) + ")" };
    }));
    if (sem) opcoes.push({ v: SEM_PERIODO, l: "Sem período (" + sem + ")" });
    if (periodoSel === SEM_PERIODO && !sem) periodoSel = "";
    prepararSelect($("sPeriodo"), opcoes.map(function (o) { return { v: esc(o.v), l: esc(o.l) }; }), periodoSel);
    $("sPeriodo").value = periodoSel;
    var p = periodoAtual();
    $("sPeriodo").title = p ? "Aba " + p.nome + " (" + br(p.inicio) + " a " + br(p.fim) + ")" : "";
    $("btnEditarPeriodo").hidden = !p;
  }
  $("sPeriodo").addEventListener("change", function () {
    periodoSel = this.value;
    try { localStorage.setItem("ser_periodo", periodoSel); } catch (x) { /* navegador sem armazenamento */ }
    serSel = {}; serLimite = 300; renderSerasa();
  });
  $("btnEditarPeriodo").addEventListener("click", function () { if (periodoSel) abrirPeriodo(periodoSel); });

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
      periodoSel = ""; fecharModais(); toast("Período excluído. As parcelas dele continuam salvas, em “Sem período”.");
      return carregar();
    }).catch(function (x) { toast(x.message); });
  });
  var SER_OPC = [{ v: "", l: "" }, { v: "__pendente", l: "Pendente" }].concat(SER_ST.slice(1));
  fill($("sMentor"), SER_OPC.slice(1), "Mentor: todas"); fill($("sSerasa"), SER_OPC.slice(1), "Serasa: todas");
  fill($("srMentor"), SER_ST); fill($("srSerasa"), SER_ST);

  function renderSerasa() {
    if (periodoSel && periodoSel !== SEM_PERIODO && !periodoAtual()) periodoSel = "";
    renderPeriodos();
    var p = periodoSel ? parcelas.filter(function (x) { return doPeriodo(x, periodoSel); }) : parcelas;
    var chaveDe = chavesAluno(p);
    // indicadores
    var neg = 0, pend = 0, pagas = 0, jur = 0, alunosSet = {}, negAlunos = {};
    p.forEach(function (x) {
      alunosSet[chaveDe(x)] = 1;
      if (x.serasa === "ok") { neg++; negAlunos[chaveDe(x)] = 1; }
      if (!x.serasa && ["", "ok", "negociado"].indexOf(x.mentor || "") !== -1) pend++;
      if (x.mentor === "pago" || x.serasa === "pago") pagas++;
      if (x.mentor === "juridico" || x.serasa === "juridico") jur++;
    });
    var tiles = [
      { n: Object.keys(alunosSet).length, l: "Alunos", cls: "lead" },
      { n: p.length, l: "Parcelas" },
      { n: neg, l: "Parcelas negativadas · " + Object.keys(negAlunos).length + " alunos", c: "success" },
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
    // Uma linha por aluno: todas as parcelas dele (dentro dos filtros) ficam juntas.
    var grupos = {}, ordemG = [];
    serFiltrada.forEach(function (x) {
      var k = chaveDe(x), g = grupos[k];
      if (!g) { g = grupos[k] = { chave: k, itens: [], total: 0, ultimo: "", primeiro: "" }; ordemG.push(g); }
      g.itens.push(x); g.total += Number(x.valor) || 0;
      if (x.vencimento && x.vencimento > g.ultimo) g.ultimo = x.vencimento;
      if (x.vencimento && (!g.primeiro || x.vencimento < g.primeiro)) g.primeiro = x.vencimento;
    });
    function nomeG(g) { var x = g.itens[0]; return x.nome || x.responsavel || ""; }
    ordemG.sort(function (a, b) {
      if (ord === "valor") return b.total - a.total;
      if (ord === "nome") return nomeG(a).localeCompare(nomeG(b));
      if (ord === "venc_asc") return a.primeiro.localeCompare(b.primeiro);
      return b.ultimo.localeCompare(a.ultimo);
    });
    serGrupos = ordemG;
    var total = serFiltrada.reduce(function (s, x) { return s + (Number(x.valor) || 0); }, 0);
    $("serCount").textContent = ordemG.length + (ordemG.length === 1 ? " aluno" : " alunos") + " · " +
      serFiltrada.length + (serFiltrada.length === 1 ? " parcela" : " parcelas") + " · " + money(total);

    var tb = $("serTbody");
    if (!serFiltrada.length) {
      var msg = !parcelas.length ? ["Nenhuma parcela cadastrada ainda", "Importe a planilha da Serasa ou cadastre a primeira parcela."]
        : !p.length ? ["Nenhuma parcela neste período", "Importe o relatório desta aba em “Importar planilha”, escolhendo este período."]
        : ["Nenhuma parcela com estes filtros", "Ajuste a busca ou os filtros acima."];
      tb.innerHTML = '<tr><td colspan="7" class="empty"><b>' + msg[0] + '</b><div class="muted">' + msg[1] + "</div></td></tr>";
    } else {
      tb.innerHTML = ordemG.slice(0, serLimite).map(function (g) {
        var x = g.itens[0], n = g.itens.length;
        var ra = "", resp = "";
        g.itens.forEach(function (y) { ra = ra || y.ra || ""; resp = resp || (y.nome && y.responsavel ? y.responsavel : ""); });
        var meta = [ra ? "RA " + ra : "", resp].filter(Boolean).join(" · ");
        var todas = g.itens.every(function (y) { return serSel[y.id]; });
        var inc = "", quemInc = "";
        g.itens.forEach(function (y) { if (y.dataInclusao && y.dataInclusao > inc) { inc = y.dataInclusao; quemInc = y.respInclusao || ""; } });
        var vencs = g.primeiro === g.ultimo ? br(g.primeiro) : br(g.primeiro) + " a " + br(g.ultimo);
        return '<tr class="click" data-grupo="' + esc(g.chave) + '"><td><input type="checkbox" class="ser-chk" data-grupo="' + esc(g.chave) + '"' + (todas ? " checked" : "") + ' aria-label="Selecionar as parcelas deste aluno"></td>' +
          '<td><div class="nome">' + esc(x.nome || x.responsavel || "—") + "</div>" + (meta ? '<div class="meta">' + esc(meta) + "</div>" : "") + "</td>" +
          '<td><b class="tabular">' + n + (n === 1 ? " parcela" : " parcelas") + '</b><div class="meta tabular">' + vencs + "</div></td>" +
          '<td class="tabular money">' + money(g.total) + "</td>" +
          "<td>" + resumoSt(g.itens, "mentor") + "</td><td>" + resumoSt(g.itens, "serasa") + "</td>" +
          "<td>" + (inc ? br(inc) : '<span class="muted">—</span>') + (quemInc ? '<div class="meta">' + esc(quemInc) + "</div>" : "") + "</td></tr>";
      }).join("");
    }
    $("serMais").hidden = ordemG.length <= serLimite;
    $("serMais").textContent = "Mostrar mais (" + (ordemG.length - serLimite) + " alunos restantes)";
    atualizarSelecao();
    renderNegMes(p, chaveDe);
    if (!$("mAlunoSer").hidden) renderAlunoSer();
  }
  var serGrupos = [];
  // Identifica o aluno: RA; sem RA, o nome (usando o RA de outra parcela do mesmo nome, se houver).
  function normNome(s) { return String(s || "").trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " "); }
  function chavesAluno(lista) {
    var raDoNome = {};
    lista.forEach(function (x) { var ra = (x.ra || "").trim(), n = normNome(x.nome || x.responsavel); if (ra && n && !raDoNome[n]) raDoNome[n] = ra; });
    return function (x) {
      var ra = (x.ra || "").trim(), n = normNome(x.nome || x.responsavel);
      return ra ? "ra:" + ra : raDoNome[n] ? "ra:" + raDoNome[n] : "n:" + n;
    };
  }
  // Situação das parcelas do aluno: uma etiqueta por situação, com a quantidade quando varia.
  function resumoSt(itens, campo) {
    var n = {}, ordem = [];
    itens.forEach(function (y) { var v = y[campo] || ""; if (!n[v]) { n[v] = 0; ordem.push(v); } n[v]++; });
    if (ordem.length === 1) return serPill(ordem[0]) + (itens.length > 1 ? ' <span class="meta">todas</span>' : "");
    return '<div class="pills-col">' + SER_ST.filter(function (s) { return n[s.v]; }).map(function (s) {
      return '<span class="pill" style="color:var(--' + s.c + ');background:var(--' + s.c + '-soft)"><i></i>' + s.l + " " + n[s.v] + "</span>";
    }).join("") + "</div>";
  }

  // ---- acompanhamento de negativações por mês (pela data de inclusão no Serasa)
  var MESES_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  // Conta como negativação a parcela incluída no Serasa, mesmo que depois tenha sido paga ou negociada.
  function foiNegativada(x) { return x.serasa === "ok" || (!!x.dataInclusao && !!x.serasa && x.serasa !== "nao_negativar"); }
  function renderNegMes(p, chaveDe) {
    // em "todos os períodos" a mesma parcela pode estar em mais de uma aba: conta uma vez só
    var vistas = {}, porMes = {}, semData = { n: 0, alunos: {}, valor: 0 }, anos = {};
    p.forEach(function (x) {
      if (!foiNegativada(x)) return;
      // contagem zerada: só entram inclusões a partir da data escolhida
      if (negInicio && (!x.dataInclusao || x.dataInclusao < negInicio)) return;
      var ch = chaveDe(x) + "|" + (x.vencimento || "") + "|" + (Number(x.valor) || 0).toFixed(2) + "|" + (x.tipo || "");
      if (vistas[ch]) return; vistas[ch] = 1;
      var m = (x.dataInclusao || "").slice(0, 7), alvo;
      if (/^\d{4}-\d{2}$/.test(m)) { anos[m.slice(0, 4)] = 1; alvo = porMes[m] || (porMes[m] = { n: 0, alunos: {}, valor: 0 }); } else alvo = semData;
      alvo.n++; alvo.alunos[chaveDe(x)] = 1; alvo.valor += Number(x.valor) || 0;
    });
    var listaAnos = Object.keys(anos).sort().reverse(), anoHoje = String(new Date().getFullYear());
    if (listaAnos.indexOf(anoHoje) === -1) listaAnos.unshift(anoHoje);
    var ano = prepararSelect($("negMesAno"), listaAnos.map(function (y) { return { v: y, l: y }; }), anos[anoHoje] ? anoHoje : listaAnos[0]);
    var cols = MESES_CURTOS.map(function (nm, i) { var k = ano + "-" + pad2(i + 1); return { l: nm, d: porMes[k] || { n: 0, alunos: {}, valor: 0 }, futuro: k > mesAtual() }; });
    var tot = { n: 0, alunos: {}, valor: 0 };
    cols.forEach(function (c) { tot.n += c.d.n; tot.valor += c.d.valor; Object.keys(c.d.alunos).forEach(function (k) { tot.alunos[k] = 1; }); });
    var mx = Math.max.apply(null, cols.map(function (c) { return c.d.n; })) || 1;
    function nAl(d) { return Object.keys(d.alunos).length; }
    function linha(rot, f, cls) {
      return "<tr" + (cls ? ' class="' + cls + '"' : "") + "><th>" + rot + "</th>" + cols.map(function (c) {
        return '<td class="tabular' + (c.futuro ? " futuro" : "") + '">' + (c.futuro && !c.d.n ? "" : f(c.d)) + "</td>";
      }).join("") + '<td class="tabular tot">' + f(tot) + "</td></tr>";
    }
    $("negMesTab").innerHTML = "<thead><tr><th></th>" + cols.map(function (c) { return "<th>" + c.l + "</th>"; }).join("") + '<th class="tot">Total ' + ano + "</th></tr></thead><tbody>" +
      "<tr class=\"barras\"><th></th>" + cols.map(function (c) { return '<td><span class="neg-bar" style="height:' + Math.round(c.d.n / mx * 100) + '%" title="' + c.d.n + ' negativações"></span></td>'; }).join("") + "<td></td></tr>" +
      linha("Negativações", function (d) { return "<b>" + d.n + "</b>"; }, "destaque") +
      linha("Alunos", nAl) +
      linha("Valor", function (d) { return d.n ? money(d.valor).replace(/,\d{2}$/, "") : "—"; }) + "</tbody>";
    var p1 = periodoAtual();
    $("negMesSub").textContent = "Parcelas incluídas no Serasa em cada mês, pela data de inclusão" + (p1 ? " · período " + p1.nome : " · todos os períodos") +
      (negInicio ? " · contagem zerada: conta a partir de " + br(negInicio) : "") +
      (semData.n ? " · " + semData.n + " negativada(s) sem data de inclusão não entram na tabela" : "") + ".";
    if (!$("btnNegZerar").classList.contains("armed")) rotuloZerar();
  }
  $("negMesAno").addEventListener("change", function () { renderSerasa(); });
  // Zerar a contagem (só administradores): a tabela conta só o que for incluído a partir de hoje.
  // Nada é apagado; "Voltar a contar tudo" desfaz.
  var negInicio = "";
  function rotuloZerar() { var b = $("btnNegZerar"); b.classList.remove("armed"); b.textContent = negInicio ? "Voltar a contar tudo" : "Zerar contagem"; }
  $("btnNegZerar").addEventListener("click", function () {
    var b = this;
    if (!negInicio && !b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Confirmar: zerar a partir de hoje"; return; }
    b.disabled = true;
    api("POST", "/api/serasa/inicio-negativacoes", { data: negInicio ? "" : hoje() }).then(function (d) {
      negInicio = d.negInicio || "";
      toast(negInicio ? "Contagem zerada: a tabela conta as negativações a partir de hoje." : "A tabela voltou a contar todas as negativações.");
      renderSerasa();
    }).catch(function (x) { toast(x.message); }).then(function () { b.disabled = false; rotuloZerar(); });
  });
  // Depois de importar, a lista atrás da janela passa a mostrar as parcelas do arquivo:
  // limpa os filtros e escolhe o período para onde elas foram (ou todos, se foram para vários).
  function mostrarImportadas(porPeriodo) {
    var ids = Object.keys(porPeriodo);
    periodoSel = ids.length === 1 ? (ids[0] || SEM_PERIODO) : "";
    try { localStorage.setItem("ser_periodo", periodoSel); } catch (x) { /* sem armazenamento */ }
    ["sBusca", "sMentor", "sSerasa", "sAno"].forEach(function (id) { $(id).value = ""; });
    serSel = {}; serLimite = 300;
    renderSerasa();
  }
  function atualizarSelecao() {
    var n = Object.keys(serSel).length;
    $("serBulk").hidden = !n;
    var nAl = serGrupos.filter(function (g) { return g.itens.some(function (y) { return serSel[y.id]; }); }).length;
    $("serSelCount").textContent = (nAl ? nAl + (nAl === 1 ? " aluno · " : " alunos · ") : "") + n + (n === 1 ? " parcela selecionada" : " parcelas selecionadas");
    $("serSelTodos").checked = serFiltrada.length > 0 && serFiltrada.every(function (x) { return serSel[x.id]; });
    if (n) {
      var sel = $("serMoverPara"), atual = sel.value;
      fill(sel, [{ v: "", l: "Mover para o período…" }].concat(opcoesPeriodos()));
      sel.value = atual;
    }
  }
  ["sBusca", "sMentor", "sSerasa", "sAno", "sOrdem"].forEach(function (id) { $(id).addEventListener("input", function () { serLimite = 300; renderSerasa(); }); });
  $("serMais").addEventListener("click", function () { serLimite += 300; renderSerasa(); });
  function grupoPorChave(k) { for (var i = 0; i < serGrupos.length; i++) if (serGrupos[i].chave === k) return serGrupos[i]; return null; }
  $("serTbody").addEventListener("click", function (e) {
    var chk = e.target.closest(".ser-chk");
    if (chk) {
      var g = grupoPorChave(chk.getAttribute("data-grupo"));
      if (g) g.itens.forEach(function (y) { if (chk.checked) serSel[y.id] = 1; else delete serSel[y.id]; });
      atualizarSelecao(); return;
    }
    var tr = e.target.closest("tr[data-grupo]"); if (tr) abrirAlunoSer(tr.getAttribute("data-grupo"));
  });
  $("serSelTodos").addEventListener("change", function () {
    // marca todas as parcelas do filtro atual (inclusive as que ainda não apareceram na tela)
    var on = this.checked;
    serFiltrada.forEach(function (x) { if (on) serSel[x.id] = 1; else delete serSel[x.id]; });
    renderSerasa();
  });
  $("serLimparSel").addEventListener("click", function () { serSel = {}; renderSerasa(); });
  $("serMover").addEventListener("click", function () {
    var ids = Object.keys(serSel), destino = $("serMoverPara").value, b = this;
    if (!ids.length) return;
    if (!destino) { $("serMoverPara").focus(); return toast("Escolha o período de destino."); }
    b.disabled = true;
    api("POST", "/api/serasa/lote", { ids: ids, periodoId: destino }).then(function (d) {
      toast(d.atualizados + " parcela(s) movida(s) para " + nomeDoPeriodo(destino) + ".");
      serSel = {}; periodoSel = destino;
      try { localStorage.setItem("ser_periodo", periodoSel); } catch (x) { /* sem armazenamento */ }
      return carregar();
    }).catch(function (x) { toast(x.message); }).then(function () { b.disabled = false; });
  });
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

  // janela do aluno: todas as parcelas dele no período, com "Sim" no Mentor e no Serasa
  var alunoSerChave = null, asEdits = {};
  function parcelasDoAluno() {
    var p = periodoSel ? parcelas.filter(function (x) { return doPeriodo(x, periodoSel); }) : parcelas;
    var chaveDe = chavesAluno(p);
    return p.filter(function (x) { return chaveDe(x) === alunoSerChave; })
      .sort(function (a, b) { return (a.vencimento || "").localeCompare(b.vencimento || ""); });
  }
  function asValor(x, campo) { var e = asEdits[x.id]; return e && e[campo] !== undefined ? e[campo] : (x[campo] || ""); }
  function asDefinir(x, campo, marcado) {
    var orig = x[campo] || "", novo = marcado ? "ok" : (orig === "ok" ? "" : orig);
    var e = asEdits[x.id] || (asEdits[x.id] = {});
    if (novo === orig) delete e[campo]; else e[campo] = novo;
    if (!Object.keys(e).length) delete asEdits[x.id];
  }
  function abrirAlunoSer(chave) {
    alunoSerChave = chave; asEdits = {}; mostrarErro($("asErr"), "");
    if (!parcelasDoAluno().length) return;
    renderAlunoSer(); abrir("mAlunoSer");
  }
  function renderAlunoSer() {
    var itens = parcelasDoAluno();
    if (!itens.length) { $("mAlunoSer").hidden = true; return; }
    var ra = "", nome = "", resp = "", cpf = "", total = 0;
    itens.forEach(function (x) { ra = ra || x.ra || ""; nome = nome || x.nome || ""; resp = resp || x.responsavel || ""; cpf = cpf || x.cpf || ""; total += Number(x.valor) || 0; });
    $("asTitulo").textContent = nome || resp || "Aluno";
    $("asSub").textContent = [ra ? "RA " + ra : "", nome && resp ? "Responsável: " + resp : "", cpf ? "CPF " + cpf : ""].filter(Boolean).join(" · ");
    var nMent = itens.filter(function (x) { return asValor(x, "mentor") === "ok"; }).length;
    var nSer = itens.filter(function (x) { return asValor(x, "serasa") === "ok"; }).length;
    var p1 = periodoAtual();
    $("asResumo").innerHTML = "<span><b>" + itens.length + "</b> " + (itens.length === 1 ? "parcela" : "parcelas") + "</span><span><b>" + money(total) + "</b> no total</span>" +
      "<span>Mentor: <b>" + nMent + "</b> de " + itens.length + "</span><span>Serasa: <b>" + nSer + "</b> de " + itens.length + "</span>" +
      '<span class="muted">' + (p1 ? "Período " + esc(p1.nome) : periodoSel === SEM_PERIODO ? "Sem período" : "Todos os períodos") + "</span>";
    var mostrarPer = !periodoSel;
    document.querySelectorAll("#mAlunoSer .col-per").forEach(function (th) { th.hidden = !mostrarPer; });
    function celula(x, campo) {
      var v = asValor(x, campo), mudou = asEdits[x.id] && asEdits[x.id][campo] !== undefined;
      return '<td class="' + (mudou ? "mudou" : "") + '"><label class="sim"><input type="checkbox" data-id="' + esc(x.id) + '" data-campo="' + campo + '"' + (v === "ok" ? " checked" : "") + "> Sim</label>" +
        (v && v !== "ok" ? " " + serPill(v) : "") + "</td>";
    }
    $("asTbody").innerHTML = itens.map(function (x) {
      return "<tr><td class=\"tabular\">" + br(x.vencimento) + '</td><td class="tabular money">' + money(x.valor) + "</td><td>" + (x.tipo ? esc(x.tipo) : '<span class="muted">—</span>') + "</td>" +
        (mostrarPer ? "<td>" + (x.periodoId ? esc(nomeDoPeriodo(x.periodoId)) : '<span class="muted">Sem período</span>') + "</td>" : "") +
        celula(x, "mentor") + celula(x, "serasa") +
        "<td>" + (x.dataInclusao ? br(x.dataInclusao) : '<span class="muted">—</span>') + (x.respInclusao ? '<div class="meta">' + esc(x.respInclusao) + "</div>" : "") + "</td>" +
        '<td><button type="button" class="btn ghost small icone" data-editar="' + esc(x.id) + '" title="Editar parcela" aria-label="Editar parcela">✎</button></td></tr>';
    }).join("");
    $("asMentorTodas").checked = nMent === itens.length;
    $("asSerasaTodas").checked = nSer === itens.length;
    var n = Object.keys(asEdits).length;
    $("asSalvar").disabled = !n;
    $("asSalvar").textContent = n ? "Salvar alterações (" + n + (n === 1 ? " parcela)" : " parcelas)") : "Salvar alterações";
  }
  $("asTbody").addEventListener("change", function (e) {
    var c = e.target.closest("input[data-campo]"); if (!c) return;
    var x = porIdParcela(c.getAttribute("data-id")); if (!x) return;
    asDefinir(x, c.getAttribute("data-campo"), c.checked); renderAlunoSer();
  });
  $("asTbody").addEventListener("click", function (e) {
    var b = e.target.closest("[data-editar]"); if (b) abrirParcela(b.getAttribute("data-editar"));
  });
  [["asMentorTodas", "mentor"], ["asSerasaTodas", "serasa"]].forEach(function (par) {
    $(par[0]).addEventListener("change", function () {
      var on = this.checked;
      parcelasDoAluno().forEach(function (x) { asDefinir(x, par[1], on); });
      renderAlunoSer();
    });
  });
  $("asSalvar").addEventListener("click", function () {
    // agrupa as mudanças por campo e valor e grava em lote
    var lotes = {};
    Object.keys(asEdits).forEach(function (id) {
      Object.keys(asEdits[id]).forEach(function (campo) {
        var k = campo + "|" + asEdits[id][campo]; (lotes[k] || (lotes[k] = [])).push(id);
      });
    });
    var b = this, n = Object.keys(asEdits).length; b.disabled = true;
    var cadeia = Promise.resolve();
    Object.keys(lotes).forEach(function (k) {
      var partes = k.split("|"), corpo = { ids: lotes[k] }; corpo[partes[0]] = partes[1];
      cadeia = cadeia.then(function () { return api("POST", "/api/serasa/lote", corpo); });
    });
    cadeia.then(function () {
      asEdits = {}; toast(n + (n === 1 ? " parcela atualizada." : " parcelas atualizadas.")); return carregar();
    }).catch(function (x) { mostrarErro($("asErr"), x.message); b.disabled = false; });
  });
  $("asNovaParcela").addEventListener("click", function () {
    var itens = parcelasDoAluno(), v = {};
    itens.forEach(function (x) { ["ra", "nome", "responsavel", "cpf"].forEach(function (f) { v[f] = v[f] || x[f] || ""; }); });
    abrirParcela(null);
    $("srRa").value = v.ra || ""; $("srNome").value = v.nome || ""; $("srResp").value = v.responsavel || ""; $("srCpf").value = v.cpf || "";
    setTimeout(function () { $("srVenc").focus(); }, 40);
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
    fill($("srPeriodo"), opcoesPeriodos(), "Sem período");
    // parcela nova entra no período aberto no filtro
    $("srPeriodo").value = x ? (v.periodoId || "") : (periodoAtual() ? periodoSel : "");
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
      observacao: $("srObs").value.trim(), periodoId: $("srPeriodo").value
    };
    var req = parcelaAtual ? api("PATCH", "/api/serasa/" + encodeURIComponent(parcelaAtual.id), dados) : api("POST", "/api/serasa", dados);
    req.then(function (d) {
      var i = parcelas.findIndex(function (p) { return p.id === d.parcela.id; });
      if (i === -1) parcelas.unshift(d.parcela); else parcelas[i] = d.parcela;
      $("mSerasa").hidden = true; delete asEdits[d.parcela.id]; renderSerasa(); toast(parcelaAtual ? "Parcela atualizada." : "Parcela cadastrada.");
    }).catch(function (x) { mostrarErro(err, x.message); });
  });
  $("srExcluir").addEventListener("click", function () {
    var b = this;
    if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Confirmar exclusão"; return; }
    api("DELETE", "/api/serasa/" + encodeURIComponent(parcelaAtual.id)).then(function () {
      parcelas = parcelas.filter(function (p) { return p.id !== parcelaAtual.id; }); delete serSel[parcelaAtual.id];
      $("mSerasa").hidden = true; delete asEdits[parcelaAtual.id]; renderSerasa(); toast("Parcela excluída.");
    }).catch(function (x) { toast(x.message); });
  });

  // modelo, exportação e importação
  var SER_CAB = ["RA", "NOME", "RESPONSÁVEL FINANCEIRO", "CPF", "VENCIMENTO", "VALOR (R$)", "TIPO", "MENTOR", "SERASA", "DATA INCLUSÃO", "RESP. INCLUSÃO", "OBSERVAÇÃO", "PERÍODO"];
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
        serStTexto(x.mentor), serStTexto(x.serasa), x.dataInclusao ? br(x.dataInclusao) : "", x.respInclusao, x.observacao, nomeDoPeriodo(x.periodoId)].map(csvCampo).join(";");
    });
    baixar("relatorio_serasa_" + hoje() + ".csv", SER_CAB.join(";") + "\n" + linhas.join("\n"));
    toast("Relatório exportado (" + linhas.length + " parcelas, conforme os filtros).");
  });
  $("btnSerImportar").addEventListener("click", function () { abrirImportacao("serasa"); });
  // Verificar e remover parcelas duplicadas (só administradores). Primeiro mostra, depois remove.
  function mostrarDuplicadas(d, removidas) {
    var b = $("dupRemover");
    b.classList.remove("armed");
    if (removidas) {
      $("dupResumo").innerHTML = "<b>" + removidas + "</b> parcela(s) duplicada(s) removida(s). As marcações das cópias foram mantidas nas parcelas que ficaram.";
      $("dupLista").hidden = true; b.hidden = true; return;
    }
    if (!d.duplicadas) {
      $("dupResumo").innerHTML = "Nenhuma parcela duplicada encontrada. ✓";
      $("dupLista").hidden = true; b.hidden = true; return;
    }
    $("dupResumo").innerHTML = "<b>" + d.duplicadas + "</b> parcela(s) duplicada(s) em <b>" + d.grupos + "</b> grupo(s). Confira a lista e, se estiver certo, clique em “Remover duplicadas”.";
    $("dupLista").innerHTML = "<table><thead><tr><th>Aluno</th><th>RA</th><th>Período</th><th>Vencimento</th><th>Valor</th><th>Aparece</th><th>Fica</th></tr></thead><tbody>" +
      d.exemplos.map(function (e) {
        return "<tr><td>" + esc(e.nome) + "</td><td>" + esc(e.ra) + "</td><td>" + esc(e.periodo) + "</td><td>" + br(e.vencimento) + '</td><td class="tabular">' + money(e.valor) + "</td><td>" + e.vezes + "×</td><td>" + e.ficam + "</td></tr>";
      }).join("") + "</tbody></table>" + (d.grupos > d.exemplos.length ? '<div class="meta" style="padding:6px 10px">Mostrando ' + d.exemplos.length + " de " + d.grupos + " grupos.</div>" : "");
    $("dupLista").hidden = false; b.hidden = false; b.disabled = false;
    b.textContent = "Remover " + d.duplicadas + " duplicada(s)";
  }
  $("btnSerDup").addEventListener("click", function () {
    $("dupResumo").textContent = "Verificando…"; $("dupLista").hidden = true; $("dupRemover").hidden = true;
    abrir("mDup");
    api("GET", "/api/serasa/duplicadas").then(function (d) { mostrarDuplicadas(d, 0); }).catch(function (x) { $("dupResumo").textContent = x.message; });
  });
  $("dupRemover").addEventListener("click", function () {
    var b = this;
    if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Confirmar remoção"; return; }
    b.disabled = true; b.textContent = "Removendo…";
    api("POST", "/api/serasa/duplicadas").then(function (d) {
      mostrarDuplicadas(d, d.removidas); toast(d.removidas + " duplicada(s) removida(s).");
      return carregar();
    }).catch(function (x) { b.disabled = false; toast(x.message); });
  });
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
      obs: colExata(h, ["observacao", "obs"]), periodo: colExata(h, ["periodo", "aba"])
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
        dataInclusao: dataInc, respInclusao: c(r, ix.respInc), observacao: c(r, ix.obs), periodo: c(r, ix.periodo)
      };
    }).filter(function (r) {
      var quem = (r.nome || r.responsavel).toUpperCase();
      return quem && quem !== "NOME" && quem !== "RESPONSÁVEL FINANCEIRO" && r.vencimento;
    });
    // prévia com as parcelas unificadas por aluno
    var chaveImp = chavesAluno(pendentes), gImp = {}, ordImp = [];
    pendentes.forEach(function (r) {
      var k = chaveImp(r), g = gImp[k];
      if (!g) { g = gImp[k] = { r: r, n: 0, total: 0, vencs: [], ment: 0, ser: 0 }; ordImp.push(g); }
      g.n++; g.total += Number(r.valor) || 0; g.vencs.push(r.vencimento);
      if (r.mentor === "ok") g.ment++; if (r.serasa === "ok") g.ser++;
    });
    out.innerHTML = '<div class="import-preview"><table><thead><tr><th>Aluno / responsável</th><th>Parcelas</th><th>Valor total</th><th>Mentor OK</th><th>Serasa OK</th></tr></thead><tbody>' +
      ordImp.slice(0, 8).map(function (g) {
        var r = g.r, v = g.vencs.sort();
        return "<tr><td>" + esc(r.nome || r.responsavel) + (r.ra ? ' <span class="muted">RA ' + esc(r.ra) + "</span>" : "") + "</td><td>" + g.n + ' <span class="muted">(' + br(v[0]) + (v.length > 1 ? " a " + br(v[v.length - 1]) : "") + ")</span></td>" +
          '<td class="tabular">' + money(g.total) + "</td><td>" + g.ment + " de " + g.n + "</td><td>" + g.ser + " de " + g.n + "</td></tr>";
      }).join("") + "</tbody></table></div>" +
      '<div class="import-summary"><b>' + ordImp.length + " aluno(s)</b> com " + pendentes.length + " parcela(s) no arquivo" + (ordImp.length > 8 ? " (mostrando os 8 primeiros)" : "") +
      ". Na lista, as parcelas de cada aluno ficam juntas em uma linha só. Parcelas que já existirem no período (mesmo aluno, vencimento, valor e tipo) só recebem os campos que vierem preenchidos — nada que a equipe já marcou é apagado.</div>";
    // Arquivo com a coluna PERÍODO: cada linha vai para o período (aba) indicado nela.
    var comPeriodo = {};
    pendentes.forEach(function (r) { if (r.periodo) comPeriodo[r.periodo] = (comPeriodo[r.periodo] || 0) + 1; });
    var nomes = Object.keys(comPeriodo);
    $("impPeriodo").disabled = nomes.length > 0;
    $("impPeriodoHint").textContent = nomes.length
      ? "Este arquivo tem a coluna PERÍODO: cada linha vai para o seu período (" + nomes.length + " no arquivo). Períodos que ainda não existem serão criados."
      : "Todas as linhas do arquivo vão para este período. Se o período ainda não existe, crie em “+ Novo período” antes.";
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
