// Painel de Cobrança — Colégio Ser (interface)
(function () {
  "use strict";
  // muda a cada publicação: aparece embaixo do menu para conferir se o navegador carregou a versão nova
  var VERSAO = "30/09 · v53";

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
    if (view === "juridico" && jurCarregado) carregarJuridico();
    if (view === "cheques" && chqCarregado) carregarCheques();
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
      if (!$("mImportar").hidden || !$("mJurImp").hidden || !$("mChqImp").hidden) return;
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
    if (view === "juridico") renderJuridico();
    if (view === "cheques" && chqCarregado) renderCheques();
    if (view === "usuarios") renderUsuarios();
    atualizarBadge();
  }

  // As abas Painel e Contraturno usam a mesma tela, cada uma com a sua carteira de alunos
  // e os seus próprios filtros.
  var CARTEIRA_INFO = {
    regular: { titulo: "Painel de cobrança", arquivo: "relatorio_cobranca_" },
    contraturno: { titulo: "Contraturno", arquivo: "relatorio_contraturno_" }
  };
  var FILTROS = ["fBusca", "fStatus", "fFaixa", "fSetor", "fAtend", "fOrdem"];
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
    if (v === "juridico" && !jurCarregado) carregarJuridico();
    if (v === "cheques" && !chqCarregado) carregarCheques();
    if (v === "juridico" && !baseCarregada) carregarBaseDados().then(function () { if (view === "juridico") renderJuridico(); }); // turma dos alunos vem da base
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
  fill($("fFaixa"), [{ v: "1", l: "Até 30 dias" }, { v: "31", l: "31–60 dias" }, { v: "61", l: "61–90 dias" }, { v: "90", l: "Mais de 90 dias" }, { v: "avencer", l: "Ainda não venceu" }, { v: "sem", l: "Sem vencimento cadastrado" }], "Todas as faixas de atraso");
  fill($("fSetor"), SETORES, "Todos os setores");
  fill($("nSetor"), SETORES); fill($("eSetor"), SETORES, "—");
  fill($("aCanal"), CANAIS); fill($("aSetor"), SETORES); fill($("aMotivo"), MOTIVOS);
  fill($("aStatus"), STATUS.map(function (s) { return { v: s.k, l: s.l }; }));

  // Faixa de atraso do aluno (quadro da Evolução): pela parcela em aberto mais antiga, contando
  // os dias desde o vencimento dela até hoje. Sem o detalhe das parcelas (importação antiga),
  // usa o vencimento mais antigo guardado no aluno.
  var FAIXAS_ATRASO = [
    { k: "1", l: "Até 30 dias", c: "info", min: 1 },
    { k: "31", l: "31–60 dias", c: "gold", min: 31 },
    { k: "61", l: "61–90 dias", c: "warn", min: 61 },
    { k: "90", l: "Mais de 90 dias", c: "danger", min: 91 }
  ];
  function diasDesde(venc, h) { return Math.round((new Date(h + "T00:00:00") - new Date(venc + "T00:00:00")) / 86400000); }
  function faixaDoAluno(a, h) {
    var pv = Array.isArray(a.parcelasVenc) ? a.parcelasVenc.filter(function (p) { return p && p[0]; }) : [];
    var venc = pv.length ? pv.map(function (p) { return p[0]; }).sort()[0] : a.vencimento;
    if (!venc) return "sem";
    var dias = diasDesde(venc, h);
    if (dias < 1) return "avencer";
    for (var i = FAIXAS_ATRASO.length - 1; i >= 0; i--) if (dias >= FAIXAS_ATRASO[i].min) return FAIXAS_ATRASO[i].k;
    return "avencer";
  }
  var FAIXA_EXTRA = { avencer: { l: "Ainda não venceu", c: "success" }, sem: { l: "Sem vencimento cadastrado", c: "gray" } };
  function faixaInfo(k) { for (var i = 0; i < FAIXAS_ATRASO.length; i++) if (FAIXAS_ATRASO[i].k === k) return FAIXAS_ATRASO[i]; return FAIXA_EXTRA[k] || FAIXA_EXTRA.sem; }
  // Ficha do aluno: a faixa dele (pela parcela mais antiga) e, quando há o detalhe, quantas
  // parcelas estão em cada faixa
  function faixaDetalhe(a) {
    if (!(Number(a.valorAberto) > 0)) return '<span class="muted">sem valor em aberto</span>';
    var h = hoje(), fx = faixaInfo(faixaDoAluno(a, h));
    var pv = Array.isArray(a.parcelasVenc) ? a.parcelasVenc.filter(function (p) { return p && p[0]; }) : [];
    var venc = pv.length ? pv.map(function (p) { return p[0]; }).sort()[0] : a.vencimento, dias = venc ? diasDesde(venc, h) : 0;
    var out = '<span class="pill" style="color:var(--' + fx.c + ');background:var(--' + fx.c + '-soft)"><i></i>' + fx.l + "</span>" +
      (venc && dias > 0 ? ' <span class="muted" style="font-weight:400">parcela mais antiga vencida há ' + dias + " dias (" + br(venc) + ")</span>" : "");
    if (pv.length > 1) {
      var n = {};
      pv.forEach(function (p) { var d = diasDesde(p[0], h), k = d < 1 ? "avencer" : d >= 91 ? "90" : d >= 61 ? "61" : d >= 31 ? "31" : "1"; n[k] = (n[k] || 0) + 1; });
      out += '<div class="meta" style="font-weight:400">' + ["90", "61", "31", "1", "avencer"].filter(function (k) { return n[k]; }).map(function (k) {
        return n[k] + (n[k] === 1 ? " parcela" : " parcelas") + " " + faixaInfo(k).l.toLowerCase();
      }).join(" · ") + "</div>";
    }
    return out;
  }
  var mesRecup = "", mesAberto = "";
  $("kpis").addEventListener("change", function (e) {
    if (e.target.id === "kpiMesRecup") { mesRecup = e.target.value; renderPainel(); }
    if (e.target.id === "kpiMesAberto") { mesAberto = e.target.value; renderPainel(); }
  });
  function renderKpis(vis) {
    var tot = 0, c = {};
    vis.forEach(function (a) { tot += Number(a.valorAberto) || 0; var k = a.status || "sem_contato"; c[k] = (c[k] || 0) + 1; });
    // "Recuperado em": o mês é escolhido na própria caixa (janeiro a dezembro do ano atual;
    // começa no mês atual)
    var anoR = new Date().getFullYear(), meses = MESES.map(function (nm, i) { return { v: anoR + "-" + pad2(i + 1), l: nm }; });
    if (!mesRecup || !meses.some(function (m) { return m.v === mesRecup; })) mesRecup = mesAtual();
    var selMes = '<select class="kpi-mes" id="kpiMesRecup" aria-label="Mês do valor recuperado">' + meses.map(function (m) {
      return '<option value="' + m.v + '"' + (m.v === mesRecup ? " selected" : "") + ">" + m.l + "</option>";
    }).join("") + "</select>";
    // "Valor em aberto": o ano todo ou só as parcelas que vencem no mês escolhido. Aluno sem o
    // detalhe das parcelas (importado antes) entra pelo vencimento dele só quando tem 1 parcela.
    if (mesAberto && !meses.some(function (m) { return m.v === mesAberto; })) mesAberto = "";
    var abertoMes = tot, semDetalhe = 0;
    if (mesAberto) {
      abertoMes = 0;
      vis.forEach(function (a) {
        if (!(Number(a.valorAberto) > 0)) return;
        var pv = Array.isArray(a.parcelasVenc) ? a.parcelasVenc : [];
        if (pv.length) pv.forEach(function (p) { if (String(p[0] || "").slice(0, 7) === mesAberto) abertoMes += Number(p[1]) || 0; });
        else if ((a.parcelasAberto || 1) <= 1) { if ((a.vencimento || "").slice(0, 7) === mesAberto) abertoMes += Number(a.valorAberto) || 0; }
        else semDetalhe++;
      });
    }
    var selAberto = '<select class="kpi-mes" id="kpiMesAberto" aria-label="Mês de vencimento do valor em aberto"><option value="">' + anoR + " (todos os meses)</option>" + meses.map(function (m) {
      return '<option value="' + m.v + '"' + (m.v === mesAberto ? " selected" : "") + ">" + m.l + " de " + anoR + "</option>";
    }).join("") + "</select>";
    var tiles = [
      { n: vis.length, l: "Alunos em acompanhamento" },
      { n: money(abertoMes), l: "Valor em aberto " + selAberto, cls: "lead",
        sub: mesAberto && semDetalhe ? semDetalhe + " aluno(s) sem o vencimento de cada parcela ficaram de fora: importe o relatório de novo" : "" },
      { n: money(recuperadoNoMes(mesRecup, carteira)), l: "Recuperado em " + selMes, c: "success" },
      { n: c.sem_contato || 0, l: "Sem contato", c: "gray" },
      { n: c.em_negociacao || 0, l: "Em negociação", c: "info" },
      { n: c.aguardando_retorno || 0, l: "Aguardando retorno", c: "warn" },
      { n: c.regularizado || 0, l: "Regularizados", c: "success" }
    ];
    $("kpis").innerHTML = tiles.map(function (t) {
      return '<div class="kpi ' + (t.cls || "") + '"><div class="num tabular"' + (t.c ? ' style="color:var(--' + t.c + ')"' : "") + ' title="' + esc(t.n) + '">' + t.n + '</div><div class="lbl">' + t.l + "</div>" + (t.sub ? '<div class="kpi-sub">' + esc(t.sub) + "</div>" : "") + "</div>";
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

    var q = $("fBusca").value.trim().toLowerCase(), fs = $("fStatus").value, ffx = $("fFaixa").value, fset = $("fSetor").value, fa = $("fAtend").value;
    var ord = soHoje ? "retorno" : $("fOrdem").value, h = hoje();
    var f = todos.filter(function (a) {
      if (!!a.arquivado !== showArch) return false;
      if (q && ((a.nome || "") + " " + (a.responsavel || "") + " " + (a.ra || "")).toLowerCase().indexOf(q) === -1) return false;
      if (fs && (a.status || "sem_contato") !== fs) return false;
      if (ffx && (!(Number(a.valorAberto) > 0) || faixaDoAluno(a, h) !== ffx)) return false;
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
  ["fBusca", "fStatus", "fFaixa", "fSetor", "fAtend", "fOrdem"].forEach(function (id) { $(id).addEventListener("input", renderPainel); });
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
      '<div class="k">Faixa de atraso</div><div class="v">' + faixaDetalhe(a) + "</div>" +
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
      if (!map[k]) { map[k] = { ra: r.ra || "", nome: r.nome, turma: r.turma || "", responsavel: r.responsavel || "", telefone: r.telefone || "", email: r.email || "", valorAberto: 0, parcelas: 0, vencimento: "", parcelasVenc: [] }; ordem.push(k); }
      var g = map[k];
      g.valorAberto += r.valorAberto || 0; g.parcelas++;
      // vencimento e valor de cada parcela: é o que dá a faixa de atraso por parcela
      if (r.vencimento) g.parcelasVenc.push([r.vencimento, Math.round((r.valorAberto || 0) * 100) / 100]);
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
      var brutos = [], achouCabecalho = false, conta = "";
      paginas.forEach(function (linhas) {
        var colDevido = null;
        linhas.forEach(function (l) {
          // as parcelas vêm separadas por "Conta financeira: <nome>"
          var mc = /^conta\s+financeira\s*:?\s*(.*)$/i.exec(l.texto.trim());
          // (o topo de cada página repete o filtro "Conta financeira: 8 / 9 / 26…", antes dos títulos
          // das colunas: esse não muda a conta; o grupo continua na página seguinte)
          if (mc) { if (colDevido != null) conta = mc[1].trim(); return; } // código e/ou nome da conta (o servidor reconhece os dois)
          var cab = l.cels.filter(function (c) { return /^devido$/i.test(c.s); })[0];
          if (cab && l.cels.some(function (c) { return /^c[oó]digo$/i.test(c.s); })) { colDevido = cab.cx; achouCabecalho = true; return; }
          var m = l.texto.match(/^(\d{1,12})\s+(.+?)\s+(\d{2}\/\d{2}\/\d{4})\s+(.*)$/);
          if (!m || !/[A-Za-zÀ-ú]/.test(m[2])) return;
          var nums = l.cels.filter(function (c) { return /^-?[\d.]*\d[.,]\d{2}$/.test(c.s); });
          if (!nums.length) return;
          var dev = nums[nums.length - 1];
          if (colDevido != null) nums.forEach(function (c) { if (Math.abs(c.cx - colDevido) < Math.abs(dev.cx - colDevido)) dev = c; });
          brutos.push({ ra: m[1], nome: m[2].trim(), valorAberto: parseMoneyBR(dev.s), vencimento: parseDateBR(m[3]), parc: (/^(\d{1,3})\s/.exec(m[4]) || [])[1] || "", turma: "", responsavel: "", telefone: "", email: "", conta: conta });
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
  // Excel (.xlsx/.xls): cada aba vira uma tabela como a do CSV. Com mais de uma aba, a pessoa
  // escolhe qual importar (já vem marcada a que mais parece ter o cabeçalho certo).
  function ehExcel(f) { return /\.(xlsx|xlsm|xls|ods)$/i.test(f.name || ""); }
  function celulaTexto(v) {
    if (v == null) return "";
    if (v instanceof Date) { var d = new Date(v.getTime() + 12 * 3600000); return pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + "/" + d.getFullYear(); }
    return String(v).trim();
  }
  function abasDoExcel(buf) {
    return carregarXLSX().then(function (X) {
      var wb = X.read(buf, { type: "array", cellDates: true });
      return wb.SheetNames.map(function (nome) {
        var aoa = X.utils.sheet_to_json(wb.Sheets[nome], { header: 1, defval: "", raw: true, blankrows: false }).map(function (r) { return r.map(celulaTexto); });
        var best = { line: 0, score: -1, cells: [] };
        for (var i = 0; i < Math.min(aoa.length, 10); i++) {
          var sc = scoreHeader(aoa[i]);
          if (sc > best.score) best = { line: i, score: sc, cells: aoa[i] };
        }
        var rows = aoa.slice(best.line + 1).filter(function (r) { return r.some(function (c) { return c !== ""; }); });
        return { nome: nome, score: best.score, tabela: { headers: best.cells.map(normHeader), raw: best.cells, rows: rows } };
      }).filter(function (a) { return a.tabela.rows.length; });
    });
  }
  function receberExcelImport(f) {
    var r = new FileReader();
    r.onload = function () {
      $("importResult").innerHTML = '<div class="meta">Lendo ' + esc(f.name) + "…</div>";
      abasDoExcel(new Uint8Array(r.result)).then(function (abas) {
        if (!abas.length) throw new Error("A planilha está vazia.");
        var melhor = abas.slice().sort(function (a, b) { return b.score - a.score; })[0];
        var wrap = $("impAbaWrap"), sel = $("impAba");
        wrap.hidden = abas.length < 2;
        sel.innerHTML = abas.map(function (a, i) { return '<option value="' + i + '"' + (a === melhor ? " selected" : "") + ">" + esc(a.nome) + " (" + a.tabela.rows.length + " linhas)</option>"; }).join("");
        sel.onchange = function () { processarTabela(abas[+sel.value].tabela); };
        processarTabela(melhor.tabela);
      }).catch(function (x) { $("importResult").innerHTML = ""; mostrarErroImport(x.message); });
    };
    r.readAsArrayBuffer(f);
  }
  function receberArquivoImport(f) {
    $("impAbaWrap").hidden = true;
    if (ehExcel(f)) return receberExcelImport(f);
    if (!ehPDF(f)) return lerArquivo(f, processarCSV);
    var r = new FileReader(); r.onload = function () { processarPDF(new Uint8Array(r.result)); }; r.readAsArrayBuffer(f);
  }
  function mostrarErroImport(msg) {
    var el = document.getElementById("erroImport") || document.createElement("div");
    el.id = "erroImport"; el.className = "form-err"; el.hidden = false; el.textContent = "Não foi possível importar: " + msg;
    $("importResult").prepend(el);
  }
  function abrirImportacao(modo) {
    modoImport = modo; confirmouPeriodo = false; simulado = false; $("impAbaWrap").hidden = true;
    $("impEspelhar").checked = true; // sempre começa marcado: o período fica igual ao arquivo
    pendentes = []; $("importResult").innerHTML = ""; $("pasteArea").value = ""; $("fileInput").value = "";
    var b = $("btnConfirmImport");
    b.disabled = true; b.hidden = false; b.textContent = modo === "serasa" ? "Importar parcelas" : modo === "base" ? "Importar para a base" : "Importar alunos";
    $("mImpT").textContent = modo === "serasa" ? "Importar planilha — Serasa" : modo === "base" ? "Importar relatório de alunos — Base de dados" : carteira === "contraturno" ? "Importar planilha — Contraturno" : "Importar planilha";
    $("mImpSub").textContent = modo === "base"
      ? "Envie o relatório total de alunos em Excel (.xlsx/.xls), CSV ou PDF. Só são importados: aluno, matrícula, descrição da turma e nome, e-mail e telefone do responsável financeiro. As demais colunas (dados sensíveis) são ignoradas e não saem do seu computador."
      : modo === "serasa"
      ? "Envie uma aba da planilha em Excel (.xlsx/.xls), CSV ou PDF (RA, Nome, Vencimento, Valor, Mentor, Serasa, Data inclusão). Também aceita Responsável financeiro, CPF, Tipo, Resp. inclusão e Período."
      : "Envie o relatório " + (carteira === "contraturno" ? "do contraturno" : "de cobrança") + " em Excel (.xlsx/.xls), CSV ou PDF (RA, Nome, Turma, Responsável, Telefone, E-mail, Valor em aberto, Vencimento). O PDF do relatório de Inadimplência do sistema também é aceito.";
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
    // campo com "multiple" (relatórios de inadimplência) aceita vários arquivos de uma vez
    function soltar(files) { var fs = [].slice.call(files || []); (input.multiple ? fs : fs.slice(0, 1)).forEach(function (f) { receber(f); }); }
    dz.addEventListener("drop", function (e) { e.preventDefault(); dz.classList.remove("drag"); soltar(e.dataTransfer.files); });
    input.addEventListener("change", function () { soltar(input.files); if (input.multiple) input.value = ""; });
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
    renderFaixaAlunos();

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
  // Alunos com valor em aberto, cada um contado uma vez na faixa da sua parcela mais antiga
  function renderFaixaAlunos() {
    var cart = $("faixaAlunosCart").value, h = hoje(), por = {}, val = {}, total = 0;
    var lista0 = cart === "todas" ? listaCarteira("regular").concat(listaCarteira("contraturno")) : listaCarteira(cart);
    lista0.forEach(function (a) {
      if (a.arquivado || !(Number(a.valorAberto) > 0)) return;
      var k = faixaDoAluno(a, h);
      por[k] = (por[k] || 0) + 1; val[k] = (val[k] || 0) + (Number(a.valorAberto) || 0); total++;
    });
    if (!total) { $("faixaAlunosList").innerHTML = '<div class="muted">Nenhum aluno com valor em aberto.</div>'; $("faixaAlunosNota").textContent = ""; return; }
    var rows = FAIXAS_ATRASO.map(function (f) { return { l: f.l, v: por[f.k] || 0, c: f.c, k: f.k }; });
    if (por.avencer) rows.push({ l: "Ainda não venceu", v: por.avencer, c: "success", k: "avencer" });
    if (por.sem) rows.push({ l: "Sem vencimento cadastrado", v: por.sem, c: "gray", k: "sem" });
    barras("faixaAlunosList", rows, Math.max.apply(null, rows.map(function (r) { return r.v; })), function (n) { return n + (n === 1 ? " aluno" : " alunos"); });
    // valor em aberto de cada faixa ao passar o mouse
    [].forEach.call($("faixaAlunosList").querySelectorAll(".bar"), function (el, i) { el.title = rows[i].l + ": " + rows[i].v + " aluno(s) · " + money(val[rows[i].k] || 0) + " em aberto"; });
    $("faixaAlunosNota").textContent = total + " aluno(s) com valor em aberto · " + FAIXAS_ATRASO.map(function (f) { return f.l.toLowerCase() + ": " + money(val[f.k] || 0); }).join(" · ");
  }
  $("faixaAlunosCart").addEventListener("change", renderFaixaAlunos);
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
      // com a contagem zerada, só conta quem foi incluído no Serasa a partir da data do zeramento
      if (x.serasa === "ok" && (!negInicio || (x.dataInclusao && x.dataInclusao >= negInicio))) { neg++; negAlunos[chaveDe(x)] = 1; }
      if (!x.serasa && ["", "ok", "negociado"].indexOf(x.mentor || "") !== -1) pend++;
      if (x.mentor === "pago" || x.serasa === "pago") pagas++;
      if (x.mentor === "juridico" || x.serasa === "juridico") jur++;
    });
    var tiles = [
      { n: Object.keys(alunosSet).length, l: "Alunos", cls: "lead" },
      { n: p.length, l: "Parcelas" },
      { n: neg, l: "Parcelas negativadas" + (negInicio ? " desde " + br(negInicio).slice(0, 5) : "") + " · " + Object.keys(negAlunos).length + " alunos", c: "success" },
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

  // ---------------------------------------------------------------- Painel jurídico
  // Carteira jurídica (GM Carvalho e Fraia). A base de alunos é montada uma vez por ano (importar
  // carteira ou novo caso) e atualizada todo mês pelos relatórios de inadimplência do sistema: cada
  // parcela vai para valor em aberto ou valor negociado conforme a conta financeira, e cada mês
  // importado (competência) fica guardado no histórico.
  var JUR_STATUS = [
    { k: "em_aberto", l: "Em aberto", c: "danger" },
    { k: "em_negociacao", l: "Em negociação GM", c: "info" },
    { k: "verificar", l: "Verificar", c: "brand" },
    { k: "quitado", l: "Quitado", c: "success" }
  ];
  var casosJur = [], jurCarregado = false, jurTab = "painel", jurLimite = 300, casoJur = null, jurComps = [], jurMovs = {};
  var jurModo = "inadimplencia", jurRelatorio = null, jurPendentes = [], jurLendo = 0, jurSemValor = [];
  var jurCarteiras = [], jurCartSel = "";
  try { jurCartSel = localStorage.getItem("jur_carteira") || ""; } catch (x) { /* navegador sem armazenamento */ }

  function jst(k) { for (var i = 0; i < JUR_STATUS.length; i++) if (JUR_STATUS[i].k === k) return JUR_STATUS[i]; return JUR_STATUS[0]; }
  function jpill(k) { var s = jst(k); return '<span class="pill" style="color:var(--' + s.c + ');background:var(--' + s.c + '-soft)"><i></i>' + s.l + "</span>"; }
  function moneyOu(v) { return v === null || v === undefined || v === "" ? "—" : money(v); }
  function ultimaObs(c) { return c.obs && c.obs.length ? c.obs[0].texto : ""; }
  function dataHora(iso) { if (!iso) return "—"; var d = new Date(iso); return isNaN(d) ? iso : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  function dataCurta(iso) { if (!iso) return "—"; var d = new Date(iso); return isNaN(d) ? br(iso) : d.toLocaleDateString("pt-BR"); }
  function opcoesStatusJur() { return JUR_STATUS.map(function (s) { return { v: s.k, l: s.l }; }); }
  function mesBR(m) { return m ? m.slice(5, 7) + "/" + m.slice(0, 4) : ""; }
  function unicos(campo) {
    var u = {}; casosJur.forEach(function (c) { if (c[campo]) u[c[campo]] = 1; });
    return Object.keys(u).sort();
  }
  function nomesIguaisJur(a, b) { var x = normHeader(a), y = normHeader(b); return !x || !y || x === y || x.indexOf(y) === 0 || y.indexOf(x) === 0; }

  function carregarJuridico() {
    return api("GET", "/api/juridico").then(function (d) {
      casosJur = d.casos; jurCarregado = true; jurComps = d.competencias || []; jurMovs = d.movimentos || {}; jurCarteiras = d.carteiras || []; marcarSync(true);
      if (view === "juridico") renderJuridico();
    }).catch(function (x) { marcarSync(false); if (x.status !== 401 && x.status !== 403) toast(x.message); });
  }
  function trocarCaso(c) {
    var i = casosJur.findIndex(function (x) { return x.id === c.id; });
    // a resposta de um caso só não traz as parcelas do acordo: mantém as que já estavam
    if (i !== -1 && !c.acordoParc) c.acordoParc = casosJur[i].acordoParc;
    if (i === -1) casosJur.push(c); else casosJur[i] = c;
  }
  function tirarCaso(id) { casosJur = casosJur.filter(function (x) { return x.id !== id; }); }

  // sub-abas: Painel / Novo caso / Evolução mensal
  function irJur(t) {
    jurTab = t;
    document.querySelectorAll("[data-jtab]").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-jtab") === t); });
    $("jurPainel").hidden = t !== "painel"; $("jurNovo").hidden = t !== "novo"; $("jurEvolucao").hidden = t !== "evolucao";
    if (t === "novo") prepararNovoCaso();
    renderJuridico();
  }
  document.querySelectorAll("[data-jtab]").forEach(function (b) { b.addEventListener("click", function () { irJur(b.getAttribute("data-jtab")); }); });

  function renderJuridico() {
    if (jurTab === "painel") { renderKpisJur(); renderTabelaJur(); }
    if (jurTab === "evolucao") renderEvoJur();
  }

  function kpiHtml(t) {
    return '<div class="kpi"><div class="num tabular"' + (t.c ? ' style="color:var(--' + t.c + ')"' : "") + ' title="' + esc(t.n) + '">' + t.n + '</div><div class="lbl">' + t.l + "</div>" + (t.s ? '<div class="kpi-sub muted">' + t.s + "</div>" : "") + "</div>";
  }
  function renderKpisJur() {
    var tot = casosJur.length, neg = 0, ab = 0, quit = 0, conf = 0;
    casosJur.forEach(function (c) {
      neg += Number(c.valorNegociado) || 0; ab += Number(c.valorAberto) || 0;
      if (c.status === "quitado") quit++;
      if (c.flagConflito) conf++;
    });
    $("jurKpis").innerHTML = [
      { n: tot, l: "Casos na carteira" },
      { n: money(ab), l: "Valor em aberto", c: "danger" },
      { n: money(neg), l: "Valor negociado GM", c: "info" },
      // uma casa decimal: com ~200 casos, cada caso vale meio ponto
      { n: (tot ? (quit / tot * 100).toFixed(1).replace(".", ",") : "0") + "%", l: "Quitados", c: "success", s: quit + " de " + tot + " casos" },
      { n: conf, l: "Para conferir", c: "warn" }
    ].map(kpiHtml).join("");
    // indicadores do último mês de referência importado (valores separados, nunca somados)
    var C = jurComps[0], P = jurComps[1], el = $("jurKpisComp");
    el.hidden = !C;
    if (!C) return;
    function varTxt(k) {
      if (!P) return "";
      var d = Math.round(((Number(C[k]) || 0) - (Number(P[k]) || 0)) * 100) / 100;
      return d ? (d > 0 ? "+" : "−") + money(Math.abs(d)) + " vs " + mesBR(P.mes) : "sem variação vs " + mesBR(P.mes);
    }
    el.innerHTML = '<div class="comp-tit">Competência <b>' + mesBR(C.mes) + "</b>" + (P ? " · comparada com " + mesBR(P.mes) : " · primeira competência importada") + "</div>" +
      '<div class="kpis k4">' + [
        { n: C.noRelatorio + " de " + C.casos, l: "Alunos da carteira no relatório" },
        { n: money(C.aberto), l: "Valor em aberto no mês", c: "danger", s: varTxt("aberto") },
        { n: money(C.negociado), l: "Valor negociado GM no mês", c: "info", s: varTxt("negociado") },
        { n: C.casosAberto + " · " + C.casosNegociado, l: "Casos em aberto · negociados" },
        { n: C.reclassificados || 0, l: "Mudaram de classificação", c: "brand" },
        { n: C.semMovimento || 0, l: "Sem movimentação" },
        { n: C.sairam || 0, l: "Deixaram de constar", c: "warn" },
        { n: C.foraDoPainel || 0, l: "Alunos do relatório fora da carteira", s: "ignorados" }
      ].map(kpiHtml).join("") + "</div>";
  }

  function filtrarJur() {
    prepararSelect($("jStatus"), [{ v: "", l: "Todos os status" }].concat(opcoesStatusJur()), "");
    renderCarteirasJur();
    var q = $("jBusca").value.trim().toLowerCase(), s = $("jStatus").value, ca = jurCartSel, cf = $("jConferir").value;
    return casosJur.filter(function (c) {
      if (s && c.status !== s) return false;
      if (ca && c.carteira !== ca) return false;
      if (cf === "conferir" && !c.flagConflito) return false;
      // "constam": apareceram no último relatório (qualquer movimento, menos "não consta")
      if (cf === "presente" && (!jurMovs[c.id] || jurMovs[c.id] === "ausente")) return false;
      if (cf && cf !== "conferir" && cf !== "presente" && jurMovs[c.id] !== cf) return false;
      if (q && [c.aluno, c.responsavel, c.ra].join(" ").toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).sort(function (a, b) { return (Number(b.valorAberto) || 0) - (Number(a.valorAberto) || 0) || (a.aluno || "").localeCompare(b.aluno || "", "pt-BR"); });
  }
  // parcelas do último relatório (em aberto e negociado juntas), pelo vencimento em relação a hoje
  // junta as parcelas do relatório com as do acordo GM ainda com saldo (a mesma parcela nas duas
  // fontes, mesmo vencimento e valor parecido, conta uma vez)
  function parcelasDoCaso(c) {
    var lista = (c.parcelasVenc || []).map(function (p) { return [p[0], Number(p[1]) || 0]; });
    (c.acordoParc || []).forEach(function (p) {
      var s = Number(p[1]) || 0;
      if (!lista.some(function (x) { return x[0] === p[0] && Math.abs(x[1] - s) <= Math.max(1, s * 0.3); })) lista.push([p[0], s]);
    });
    return lista;
  }
  function celParcelasJur(c, vencidas) {
    // vencidas: o relatório de inadimplência é a fonte (as datas do acordo podem não bater com as do
    // sistema); o acordo só entra quando ainda não há relatório. A vencer: relatório + acordo.
    var hj = hoje(), n = 0, v = 0, lista = vencidas && (c.parcelasVenc || []).length ? c.parcelasVenc.map(function (p) { return [p[0], Number(p[1]) || 0]; }) : parcelasDoCaso(c);
    if (!lista.length) return '<td class="muted">—</td>';
    lista.forEach(function (p) { if ((p[0] < hj) === vencidas) { n++; v += p[1]; } });
    return "<td>" + (n ? '<span class="tabular">' + n + (n === 1 ? " parcela" : " parcelas") + '</span><div class="meta tabular">' + money(v) + "</div>" : '<span class="muted">0</span>') + "</td>";
  }
  function qtdParc(n) { return n ? '<div class="meta">' + n + (n === 1 ? " parcela" : " parcelas") + "</div>" : ""; }
  function renderTabelaJur() {
    var vis = filtrarJur();
    var somaAb = 0, somaNeg = 0; vis.forEach(function (c) { somaAb += Number(c.valorAberto) || 0; somaNeg += Number(c.valorNegociado) || 0; });
    $("jurCount").textContent = vis.length + " de " + casosJur.length + " casos · em aberto " + money(somaAb) + " · negociado " + money(somaNeg);
    $("jurVazio").hidden = vis.length > 0;
    $("jurVazio").textContent = casosJur.length ? "Nenhum caso encontrado com estes filtros." : "A carteira está vazia. Use “Importar carteira” ou “Novo caso” para incluir os alunos.";
    var turmaPorRa = {}; baseAlunos.forEach(function (b) { if (b.ra && b.turma) turmaPorRa[String(b.ra).trim().toLowerCase()] = b.turma; });
    $("jurTbody").innerHTML = vis.slice(0, jurLimite).map(function (c) {
      var ob = ultimaObs(c), v = Number(c.valorAberto) || 0, turma = c.ra ? turmaPorRa[c.ra.trim().toLowerCase()] : "";
      return '<tr class="click" data-id="' + esc(c.id) + '">' +
        '<td><div class="nome">' + esc(c.aluno || "—") + (c.flagConflito ? ' <span class="pill" style="color:var(--warn);background:var(--warn-soft)" title="' + esc(c.conferirMotivo || "Precisa de conferência") + '"><i></i>Conferir</span>' : "") + '</div><div class="meta">' +
        esc(c.responsavel || "sem responsável informado") + (c.ra ? " · RA " + esc(c.ra) : "") + (turma ? " · " + esc(turma) : "") + "</div></td>" +
        "<td>" + jpill(c.status) + "</td>" +
        "<td>" + esc(c.carteira || "—") + (c.ano ? '<div class="meta">ano letivo ' + esc(c.ano) + "</div>" : "") + "</td>" +
        '<td class="muted obs-cell">' + esc(ob ? (ob.length > 60 ? ob.slice(0, 60).trim() + "…" : ob) : "—") + "</td>" +
        '<td class="muted">' + dataCurta(c.atualizadoEm) + (c.competencia ? '<div class="meta">ref. ' + mesBR(c.competencia) + "</div>" : "") + "</td></tr>";
    }).join("");
    $("jurMais").hidden = vis.length <= jurLimite;
    // casos filtrados sem nenhum valor que ainda não estão Quitado
    jurSemValor = vis.filter(function (c) { return c.status !== "quitado" && !(Number(c.valorAberto) > 0) && !(Number(c.valorNegociado) > 0); });
    var bq = $("jurQuitarLote"); bq.hidden = !jurSemValor.length; bq.classList.remove("armed");
    bq.textContent = "Marcar como Quitado os " + jurSemValor.length + " caso(s) sem valor";
  }
  ["jBusca", "jStatus", "jConferir"].forEach(function (id) { $(id).addEventListener("input", function () { jurLimite = 300; renderTabelaJur(); }); });
  $("jurMais").addEventListener("click", function () { jurLimite += 300; renderTabelaJur(); });
  $("jurTbody").addEventListener("click", function (e) { var tr = e.target.closest("tr[data-id]"); if (tr) abrirCasoJur(tr.getAttribute("data-id")); });
  $("jurQuitarLote").addEventListener("click", function () {
    var b = this, ids = jurSemValor.map(function (c) { return c.id; });
    if (!ids.length) return;
    if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Confirmar: " + ids.length + " caso(s) sem valor → Quitado"; return; }
    b.disabled = true;
    api("POST", "/api/juridico/quitar-sem-valor", { ids: ids }).then(function (d) {
      toast(d.quitados + " caso(s) marcados como Quitado."); return carregarJuridico();
    }).catch(function (x) { toast(x.message); }).then(function () { b.disabled = false; });
  });

  // ---- carteiras (mesmo modelo dos períodos da Serasa): seletor com a quantidade de casos,
  // editar (✎) e "+ Nova carteira"
  function carteiraAtual() { for (var i = 0; i < jurCarteiras.length; i++) if (jurCarteiras[i].nome === jurCartSel) return jurCarteiras[i]; return null; }
  function renderCarteirasJur() {
    var n = {}; casosJur.forEach(function (c) { if (c.carteira) n[c.carteira] = (n[c.carteira] || 0) + 1; });
    if (jurCartSel && !jurCarteiras.some(function (c) { return c.nome === jurCartSel; })) jurCartSel = "";
    var opcoes = [{ v: "", l: "Carteira: todas (" + casosJur.length + ")" }].concat(jurCarteiras.map(function (c) {
      return { v: c.nome, l: "Carteira: " + c.nome + (c.ano ? " · ano letivo " + c.ano : "") + " (" + (n[c.nome] || 0) + ")" };
    }));
    prepararSelect($("jCarteira"), opcoes.map(function (o) { return { v: esc(o.v), l: esc(o.l) }; }), jurCartSel);
    $("jCarteira").value = jurCartSel;
    $("btnEditarCarteira").hidden = !carteiraAtual();
    $("ncCarteiras").innerHTML = jurCarteiras.map(function (c) { return '<option value="' + esc(c.nome) + '"></option>'; }).join("");
  }
  $("jCarteira").addEventListener("change", function () {
    jurCartSel = this.value;
    try { localStorage.setItem("jur_carteira", jurCartSel); } catch (x) { /* sem armazenamento */ }
    jurLimite = 300; renderJuridico();
  });
  $("btnEditarCarteira").addEventListener("click", function () { var c = carteiraAtual(); if (c) abrirCarteiraJur(c); });
  $("btnNovaCarteira").addEventListener("click", function () { abrirCarteiraJur(null); });
  var carteiraEdit = null;
  function anoDaCarteira(nome) { var m = /(\d{4})\s*$/.exec(nome || ""); return m ? String(+m[1] - 1) : ""; }
  function abrirCarteiraJur(c) {
    carteiraEdit = c; mostrarErro($("carErr"), ""); delete $("carAno").dataset.mexeu;
    $("carTitulo").textContent = c ? "Editar carteira" : "Nova carteira";
    if (c) { $("carNome").value = c.nome; $("carAno").value = c.ano || ""; }
    else {
      // sugere o ano seguinte ao da carteira mais recente
      var maior = 0; jurCarteiras.forEach(function (x) { var m = /(\d{4})\s*$/.exec(x.nome); if (m && +m[1] > maior) maior = +m[1]; });
      var nome = "Carteira " + (maior ? maior + 1 : new Date().getFullYear());
      $("carNome").value = nome; $("carAno").value = anoDaCarteira(nome);
    }
    var qtd = c ? casosJur.filter(function (x) { return x.carteira === c.nome; }).length : 0;
    $("carInfo").textContent = c ? qtd + " caso(s) nesta carteira. Mudar o nome ou o ano letivo muda também os casos dela." : "Depois de criar, importe os alunos em “Importar carteira” ou inclua em “Novo caso”.";
    var bx = $("carExcluir"); bx.hidden = !c; bx.classList.remove("armed"); bx.textContent = "Excluir carteira";
    abrir("mCarteira"); setTimeout(function () { $("carNome").focus(); }, 30);
  }
  $("carNome").addEventListener("input", function () { if (!$("carAno").dataset.mexeu) $("carAno").value = anoDaCarteira(this.value); });
  $("carAno").addEventListener("input", function () { this.dataset.mexeu = "1"; });
  $("formCarteira").addEventListener("submit", function (e) {
    e.preventDefault();
    var dados = { nome: $("carNome").value.trim(), ano: $("carAno").value.trim() };
    var req = carteiraEdit ? api("PATCH", "/api/juridico/carteiras/" + encodeURIComponent(carteiraEdit.id), dados) : api("POST", "/api/juridico/carteiras", dados);
    req.then(function (d) {
      jurCartSel = d.carteira.nome;
      try { localStorage.setItem("jur_carteira", jurCartSel); } catch (x) { /* sem armazenamento */ }
      fecharModais(); toast(carteiraEdit ? "Carteira atualizada." : "Carteira criada."); return carregarJuridico();
    }).catch(function (x) { mostrarErro($("carErr"), x.message); });
  });
  $("carExcluir").addEventListener("click", function () {
    var b = this;
    if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Confirmar exclusão"; return; }
    api("DELETE", "/api/juridico/carteiras/" + encodeURIComponent(carteiraEdit.id)).then(function () {
      jurCartSel = ""; fecharModais(); toast("Carteira excluída."); return carregarJuridico();
    }).catch(function (x) { mostrarErro($("carErr"), x.message); b.classList.remove("armed"); b.textContent = "Excluir carteira"; });
  });

  // ficha do aluno
  function renderObsJur(c) {
    $("jcObsLog").innerHTML = c.obs && c.obs.length ? c.obs.map(function (o) {
      // editar/excluir: quem registrou ou administrador (o servidor confere de novo)
      var pode = o.id && eu && (eu.perfil === "admin" || o.autor === eu.nome);
      return '<div class="ob" data-obs="' + esc(o.id || "") + '"><div class="meta">' + dataHora(o.data) + (o.autor ? " · " + esc(o.autor) : "") +
        (o.editado_em ? " · editado" + (o.editado_por ? " por " + esc(o.editado_por) : "") + " em " + dataHora(o.editado_em) : "") +
        (pode ? '<span class="ob-acoes"><button type="button" class="linkbtn" data-ob-editar>Editar</button><button type="button" class="linkbtn danger" data-ob-excluir>Excluir</button></span>' : "") +
        '</div><div class="ob-texto">' + esc(o.texto) + "</div></div>";
    }).join("") : '<div class="ob-vazio">Nenhuma tratativa registrada ainda.</div>';
  }
  function atualizarFicha(d, msg) { trocarCaso(d.caso); casoJur = d.caso; preencherFicha(d.caso); renderJuridico(); if (msg) toast(msg); }
  $("jcObsLog").addEventListener("click", function (e) {
    var el = e.target.closest(".ob"); if (!el || !casoJur) return;
    var id = el.getAttribute("data-obs"), o = null;
    (casoJur.obs || []).forEach(function (x) { if (x.id === id) o = x; });
    if (!o) return;
    var url = "/api/juridico/" + encodeURIComponent(casoJur.id) + "/obs/" + encodeURIComponent(id);
    if (e.target.closest("[data-ob-editar]")) {
      el.querySelector(".ob-texto").innerHTML = '<textarea rows="3" class="ob-edit">' + esc(o.texto) + '</textarea><div class="row-end" style="justify-content:flex-start;margin-top:4px">' +
        '<button type="button" class="btn primary small" data-ob-salvar>Salvar</button><button type="button" class="btn ghost small" data-ob-cancelar>Cancelar</button></div>';
      el.querySelector(".ob-acoes").hidden = true; el.querySelector("textarea").focus();
    } else if (e.target.closest("[data-ob-cancelar]")) {
      renderObsJur(casoJur);
    } else if (e.target.closest("[data-ob-salvar]")) {
      var t = el.querySelector("textarea").value.trim();
      if (!t) return mostrarErro($("jcErr"), "A tratativa não pode ficar em branco. Para apagar, use Excluir.");
      e.target.disabled = true;
      api("PATCH", url, { texto: t }).then(function (d) { mostrarErro($("jcErr"), ""); atualizarFicha(d, "Tratativa corrigida."); })
        .catch(function (x) { e.target.disabled = false; mostrarErro($("jcErr"), x.message); });
    } else if (e.target.closest("[data-ob-excluir]")) {
      var b = e.target.closest("[data-ob-excluir]");
      if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Confirmar exclusão"; return; }
      api("DELETE", url).then(function (d) { mostrarErro($("jcErr"), ""); atualizarFicha(d, "Tratativa excluída."); })
        .catch(function (x) { mostrarErro($("jcErr"), x.message); });
    }
  });
  function preencherFicha(c) {
    $("jcTitulo").textContent = c.aluno || "Caso";
    $("jcSub").textContent = "RA " + (c.ra || "—") + " · " + (c.carteira || "—") + " · ano letivo " + (c.ano || "—") + (c.competencia ? " · ref. " + mesBR(c.competencia) : "");
    $("jcConflito").hidden = !c.flagConflito;
    $("jcConflitoTxt").textContent = c.conferirMotivo || "Este caso precisa de conferência.";
    $("jcResumo").innerHTML = [
      ["Valor em aberto", money(c.valorAberto || 0) + qtdParc(c.parcelas)],
      ["Valor negociado GM", money(c.valorNegociado || 0) + qtdParc(c.parcelasNegociado)],
      ["Parcelas vencidas", celParcelasJur(c, true).replace(/^<td[^>]*>|<\/td>$/g, "")],
      ["Parcelas a vencer", celParcelasJur(c, false).replace(/^<td[^>]*>|<\/td>$/g, "")]
    ].map(function (x) { return '<div class="kpi"><div class="lbl">' + x[0] + '</div><div class="num tabular" style="font-size:16px">' + x[1] + "</div></div>"; }).join("");
    $("jcContato").innerHTML = '<div class="meta">Responsável: <b>' + esc(c.responsavel || "—") + "</b> · Telefone: " + esc(c.celular || "—") + " · E-mail: " + esc(c.email || "—") +
      '</div><div class="meta">Conta(s) financeira(s) de origem: ' + esc(c.contaFinanceira || "—") + "</div>" +
      '<div class="meta">' + (c.cpf ? "CPF: " + esc(c.cpf) + " · " : "") + (c.dataEnvio ? "Enviado ao jurídico em " + br(c.dataEnvio) + " · " : "") + (c.extrato != null ? "Extrato: " + money(c.extrato) + " · " : "") + (c.motivo ? "Motivo: " + esc(c.motivo) + " · " : "") +
      (c.linkDrive ? '<a class="linkbtn" href="' + esc(c.linkDrive) + '" target="_blank" rel="noopener">Abrir documentos (Drive) ↗</a>' : "sem link do Drive") + "</div>";
    // resumo do acordo GM (da planilha da carteira)
    var a = c.acordo || {};
    $("jcAcordoBox").hidden = !a.tipo;
    $("jcAcordo").innerHTML = a.tipo ? '<div class="kpis k4" style="margin:0">' + [
      ["Acordo", esc(a.tipo)], ["Valor do acordo", moneyOu(a.valor)], ["Pago", moneyOu(a.pago)],
      ["Saldo em aberto · a vencer", moneyOu(a.saldoAberto) + " · " + moneyOu(a.saldoVencer) + (a.parcVencer ? '<div class="meta">' + a.parcVencer + " parcela(s) a vencer</div>" : "")]
    ].map(function (x) { return '<div class="kpi"><div class="lbl">' + x[0] + '</div><div class="num tabular" style="font-size:15px">' + x[1] + "</div></div>"; }).join("") + "</div>" : "";
    renderObsJur(c);
    $("jcAtualizado").textContent = "Última atualização: " + (c.atualizadoEm ? dataHora(c.atualizadoEm) + (c.atualizadoPor ? " por " + c.atualizadoPor : "") : "nunca");
  }
  function abrirCasoJur(id) {
    var c = null; casosJur.forEach(function (x) { if (x.id === id) c = x; });
    if (!c) return;
    casoJur = c; mostrarErro($("jcErr"), "");
    fill($("jcStatus"), opcoesStatusJur()); $("jcStatus").value = c.status || "em_aberto";
    $("jcAluno").value = c.aluno || ""; $("jcRa").value = c.ra || ""; $("jcCarteira").value = c.carteira || ""; $("jcAno").value = c.ano || "";
    $("jcCpf").value = c.cpf || ""; $("jcExtrato").value = c.extrato == null ? "" : c.extrato; $("jcDataEnvio").value = c.dataEnvio || ""; $("jcMotivo").value = c.motivo || ""; $("jcLink").value = c.linkDrive || "";
    $("jcAcordoParc").innerHTML = "";
    $("jcNovaObs").value = "";
    var b = $("jcExcluir"); b.classList.remove("armed"); b.textContent = "Excluir caso";
    preencherFicha(c); carregarHistCaso(c.id);
    abrir("mJurCaso");
  }
  function salvarCasoJur(dados) {
    return api("PATCH", "/api/juridico/" + encodeURIComponent(casoJur.id), dados).then(function (d) { atualizarFicha(d); return d; });
  }
  // status salva sozinho (fica registrado nas tratativas)
  $("jcStatus").addEventListener("change", function () {
    mostrarErro($("jcErr"), "");
    salvarCasoJur({ status: this.value }).then(function () { toast("Status salvo."); }).catch(function (x) { mostrarErro($("jcErr"), x.message); });
  });
  $("jcSalvarDados").addEventListener("click", function () {
    if (!$("jcAluno").value.trim()) return mostrarErro($("jcErr"), "Informe o nome do aluno.");
    var btn = this; btn.disabled = true; mostrarErro($("jcErr"), "");
    var ex = parseFloat($("jcExtrato").value);
    salvarCasoJur({ aluno: $("jcAluno").value.trim(), ra: $("jcRa").value.trim(), carteira: $("jcCarteira").value.trim(), ano: $("jcAno").value.trim(),
      cpf: $("jcCpf").value.trim(), extrato: isNaN(ex) ? null : ex, dataEnvio: $("jcDataEnvio").value, motivo: $("jcMotivo").value.trim(), linkDrive: $("jcLink").value.trim() })
      .then(function () { toast("Dados do aluno salvos."); }).catch(function (x) { mostrarErro($("jcErr"), x.message); }).then(function () { btn.disabled = false; });
  });
  $("jcAddObs").addEventListener("click", function () {
    var t = $("jcNovaObs").value.trim();
    if (!t) return mostrarErro($("jcErr"), "Escreva a tratativa antes de adicionar.");
    var btn = this; btn.disabled = true; mostrarErro($("jcErr"), "");
    api("POST", "/api/juridico/" + encodeURIComponent(casoJur.id) + "/obs", { texto: t }).then(function (d) {
      $("jcNovaObs").value = ""; atualizarFicha(d, "Tratativa registrada.");
    }).catch(function (x) { mostrarErro($("jcErr"), x.message); }).then(function () { btn.disabled = false; });
  });
  // aviso de conferência: some só quando alguém marca como conferido
  $("jcConferido").addEventListener("click", function () {
    var btn = this; btn.disabled = true;
    salvarCasoJur({ flagConflito: false }).then(function () { toast("Caso marcado como conferido."); })
      .catch(function (x) { mostrarErro($("jcErr"), x.message); }).then(function () { btn.disabled = false; });
  });
  $("jcExcluir").addEventListener("click", function () {
    var b = this;
    if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Confirmar: excluir caso, tratativas e histórico"; return; }
    api("DELETE", "/api/juridico/" + encodeURIComponent(casoJur.id)).then(function () {
      tirarCaso(casoJur.id); $("mJurCaso").hidden = true; renderJuridico(); toast("Caso excluído.");
    }).catch(function (x) { mostrarErro($("jcErr"), x.message); });
  });
  // evolução do aluno mês a mês (competências importadas)
  var MOV_JUR = {
    primeira: { l: "Primeira competência", c: "gray" }, novo: { l: "Entrou no relatório", c: "info" }, reclassificado: { l: "Mudou de classificação", c: "brand" },
    alterado: { l: "Valor alterado", c: "gold" }, outra_carteira: { l: "Parcelas em outra carteira", c: "warn" }, sem_movimento: { l: "Sem movimentação", c: "gray" }, ausente: { l: "Não consta no relatório", c: "warn" }
  };
  function movPill(t) { var s = MOV_JUR[t]; return s ? '<span class="pill" style="color:var(--' + s.c + ');background:var(--' + s.c + '-soft)"><i></i>' + s.l + "</span>" : "—"; }
  function carregarHistCaso(id) {
    var el = $("jcHist"); el.innerHTML = '<div class="meta">Carregando…</div>';
    api("GET", "/api/juridico/" + encodeURIComponent(id) + "/historico").then(function (d) {
      if (!casoJur || casoJur.id !== id) return;
      // parcelas do acordo GM: a situação é recalculada pela data de hoje (paga, vencida ou a vencer)
      var ap = d.acordoParcelas || [], hj = hoje();
      $("jcAcordoParc").innerHTML = ap.length ? '<div class="table-wrap" style="max-height:240px;overflow:auto"><table class="data compacta"><thead><tr><th>Acordo</th><th>Parcela</th><th>Vencimento</th><th class="right">Valor</th><th class="right">Pago</th><th>Data pgto.</th><th class="right">Saldo</th><th>Situação</th></tr></thead><tbody>' +
        ap.map(function (p) {
          var sit = !(Number(p.saldo) > 0.009) && (Number(p.pago) > 0 || p.situacao === "Paga") ? ["Paga", "success"] : p.vencimento && p.vencimento < hj ? ["Vencida", "danger"] : ["A vencer", "info"];
          return "<tr><td>" + esc(p.acordo || "—") + "</td><td>" + esc(p.parcela || "—") + "</td><td>" + (p.vencimento ? br(p.vencimento) : "—") + '</td><td class="tabular right">' + moneyOu(p.valor) + '</td><td class="tabular right">' + moneyOu(p.pago) +
            "</td><td>" + (p.dataPagamento ? br(p.dataPagamento) : "—") + '</td><td class="tabular right">' + moneyOu(p.saldo) + '</td><td><span class="pill" style="color:var(--' + sit[1] + ");background:var(--" + sit[1] + '-soft)"><i></i>' + sit[0] + "</span></td></tr>";
        }).join("") + "</tbody></table></div>" : "";
      if (ap.length) $("jcAcordoBox").hidden = false;
      var h = d.historico || [];
      el.innerHTML = h.length ? '<div class="table-wrap" style="max-height:220px;overflow:auto"><table class="data compacta"><thead><tr><th>Mês</th><th class="right">Em aberto</th><th class="right">Negociado</th><th>Movimento</th><th>Contas financeiras</th></tr></thead><tbody>' +
        h.slice().reverse().map(function (x) {
          var contas = Object.keys(x.contas || {}).map(function (k) { return esc(k) + " " + money(x.contas[k]); }).join("<br>");
          return "<tr><td><b>" + mesBR(x.mes) + '</b></td><td class="tabular right">' + (x.ausente ? "—" : money(x.valorAberto)) + '</td><td class="tabular right">' + (x.ausente ? "—" : money(x.valorNegociado)) + "</td><td>" + movPill(x.movimento) +
            (x.conferir ? '<div class="meta" style="color:var(--warn)">' + esc(x.conferir) + "</div>" : "") + '</td><td class="meta">' + (contas || "—") + "</td></tr>";
        }).join("") + "</tbody></table></div>" : '<div class="meta">Nenhuma competência importada ainda para este aluno.</div>';
    }).catch(function () { el.innerHTML = '<div class="meta">Não foi possível carregar o histórico.</div>'; });
  }

  // novo caso (só entra na carteira; os valores vêm do relatório de inadimplência)
  function prepararNovoCaso() {
    $("formJurNovo").reset(); mostrarErro($("ncErr"), "");
    // carteira da lista (a selecionada no Painel, se houver); o ano letivo vem dela
    fill($("ncCarteira"), jurCarteiras.map(function (c) { return { v: c.nome, l: c.nome }; }), jurCarteiras.length ? null : "Crie uma carteira primeiro");
    if (jurCartSel) $("ncCarteira").value = jurCartSel;
    var cs = null; jurCarteiras.forEach(function (c) { if (c.nome === $("ncCarteira").value) cs = c; });
    $("ncAno").value = cs ? cs.ano || "" : "";
    carregarBaseDados(); // para completar o nome pelo RA
    setTimeout(function () { $("ncRa").focus(); }, 30);
  }
  $("ncRa").addEventListener("change", function () {
    var ra = this.value.trim().toLowerCase(); if (!ra) return;
    var b = null; baseAlunos.forEach(function (x) { if (String(x.ra || "").trim().toLowerCase() === ra) b = x; });
    if (b && !$("ncAluno").value.trim()) { $("ncAluno").value = b.nome || ""; toast("Nome preenchido pela Base de dados."); }
  });
  $("ncCarteira").addEventListener("change", function () { var v = this.value; jurCarteiras.forEach(function (c) { if (c.nome === v) $("ncAno").value = c.ano || ""; }); });
  $("ncCancelar").addEventListener("click", function () { irJur("painel"); });
  $("formJurNovo").addEventListener("submit", function (e) {
    e.preventDefault();
    var err = $("ncErr");
    if (!$("ncAluno").value.trim()) return mostrarErro(err, "Informe o nome do aluno.");
    var btn = $("ncSalvar"); btn.disabled = true; mostrarErro(err, "");
    api("POST", "/api/juridico", { aluno: $("ncAluno").value.trim(), ra: $("ncRa").value.trim(), carteira: $("ncCarteira").value.trim(), ano: $("ncAno").value.trim() })
      .then(function (d) { trocarCaso(d.caso); irJur("painel"); toast("Aluno incluído na carteira."); })
      .catch(function (x) { mostrarErro(err, x.message); }).then(function () { btn.disabled = false; });
  });

  // bibliotecas carregadas só quando precisa: planilha Excel e gráficos
  function carregarScript(url, global) {
    if (window[global]) return Promise.resolve(window[global]);
    return new Promise(function (ok, falhou) {
      var s = document.createElement("script"); s.src = url;
      s.onload = function () { ok(window[global]); };
      s.onerror = function () { falhou(new Error("Não consegui carregar um componente do site. Confira a internet e tente de novo.")); };
      document.head.appendChild(s);
    });
  }
  function carregarXLSX() { return carregarScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js", "XLSX"); }
  function carregarChart() { return carregarScript("https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js", "Chart"); }
  function baixarXLSX(nome, aba, linhas) {
    return carregarXLSX().then(function (X) {
      var wb = X.utils.book_new(); X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(linhas), aba); X.writeFile(wb, nome);
    }).catch(function (x) { toast(x.message); });
  }
  $("btnJurModelo").addEventListener("click", function () {
    baixarXLSX("modelo-carteira-juridica.xlsx", "Carteira", [["RA", "Aluno", "Carteira", "Ano letivo", "Status", "CPF", "Link Drive", "Extrato (R$)", "Motivo pendência", "Data envio jurídico", "Última observação", "Acordo GM", "Valor negociado (R$)", "Valor pago do acordo (R$)", "Saldo do acordo em aberto (R$)", "Saldo do acordo a vencer (R$)", "Parcelas do acordo a vencer"], ["", "", "Carteira 2026", "2025", "Em aberto / Em negociação GM / Verificar / Quitado"]]);
  });

  // ---- importação da carteira: RA, Aluno, Carteira e Ano letivo, e (se a planilha tiver) status,
  // CPF, link do Drive, extrato, motivo, data de envio, observações e o acordo GM com as parcelas
  var JUR_COLUNAS = {
    ra: ["ra", "matricula", "codigo"], aluno: ["aluno", "nome do aluno", "nome"], carteira: ["carteira"], ano: ["ano letivo", "ano", "ano de referencia"],
    responsavel: ["responsavel", "responsavel financeiro", "nome do responsavel"], email: ["e-mail", "email"], celular: ["celular", "telefone"],
    status: ["status", "situacao"], cpf: ["cpf", "cpf do responsavel"], linkDrive: ["link drive", "link do drive", "pasta do drive", "link dos documentos", "drive"],
    extrato: ["extrato (r$)", "extrato"], motivo: ["motivo pendencia", "motivo"], dataEnvio: ["data envio juridico", "data de envio ao juridico"],
    obsUlt: ["ultima observacao", "observacao"], hist: ["historico de observacoes"],
    acordoTipo: ["acordo gm"], acordoValor: ["valor negociado (r$)", "valor negociado", "valor do acordo (r$)", "valor do acordo"],
    acordoPago: ["valor pago do acordo (r$)", "valor pago do acordo"], acordoSaldoAberto: ["saldo do acordo em aberto (r$)", "saldo do acordo em aberto"],
    acordoSaldoVencer: ["saldo do acordo a vencer (r$)", "saldo do acordo a vencer"], acordoParcVencer: ["parcelas do acordo a vencer"]
  };
  // aba com as parcelas do acordo GM (uma linha por parcela)
  var ACORDO_COLUNAS = {
    ra: ["ra", "codigo"], aluno: ["aluno", "nome"], acordo: ["acordo"], parcela: ["parcela", "parc."], vencimento: ["vencimento", "data vcto."],
    valor: ["valor (r$)", "valor"], pago: ["pago (r$)", "pago"], dataPagamento: ["data pagamento", "data de pagamento"], saldo: ["saldo (r$)", "saldo"], situacao: ["situacao parcela", "situacao"]
  };
  // nome exato primeiro; parte do nome só para nomes longos ("ra" não pode casar com "carteira")
  function colunaJur(h, nomes) {
    for (var n = 0; n < nomes.length; n++) { var i = h.indexOf(nomes[n]); if (i !== -1) return i; }
    for (var j = 0; j < h.length; j++) for (var m = 0; m < nomes.length; m++) if (nomes[m].length >= 5 && h[j] && h[j].indexOf(nomes[m]) !== -1) return j;
    return -1;
  }
  function valorCelula(v) { if (v === "" || v == null) return undefined; return typeof v === "number" ? v : (/\d/.test(String(v)) ? parseMoneyBR(v) : undefined); }
  // data do Excel pode vir à meia-noite UTC (21h do dia anterior aqui): meio-dia evita cair no dia errado
  function dataCelula(v) { if (!v) return undefined; if (v instanceof Date) return isoLocal(new Date(v.getTime() + 12 * 3600000)); return parseDateBR(v) || undefined; }
  function tabelaDoExcel(buf) {
    return carregarXLSX().then(function (X) {
      var wb = X.read(buf, { type: "array", cellDates: true });
      return wb.SheetNames.map(function (nome) {
        var aoa = X.utils.sheet_to_json(wb.Sheets[nome], { header: 1, defval: "", raw: true, blankrows: true });
        // a linha de títulos pode não ser a primeira: usa a que mais parece cabeçalho
        var melhor = 0, nota = -1;
        for (var i = 0; i < Math.min(aoa.length, 8); i++) {
          var h = aoa[i].map(normHeader), sc = 0;
          Object.keys(JUR_COLUNAS).forEach(function (k) { if (colunaJur(h, JUR_COLUNAS[k]) !== -1) sc++; });
          if (sc > nota) { nota = sc; melhor = i; }
        }
        return { aba: wb.SheetNames.length > 1 ? nome : "", headers: (aoa[melhor] || []).map(normHeader), rows: aoa.slice(melhor + 1) };
      });
    });
  }
  // status escrito na planilha → um dos 4 status (null quando não reconhece)
  function statusDaPlanilha(v) {
    var t = normHeader(v); if (!t) return null;
    for (var i = 0; i < JUR_STATUS.length; i++) if (normHeader(JUR_STATUS[i].l) === t || JUR_STATUS[i].k === t) return JUR_STATUS[i].k;
    if (/quitad|liquidad|^pag[oa]s?$/.test(t)) return "quitado";
    if (/verific|conferir|manual/.test(t)) return "verificar";
    if (/em dia|acordo em dia|cumprindo|em negociac|negociado/.test(t)) return "em_negociacao";
    if (/sem acordo|devendo|aberto|atras|inadimpl|pendent|vencid|parcial/.test(t)) return "em_aberto";
    return null;
  }
  // "[25/09/2026] texto | [26/09/2026] texto" → [{ data, texto }]
  function obsDaPlanilha(hist, ult) {
    var out = [];
    String(hist || "").split(/\s+\|\s+/).forEach(function (p) {
      p = p.trim(); if (!p) return;
      var m = /^\[(\d{2}\/\d{2}\/\d{4})\]\s*(.*)$/.exec(p);
      out.push(m ? { data: parseDateBR(m[1]) || "", texto: m[2].trim() } : { data: "", texto: p });
    });
    if (!out.length && String(ult || "").trim()) out.push({ data: "", texto: String(ult).trim() });
    return out.filter(function (o) { return o.texto; });
  }
  // aba "Carteira 2026" sem coluna Carteira: a carteira é o nome da aba e o ano letivo é o anterior
  function linhasCarteira(t, stNao) {
    var ix = {}; Object.keys(JUR_COLUNAS).forEach(function (k) { ix[k] = colunaJur(t.headers, JUR_COLUNAS[k]); });
    if (ix.aluno === -1 && ix.ra === -1) return [];
    var temAcordo = ix.acordoTipo !== -1;
    var mCart = /^carteira\s+(\d{4})$/i.exec(String(t.aba || "").trim());
    var out = [];
    t.rows.forEach(function (r) {
      function bruto(k) { return ix[k] === -1 ? "" : r[ix[k]]; }
      function cel(k) { var v = bruto(k); return v instanceof Date ? v : String(v == null ? "" : v).trim(); }
      var l = { ra: String(cel("ra")).replace(/\.0+$/, ""), aluno: cel("aluno"), carteira: cel("carteira"), ano: String(cel("ano")).replace(/\.0+$/, "") };
      if (!l.ra && !l.aluno) return;
      if (!l.ra && /^(total|soma|subtotal)\b/i.test(normHeader(l.aluno))) return;
      if (!l.carteira && mCart) l.carteira = "Carteira " + mCart[1];
      if (!l.ano && /^carteira\s+(\d{4})$/i.test(l.carteira)) l.ano = String(+/(\d{4})/.exec(l.carteira)[1] - 1);
      var st = cel("status");
      if (st) { l.status = statusDaPlanilha(st); l._stOrig = st; if (!l.status) { stNao[st] = (stNao[st] || 0) + 1; delete l.status; } }
      var cpf = String(cel("cpf")).replace(/\.0+$/, ""); if (/^\d{8,10}$/.test(cpf)) cpf = ("00000000000" + cpf).slice(-11); if (cpf) l.cpf = cpf; // CPF salvo como número perde o zero da frente
      // contato da planilha: só vale quando a Base de dados não tem o aluno
      ["responsavel", "email", "celular"].forEach(function (k) { var v = String(cel(k)); if (v) l[k] = v; });
      var link = cel("linkDrive"); if (/^https?:\/\//i.test(link)) l.linkDrive = link;
      var ex = valorCelula(bruto("extrato")); if (ex != null) l.extrato = ex;
      if (cel("motivo")) l.motivo = cel("motivo");
      var de = dataCelula(bruto("dataEnvio")); if (de) l.dataEnvio = de;
      var obs = obsDaPlanilha(cel("hist"), cel("obsUlt")); if (obs.length) l.obs = obs;
      if (temAcordo) {
        var parcV = parseInt(String(cel("acordoParcVencer")).replace(/\D/g, ""), 10) || 0;
        l.acordo = { tipo: String(cel("acordoTipo")), valor: valorCelula(bruto("acordoValor")), pago: valorCelula(bruto("acordoPago")),
          saldoAberto: valorCelula(bruto("acordoSaldoAberto")), saldoVencer: valorCelula(bruto("acordoSaldoVencer")), parcVencer: parcV };
      }
      out.push(l);
    });
    return out;
  }
  function parcelasAcordoDaTabela(t) {
    var ix = {}; Object.keys(ACORDO_COLUNAS).forEach(function (k) { ix[k] = colunaJur(t.headers, ACORDO_COLUNAS[k]); });
    var out = [];
    t.rows.forEach(function (r) {
      function bruto(k) { return ix[k] === -1 ? "" : r[ix[k]]; }
      var ra = String(bruto("ra") == null ? "" : bruto("ra")).trim().replace(/\.0+$/, ""), aluno = String(bruto("aluno") || "").trim();
      if (!ra && !aluno) return;
      out.push({ ra: ra, aluno: aluno, acordo: String(bruto("acordo") || "").trim(), parcela: String(bruto("parcela") == null ? "" : bruto("parcela")).replace(/\.0+$/, ""),
        vencimento: dataCelula(bruto("vencimento")) || "", valor: valorCelula(bruto("valor")), pago: valorCelula(bruto("pago")),
        dataPagamento: dataCelula(bruto("dataPagamento")) || "", saldo: valorCelula(bruto("saldo")), situacao: String(bruto("situacao") || "").trim() });
    });
    return out;
  }
  function ehAbaAcordo(t) { return colunaJur(t.headers, ["acordo"]) !== -1 && colunaJur(t.headers, ["vencimento"]) !== -1 && colunaJur(t.headers, ["saldo (r$)", "saldo", "situacao parcela"]) !== -1 && colunaJur(t.headers, JUR_COLUNAS.carteira) === -1; }
  var jurComAcordos = false;
  function receberCarteiraJur(f) {
    var res = $("jurImpRes"); res.innerHTML = '<div class="meta">Lendo ' + esc(f.name) + "…</div>";
    jurPendentes = []; jurComAcordos = false; $("jurImpOk").disabled = true;
    var r = new FileReader();
    r.onload = function () {
      var buf = new Uint8Array(r.result);
      var p = ehExcel(f) ? tabelaDoExcel(buf) : Promise.resolve([parseCSV(new TextDecoder("utf-8").decode(buf))]);
      p.then(function (ts) {
        // planilha com várias abas: se alguma aba tem a coluna Carteira (ou se chama "Carteira AAAA"),
        // só essas são a lista de alunos; a aba das parcelas do acordo GM entra como detalhe do acordo
        var comCart = ts.filter(function (t) { return colunaJur(t.headers, JUR_COLUNAS.carteira) !== -1 || /^carteira\s+\d{4}$/i.test(String(t.aba || "").trim()); });
        var usar = comCart.length ? comCart : ts.filter(function (t) { return !ehAbaAcordo(t); });
        var abaAcordo = ts.filter(ehAbaAcordo)[0] || null;
        var stNao = {}, linhas = [], vistos = {};
        usar.forEach(function (t) {
          linhasCarteira(t, stNao).forEach(function (l) {
            // o mesmo aluno repetido na mesma carteira conta uma vez
            var k = (l.ra || normHeader(l.aluno)) + "|" + normHeader(l.carteira);
            if (!vistos[k]) { vistos[k] = 1; linhas.push(l); }
          });
        });
        if (!linhas.length) throw new Error("Não achei as colunas RA ou Aluno. Use o modelo (botão “Baixar modelo”).");
        // link do Drive repetido em alunos diferentes é fórmula arrastada: não vale para ninguém
        var donos = {}, linksRuins = 0;
        linhas.forEach(function (l) { if (l.linkDrive) (donos[l.linkDrive] = donos[l.linkDrive] || {})[l.ra || normHeader(l.aluno)] = 1; });
        linhas.forEach(function (l) { if (l.linkDrive && Object.keys(donos[l.linkDrive]).length > 1) { delete l.linkDrive; linksRuins++; } });
        // parcelas do acordo: vão para o caso do aluno que tem acordo (pelo RA ou pelo nome)
        var nParcAcordo = 0, parcSemCaso = 0;
        jurComAcordos = linhas.some(function (l) { return l.acordo; }) || !!abaAcordo;
        if (abaAcordo) {
          var ps = parcelasAcordoDaTabela(abaAcordo);
          ps.forEach(function (pc) {
            var alvo = linhas.filter(function (l) { return l.acordo && l.acordo.tipo && ((pc.ra && l.ra === pc.ra) || (!pc.ra && nomesIguaisJur(l.aluno, pc.aluno))); })[0] ||
              linhas.filter(function (l) { return (pc.ra && l.ra === pc.ra) || (!pc.ra && nomesIguaisJur(l.aluno, pc.aluno)); })[0];
            if (!alvo) { parcSemCaso++; return; }
            (alvo.parcelasAcordo = alvo.parcelasAcordo || []).push(pc); nParcAcordo++;
          });
        }
        jurPendentes = linhas;
        var existe = function (l) { return casosJur.some(function (c) { return ((l.ra && c.ra === l.ra) || (!l.ra && normHeader(c.aluno) === normHeader(l.aluno))) && (!l.carteira || !c.carteira || normHeader(c.carteira) === normHeader(l.carteira)); }); };
        var ja = linhas.filter(existe).length, semCart = linhas.filter(function (l) { return !l.carteira; }).length;
        // linhas sem a coluna Carteira: vão para a carteira escolhida aqui
        var destino = semCart ? '<div class="field"><label for="jurCartDest">Carteira destas linhas</label><select id="jurCartDest">' + jurCarteiras.map(function (c) {
          return '<option value="' + esc(c.nome) + '"' + (c.nome === jurCartSel ? " selected" : "") + ">" + esc(c.nome) + (c.ano ? " · ano letivo " + esc(c.ano) : "") + "</option>";
        }).join("") + '</select><span class="hint">' + semCart + " linha(s) sem a coluna Carteira vão para esta carteira. Não está na lista? Crie em “+ Nova carteira”.</span></div>" : "";
        // resumo do que vem além de RA/Aluno/Carteira/Ano
        var porSt = {}; linhas.forEach(function (l) { if (l.status) porSt[l.status] = (porSt[l.status] || 0) + 1; });
        var conta = function (f) { return linhas.filter(f).length; };
        var itens = [
          ["Status", JUR_STATUS.filter(function (s) { return porSt[s.k]; }).map(function (s) { return jpill(s.k) + ' <b class="tabular">' + porSt[s.k] + "</b>"; }).join(" &nbsp; ") || "—"],
          ["CPF", conta(function (l) { return l.cpf; })], ["Link do Drive", conta(function (l) { return l.linkDrive; }) + (linksRuins ? " (" + linksRuins + " repetido(s) em alunos diferentes, não usados)" : "")],
          ["Acordo GM", conta(function (l) { return l.acordo && l.acordo.tipo; }) + " aluno(s)" + (abaAcordo ? " · " + nParcAcordo + " parcela(s) do acordo" + (parcSemCaso ? " (" + parcSemCaso + " sem aluno na lista, ignoradas)" : "") : "")],
          ["Observações (viram tratativas)", conta(function (l) { return l.obs; })], ["Extrato", conta(function (l) { return l.extrato != null; })],
          ["Motivo", conta(function (l) { return l.motivo; })], ["Data de envio", conta(function (l) { return l.dataEnvio; })]
        ];
        var nao = Object.keys(stNao);
        res.innerHTML = "<p><b>" + esc(f.name) + "</b>: " + linhas.length + " aluno(s) — " + (linhas.length - ja) + " novo(s) na carteira e " + ja + " que já estão (são atualizados com os dados da planilha; célula vazia não apaga o que já está salvo).</p>" +
          (abaAcordo ? '<div class="meta">Aba das parcelas do acordo GM: ' + esc(abaAcordo.aba || "—") + ".</div>" : "") +
          destino +
          '<div class="table-wrap"><table class="data compacta"><tbody>' + itens.map(function (x) { return "<tr><td>" + x[0] + '</td><td class="right">' + x[1] + "</td></tr>"; }).join("") + "</tbody></table></div>" +
          (nao.length ? '<div class="form-err" style="background:var(--warn-soft);color:var(--warn)">Status que o site não reconheceu (o caso fica com o status atual, ou Em aberto): ' + nao.map(function (s) { return "“" + esc(s) + "” (" + stNao[s] + ")"; }).join(", ") + ".</div>" : "") +
          '<div class="meta" style="margin:8px 0 4px">Os status da planilha viram os 4 do painel: Quitado → Quitado; Em dia → Em negociação GM; Sem acordo GM e Devendo novamente → Em aberto. Valores em aberto e parcelas vêm do relatório de inadimplência.</div>' +
          '<div class="table-wrap"><table class="data compacta"><thead><tr><th>RA</th><th>Aluno</th><th>Carteira</th><th>Ano letivo</th><th>Status</th></tr></thead><tbody>' +
          linhas.slice(0, 8).map(function (l) { return "<tr><td>" + esc(l.ra || "—") + "</td><td>" + esc(l.aluno || "—") + "</td><td>" + esc(l.carteira || "—") + "</td><td>" + esc(l.ano || "—") + "</td><td>" + (l.status ? jpill(l.status) : "—") + "</td></tr>"; }).join("") +
          "</tbody></table></div>" + (linhas.length > 8 ? '<div class="meta">…e mais ' + (linhas.length - 8) + " linha(s).</div>" : "");
        $("jurImpOk").disabled = semCart > 0 && !jurCarteiras.length; $("jurImpOk").textContent = "Importar " + linhas.length + " aluno(s)";
        if (semCart && !jurCarteiras.length) res.insertAdjacentHTML("beforeend", '<div class="form-err">Crie a carteira primeiro, em “+ Nova carteira”.</div>');
      }).catch(function (x) { res.innerHTML = '<div class="form-err">Não foi possível ler o arquivo: ' + esc(x.message) + "</div>"; });
    };
    r.readAsArrayBuffer(f);
  }
  function aplicarCarteiraJur(btn) {
    if (!jurPendentes.length) return;
    // linhas sem carteira: a escolhida na janela; sem ano letivo: o da carteira cadastrada
    var dest = $("jurCartDest") ? $("jurCartDest").value : "";
    jurPendentes.forEach(function (l) {
      if (!l.carteira && dest) l.carteira = dest;
      if (!l.ano) jurCarteiras.forEach(function (c) { if (normHeader(c.nome) === normHeader(l.carteira)) l.ano = c.ano || ""; });
    });
    var envio = jurPendentes.map(function (l) { var o = {}; Object.keys(l).forEach(function (k) { if (k.charAt(0) !== "_") o[k] = l[k]; }); return o; });
    // lotes menores quando vêm as parcelas do acordo (mais dados por aluno)
    var tam = jurComAcordos ? 100 : 400, partes = [], tot = { criados: 0, atualizados: 0, ignorados: 0, tratativas: 0, parcelasAcordo: 0 };
    for (var i = 0; i < envio.length; i += tam) partes.push(envio.slice(i, i + tam));
    btn.disabled = true; btn.textContent = "Importando…";
    partes.reduce(function (p, parte) {
      return p.then(function () {
        return api("POST", "/api/juridico/importar", { linhas: parte, comAcordos: jurComAcordos }).then(function (r) {
          Object.keys(tot).forEach(function (k) { tot[k] += r[k] || 0; });
        });
      });
    }, Promise.resolve()).then(function () {
      jurPendentes = []; btn.textContent = "Importado";
      $("jurImpRes").innerHTML = '<p><b style="color:var(--success)">Concluído:</b> ' + tot.criados + " aluno(s) incluído(s) na carteira, " + tot.atualizados + " atualizado(s), " + tot.ignorados + " linha(s) ignorada(s)" +
        (jurComAcordos ? "; " + tot.parcelasAcordo + " parcela(s) do acordo GM gravadas" : "") + (tot.tratativas ? "; " + tot.tratativas + " observação(ões) viraram tratativas" : "") + ".</p>";
      toast("Carteira importada."); return carregarJuridico();
    }).catch(function (x) {
      btn.disabled = false; btn.textContent = "Tentar de novo";
      $("jurImpRes").insertAdjacentHTML("afterbegin", '<div class="form-err">Não foi possível importar: ' + esc(x.message) + "</div>");
    });
  }

  // ---- relatórios de inadimplência do mês
  var JUR_MODOS = {
    carteira: { t: "Importar carteira", s: "Planilha da carteira (use “Baixar modelo”): RA, Aluno, Carteira e Ano letivo, e também Status, CPF, link do Drive, extrato, motivo, data de envio, observações e o acordo GM. Se a planilha tiver uma aba com as parcelas do acordo (Acordo, Parcela, Vencimento, Valor, Pago, Saldo), elas entram na ficha de cada aluno. Célula vazia não apaga o que já está salvo. Responsável e contato vêm da Base de dados; valores em aberto e parcelas vêm do relatório de inadimplência.", b: "Importar alunos" },
    inadimplencia: { t: "Importar relatórios de inadimplência do mês", s: "Envie os relatórios de inadimplência do mês (PDF do sistema com quebra por conta financeira, Excel ou CSV); pode mandar os dois juntos. Cada parcela vai para Valor em aberto ou Valor negociado conforme a conta financeira. Só os alunos que já estão na carteira entram; os outros são ignorados. O mês fica guardado no histórico e é comparado com o anterior. Quem não aparece no relatório mantém os valores e fica marcado para conferência. Nada é gravado antes de você conferir o resumo.", b: "Gravar competência" }
  };
  function abrirJurImp(modo) {
    jurModo = modo; jurPendentes = []; jurRelatorio = null; jurLendo = 0;
    $("jurImpRes").innerHTML = ""; $("jurFile").value = ""; $("jurRelFiltros").innerHTML = "";
    $("jurFile").multiple = modo === "inadimplencia";
    $("jurFile").accept = modo === "inadimplencia" ? ".pdf,.xlsx,.xls,.csv,.txt" : ".xlsx,.xls,.csv,.txt";
    $("jiTitulo").textContent = JUR_MODOS[modo].t; $("jiSub").textContent = JUR_MODOS[modo].s;
    var b = $("jurImpOk"); b.disabled = true; b.textContent = JUR_MODOS[modo].b;
    abrir("mJurImp");
  }
  $("btnJurImportar").addEventListener("click", function () { abrirJurImp("carteira"); });
  $("btnJurInadimp").addEventListener("click", function () { abrirJurImp("inadimplencia"); });

  var REL_COLUNAS = {
    ra: ["ra", "codigo", "matricula", "cod", "cod. aluno", "codigo do aluno", "cod aluno"],
    aluno: ["aluno", "nome do aluno", "nome", "nome completo"],
    valor: ["devido", "valor devido", "total devido", "valor em aberto", "valor em aberto (r$)", "saldo", "valor", "valor (r$)"],
    venc: ["vencimento", "data vcto.", "data vcto", "data de vencimento", "dt vencimento", "dt. vencimento", "vcto"],
    parc: ["parc.", "parc", "parcela", "n parcela"],
    conta: ["conta financeira", "conta"]
  };
  // uma linha por parcela; o relatório do sistema separa as parcelas por "Conta financeira: <conta>"
  function linhasRelatorio(t) {
    var h = t.headers, ix = {};
    Object.keys(REL_COLUNAS).forEach(function (k) { ix[k] = colunaJur(h, REL_COLUNAS[k]); });
    if (ix.aluno === -1 && ix.ra === -1) return null;
    var out = [], conta = "";
    t.rows.forEach(function (r) {
      function cel(k) { var v = ix[k] === -1 ? "" : r[ix[k]]; return v instanceof Date ? v : String(v == null ? "" : v).trim(); }
      for (var i = 0; i < r.length; i++) {
        if (/^conta financeira/.test(normHeader(r[i]))) {
          var resto = String(r[i]).split(":").slice(1).join(":").trim();
          for (var j = i + 1; !resto && j < r.length; j++) resto = String(r[j] == null ? "" : r[j]).trim();
          // código numa célula e descrição na seguinte: junta os dois ("14 - Prestação de Serviço")
          if (/^\d{1,4}$/.test(resto)) for (var k2 = j; k2 < r.length; k2++) { var prox = String(r[k2] == null ? "" : r[k2]).trim(); if (prox) { if (!/^[\d.,\/-]+$/.test(prox)) resto += " - " + prox; break; } }
          conta = resto; return;
        }
      }
      var ra = String(cel("ra")).replace(/\.0+$/, ""), nome = cel("aluno");
      if (!ra && !nome) return;
      if (!ra && /^(total|soma|subtotal)\b/i.test(normHeader(nome))) return;
      if (ra && !/\d/.test(ra)) return; // linha de título repetida no meio do relatório
      out.push({ ra: ra, nome: nome, valorAberto: valorCelula(ix.valor === -1 ? "" : r[ix.valor]) || 0, vencimento: dataCelula(ix.venc === -1 ? "" : r[ix.venc]) || "", parc: String(cel("parc")).replace(/\.0+$/, ""), conta: cel("conta") || conta });
    });
    return out;
  }
  function lerLinhasRelatorio(f) {
    return new Promise(function (ok, erro) {
      var r = new FileReader();
      r.onerror = function () { erro(new Error("não foi possível abrir o arquivo")); };
      r.onload = function () { ok(new Uint8Array(r.result)); };
      r.readAsArrayBuffer(f);
    }).then(function (buf) {
      var p;
      if (ehPDF(f)) {
        // o PDF do sistema (E141) tem leitor próprio; outros PDFs viram tabela
        p = lerRelatorioPDF(buf).then(function (e) {
          if (e && e.brutos && e.brutos.length) return { brutos: e.brutos };
          return pdfParaTabela(buf).then(function (t) { return t ? [t] : []; });
        });
      } else if (ehExcel(f)) p = tabelaDoExcel(buf);
      else p = Promise.resolve([parseCSV(new TextDecoder("utf-8").decode(buf))]);
      return p.then(function (ts) {
        var linhas;
        if (ts && ts.brutos) linhas = ts.brutos;
        else {
          linhas = null; // várias abas: usa a que tiver mais linhas válidas
          (ts || []).forEach(function (t) { var l = linhasRelatorio(t); if (l && (!linhas || l.length > linhas.length)) linhas = l; });
          if (!linhas) throw new Error("Não achei as colunas de aluno ou RA no relatório.");
        }
        if (!linhas.length) throw new Error("Não achei parcelas no relatório.");
        return linhas;
      });
    });
  }
  function receberArquivoJur(f) {
    if (jurModo === "carteira") return receberCarteiraJur(f);
    // os relatórios do mês se somam (pode mandar um de cada vez ou os dois juntos)
    if (!jurRelatorio) jurRelatorio = { arquivos: [], regras: {}, competencia: hoje().slice(0, 7), dataRel: hoje() };
    jurLendo++; $("jurImpOk").disabled = true; renderArquivosInad();
    return lerLinhasRelatorio(f).then(function (linhas) {
      var R = jurRelatorio;
      R.arquivos = R.arquivos.filter(function (a) { return a.nome !== f.name; }).concat([{ nome: f.name, linhas: linhas }]);
    }).catch(function (x) { toast("Não foi possível ler " + f.name + ": " + x.message); })
      .then(function () { jurLendo--; if (!jurLendo && jurRelatorio) { montarFiltrosRelatorio(); simularRelatorioJur(); } });
  }
  // Junta os relatórios do mês: a mesma parcela em dois relatórios conta uma vez só; a mesma
  // parcela com valor diferente em outro relatório é divergência (vale a do primeiro).
  // Soma por aluno, conta financeira e ano do vencimento (a classificação da conta é no servidor).
  function analisarInad() {
    var R = jurRelatorio, vistos = {}, porParc = {}, dup = 0, dupMesmo = 0, total = 0, divergencias = [], raNomes = {}, nomeRas = {}, usadas = [];
    R.arquivos.forEach(function (a, ia) {
      var noArq = {};
      a.linhas.forEach(function (l) {
        total++;
        if (!l.conta) l.grupoArquivo = a.grupo || "";
        var nome = l.nome || l.aluno || "", nn = normHeader(nome), v = Math.round((Number(l.valorAberto) || 0) * 100) / 100;
        var base = (l.ra || "") + "|" + nn + "|" + normHeader(l.conta || "") + "|" + (l.vencimento || "") + "|" + (l.parc || ""), k = base + "|" + v.toFixed(2);
        if (vistos[k] !== undefined && vistos[k] !== ia) { dup++; return; }
        if (noArq[k]) dupMesmo++;
        var pp = porParc[base];
        if (pp && pp.ia !== ia && Math.abs(pp.v - v) > 0.009) {
          divergencias.push({ aluno: nome, ra: l.ra, conta: l.conta || "", venc: l.vencimento || "", v1: pp.v, v2: v, a1: R.arquivos[pp.ia].nome, a2: a.nome });
          return;
        }
        if (!pp) porParc[base] = { ia: ia, v: v };
        noArq[k] = 1; vistos[k] = ia;
        if (l.ra) (raNomes[l.ra] = raNomes[l.ra] || {})[nn] = nome;
        if (nn) (nomeRas[nn] = nomeRas[nn] || {})[l.ra || ""] = nome;
        usadas.push(l);
      });
    });
    // nomes parecidos ou RA com dois nomes: só interessa para alunos da carteira
    var rasJur = {}, nomesJur = {};
    casosJur.forEach(function (c) { if (c.ra) rasJur[String(c.ra).toLowerCase()] = 1; nomesJur[normHeader(c.aluno)] = 1; });
    var semelhantes = [];
    Object.keys(raNomes).forEach(function (ra) {
      var ns = Object.keys(raNomes[ra]);
      if (rasJur[ra.toLowerCase()] && ns.some(function (x) { return ns.some(function (y) { return !nomesIguaisJur(x, y); }); }))
        semelhantes.push("RA " + ra + " com nomes diferentes: " + ns.map(function (n) { return raNomes[ra][n]; }).join(" / "));
    });
    Object.keys(nomeRas).forEach(function (nn) {
      var rs = Object.keys(nomeRas[nn]).filter(Boolean);
      if (rs.length > 1 && nomesJur[nn]) semelhantes.push(nomeRas[nn][rs[0]] + " com mais de um RA: " + rs.join(", "));
    });
    var ag = {}, ordem = [];
    usadas.forEach(function (l) {
      // ano do vencimento: aluno com caso em duas carteiras recebe cada parcela no caso do ano letivo dela
      var ano = String(l.vencimento || "").slice(0, 4);
      var nome = l.nome || l.aluno || "", k = (l.ra || "") + "|" + normHeader(nome) + "|" + (l.conta || "") + "|" + (l.conta ? "" : l.grupoArquivo) + "|" + ano, g = ag[k];
      if (!g) { g = ag[k] = { ra: l.ra || "", aluno: nome, conta: l.conta || "", ano: ano, valor: 0, parcelas: 0, venc: [] }; if (!l.conta && l.grupoArquivo) g.grupoArquivo = l.grupoArquivo; ordem.push(k); }
      g.valor += Number(l.valorAberto) || 0; g.parcelas++;
      if (l.vencimento) g.venc.push([l.vencimento, Math.round((Number(l.valorAberto) || 0) * 100) / 100]);
    });
    R.enviadas = ordem.map(function (k) { var g = ag[k]; g.valor = Math.round(g.valor * 100) / 100; return g; });
    R.analise = { total: total, dup: dup, dupMesmo: dupMesmo, divergencias: divergencias, semelhantes: semelhantes };
  }
  function renderArquivosInad() {
    var el = $("jurArqsInad"); if (!el || !jurRelatorio) return;
    el.innerHTML = jurRelatorio.arquivos.map(function (a, i) {
      // relatório exportado sem as linhas "Conta financeira": a pessoa diz se o arquivo é de valor em aberto ou negociado
      var semConta = a.linhas.some(function (l) { return !l.conta; });
      var sel = semConta ? '<select data-grupo-arq="' + i + '" style="max-width:260px"><option value="">— este relatório é de… —</option>' +
        [["aberto", "Valor em aberto (Grupo 1)"], ["negociado", "Valor negociado (renegociação GM)"]].map(function (o) { return '<option value="' + o[0] + '"' + (a.grupo === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select>" : "";
      return '<div class="arq-linha"><div><b>' + esc(a.nome) + '</b><div class="meta">' + a.linhas.length + " parcela(s)" + (semConta ? " · sem a conta financeira nas linhas: escolha o tipo do relatório" : "") + "</div></div>" +
        '<span class="row-end">' + sel + '<button type="button" class="linkbtn danger" data-tirar-arq="' + i + '">Remover</button></span></div>';
    }).join("") + (jurLendo ? '<div class="meta">Lendo arquivo…</div>' : "");
  }
  function montarFiltrosRelatorio() {
    var R = jurRelatorio, el = $("jurRelFiltros");
    el.innerHTML = '<div class="grid2"><div class="field"><label for="jurComp">Mês de referência (competência)</label><input type="month" id="jurComp" value="' + esc(R.competencia) + '">' +
      '<span class="hint">Cada mês importado fica guardado no histórico. Importar o mesmo mês de novo substitui só aquele mês.</span></div>' +
      '<div class="field"><label for="jurDataRel">Data em que o relatório foi gerado</label><input type="date" id="jurDataRel" value="' + esc(R.dataRel || hoje()) + '"></div></div>' +
      '<div class="field"><label>Relatórios desta competência</label><div id="jurArqsInad"></div><span class="hint">Para juntar o segundo relatório, arraste-o na área acima.</span></div>';
    renderArquivosInad();
    $("jurComp").addEventListener("change", function () { if (/^\d{4}-\d{2}$/.test(this.value)) { R.competencia = this.value; simularRelatorioJur(); } });
    $("jurDataRel").addEventListener("change", function () { R.dataRel = this.value; });
    $("jurArqsInad").addEventListener("change", function (e) {
      var s = e.target.closest("[data-grupo-arq]"); if (!s) return;
      R.arquivos[+s.getAttribute("data-grupo-arq")].grupo = s.value; simularRelatorioJur();
    });
    $("jurArqsInad").addEventListener("click", function (e) {
      var b = e.target.closest("[data-tirar-arq]"); if (!b) return;
      R.arquivos.splice(+b.getAttribute("data-tirar-arq"), 1);
      renderArquivosInad();
      if (R.arquivos.length) simularRelatorioJur(); else { $("jurImpRes").innerHTML = ""; $("jurImpOk").disabled = true; }
    });
  }
  function variacao(v, antes) {
    if (antes == null) return "";
    var d = Math.round(((Number(v) || 0) - (Number(antes) || 0)) * 100) / 100;
    return d ? ' <span class="meta">(' + (d > 0 ? "+" : "−") + money(Math.abs(d)) + ")</span>" : ' <span class="meta">(sem variação)</span>';
  }
  var ROTULO_GRUPO = { aberto: "Valor em aberto", negociado: "Valor negociado", ignorar: "Não considerar" };
  function simularRelatorioJur() {
    analisarInad();
    var envio = jurRelatorio.enviadas;
    $("jurImpOk").disabled = true;
    if (!envio.length) { $("jurImpRes").innerHTML = '<div class="meta">Nenhuma parcela nos relatórios.</div>'; $("jurImpOk").textContent = "Nada para gravar"; return Promise.resolve(); }
    return api("POST", "/api/juridico/inadimplencia", { linhas: envio, simular: true, competencia: jurRelatorio.competencia, regras: jurRelatorio.regras })
      .then(mostrarInad).catch(function (x) { $("jurImpRes").innerHTML = '<div class="form-err">' + esc(x.message) + "</div>"; });
  }
  // resumo de conferência antes de gravar a competência
  function mostrarInad(d) {
    var R = jurRelatorio, A = R.analise, s = d.resumo, P = d.anterior, res = $("jurImpRes"), html = "";
    html += "<p>Competência <b>" + mesBR(d.mes) + "</b>" + (d.mesAnt ? ", comparada com <b>" + mesBR(d.mesAnt) + "</b>." : " — primeira competência importada.") + "</p>";
    if (d.jaImportada) html += '<div class="form-err" style="background:var(--info-soft);color:var(--info)">Esta competência já foi importada em ' + dataHora(d.jaImportada) + ". Gravar de novo substitui os dados deste mês, sem duplicar nada.</div>";
    if (!d.atualizaPainel) html += '<div class="form-err" style="background:var(--warn-soft);color:var(--warn)">A última competência importada é ' + mesBR(d.ultima) + ". Este mês, mais antigo, entra só no histórico; os valores do painel continuam os de " + mesBR(d.ultima) + ".</div>";
    function linha(rot, val) { return "<tr><td>" + rot + '</td><td class="tabular right">' + val + "</td></tr>"; }
    html += '<div class="table-wrap"><table class="data compacta"><tbody>' +
      linha("Registros importados (parcelas de alunos da carteira)", "<b>" + s.registros + "</b> de " + A.total + " no(s) relatório(s)") +
      linha("Alunos da carteira encontrados", "<b>" + s.noRelatorio + "</b> de " + s.casos) +
      linha("Total classificado como <b>valor em aberto</b>", "<b>" + money(s.aberto) + "</b>" + (P ? variacao(s.aberto, P.aberto) : "")) +
      linha("Total classificado como <b>valor negociado</b>", "<b>" + money(s.negociado) + "</b>" + (P ? variacao(s.negociado, P.negociado) : "")) +
      linha("Casos com valor em aberto · casos com valor negociado", s.casosAberto + " · " + s.casosNegociado) +
      linha("Registros duplicados (mesma parcela em mais de um relatório, contados uma vez)", A.dup + (A.dupMesmo ? " · " + A.dupMesmo + " linha(s) repetida(s) no mesmo arquivo" : "")) +
      linha("Registros sem conta financeira identificada", s.semConta) +
      linha("Nomes semelhantes ou possíveis duplicidades", A.semelhantes.length) +
      linha("Divergências entre os relatórios", A.divergencias.length) +
      (d.mesAnt ? linha("Em relação a " + mesBR(d.mesAnt), s.reclassificados + " mudaram de classificação · " + s.alterados + " com valor alterado · " + s.novos + " entraram · " + s.semMovimento + " sem movimentação · " + s.sairam + " deixaram de constar") : "") +
      linha("Casos para conferência manual", "<b>" + s.conferir + "</b>") +
      linha("Alunos do relatório fora da carteira (ignorados)", s.foraDoPainel) +
      "</tbody></table></div>";
    if (A.semelhantes.length) html += '<details><summary class="meta" style="cursor:pointer">Ver nomes semelhantes</summary><div class="meta">' + A.semelhantes.map(esc).join("<br>") + "</div></details>";
    if (A.divergencias.length) html += '<details><summary class="meta" style="cursor:pointer">Ver divergências</summary><div class="meta">' + A.divergencias.slice(0, 200).map(function (x) {
      return esc(x.aluno) + " · " + esc(x.conta || "sem conta") + " · venc. " + (x.venc ? br(x.venc) : "—") + ": " + money(x.v1) + " (" + esc(x.a1) + ") × " + money(x.v2) + " (" + esc(x.a2) + ") — vale o primeiro";
    }).join("<br>") + "</div></details>";
    if (d.pendentes.length) html += '<div class="form-err">' + d.pendentes.length + " conta(s) ou relatório(s) sem classificação. Escolha para onde vai cada uma (a escolha das contas fica salva para os próximos meses). Nada é gravado enquanto houver conta sem classificação.</div>";
    html += '<h4 style="margin:14px 0 6px">Registros por conta financeira</h4><div class="table-wrap"><table class="data compacta"><thead><tr><th>Conta financeira</th><th>Vai para</th><th class="right">Registros</th><th class="right">Valor</th><th class="right">Alunos</th></tr></thead><tbody>' +
      s.porConta.map(function (c) {
        var escolha = R.regras[c.conta] || "";
        var cel = c.semConta ? (c.grupo ? ROTULO_GRUPO[c.grupo] + ' <span class="meta">(tipo do relatório)</span>' : '<span style="color:var(--danger)">Escolha acima o tipo do relatório</span>')
          : c.grupo && !R.regras[c.conta] ? ROTULO_GRUPO[c.grupo]
          : '<select data-conta="' + esc(c.conta) + '"><option value="">— classificar —</option>' + ["aberto", "negociado", "ignorar"].map(function (g) { return '<option value="' + g + '"' + (escolha === g ? " selected" : "") + ">" + ROTULO_GRUPO[g] + "</option>"; }).join("") + "</select>";
        return "<tr><td>" + esc(c.rotulo || c.conta || "(sem conta financeira)") + "</td><td>" + cel + '</td><td class="tabular right">' + c.registros + '</td><td class="tabular right">' + money(c.valor) + '</td><td class="tabular right">' + c.casos + "</td></tr>";
      }).join("") + "</tbody></table></div>";
    var ms = d.movimentos.filter(function (m) { return m.tipo !== "sem_movimento" && (m.tipo !== "ausente" || m.saiu); })
      .sort(function (a, b) { return (!a.conferir - !b.conferir) || (a.aluno || "").localeCompare(b.aluno || "", "pt-BR"); });
    if (ms.length) {
      html += '<h4 style="margin:14px 0 6px">Movimentação dos casos (' + ms.length + ")</h4>" +
        '<div class="table-wrap" style="max-height:340px;overflow:auto"><table class="data"><thead><tr><th>Aluno</th><th>Movimento</th><th class="right">Valor em aberto</th><th class="right">Valor negociado</th></tr></thead><tbody>' +
        ms.map(function (m) {
          return "<tr><td><b>" + esc(m.aluno || "—") + '</b><div class="meta">' + (m.ra ? "RA " + esc(m.ra) + " · " : "") + esc(m.carteira || "—") + "</div>" + (m.conferir ? '<div class="meta" style="color:var(--warn)">Conferir: ' + esc(m.conferir) + "</div>" : "") + "</td>" +
            "<td>" + movPill(m.tipo) + "</td>" +
            '<td class="tabular right">' + (m.presente ? moneyOu(m.abAntes) + " → <b>" + money(m.ab) + "</b>" : moneyOu(m.abAntes) + '<div class="meta">mantido</div>') + "</td>" +
            '<td class="tabular right">' + (m.presente ? moneyOu(m.negAntes) + " → <b>" + money(m.neg) + "</b>" : moneyOu(m.negAntes) + '<div class="meta">mantido</div>') + "</td></tr>";
        }).join("") + "</tbody></table></div>";
    }
    if (d.foraDoPainel.length) html += '<details style="margin-top:10px"><summary class="meta" style="cursor:pointer">' + d.foraDoPainel.length + " aluno(s) do relatório não estão na carteira: nenhum dado deles foi importado (ver lista)</summary><div class=\"meta\" style=\"margin-top:6px\">" +
      d.foraDoPainel.slice(0, 300).map(function (x) { return esc((x.ra ? x.ra + " · " : "") + (x.aluno || "—")) + " (" + money(x.valor) + ")"; }).join("<br>") + "</div></details>";
    if (d.outrasCarteiras.length) html += '<div class="meta" style="margin-top:6px">' + d.outrasCarteiras.length + " caso(s) são de aluno com caso em mais de uma carteira: cada parcela foi para o caso do ano letivo do vencimento (sem caso daquele ano, para a carteira mais recente).</div>";
    // inconsistências: só grava depois de a pessoa confirmar que conferiu
    var precisaConfirmar = A.divergencias.length || A.semelhantes.length || A.dupMesmo;
    if (precisaConfirmar) html += '<label class="check-linha" style="margin-top:12px"><input type="checkbox" id="jurConfirmo"> <span>Conferi as divergências e possíveis duplicidades acima e quero gravar mesmo assim</span></label>';
    res.innerHTML = html;
    var b = $("jurImpOk");
    function libera() { b.disabled = d.pendentes.length > 0 || (precisaConfirmar && !$("jurConfirmo").checked); }
    b.textContent = "Gravar competência " + mesBR(d.mes); libera();
    if (precisaConfirmar) $("jurConfirmo").addEventListener("change", libera);
    res.querySelectorAll("select[data-conta]").forEach(function (sel) {
      sel.addEventListener("change", function () { if (sel.value) R.regras[sel.getAttribute("data-conta")] = sel.value; else delete R.regras[sel.getAttribute("data-conta")]; simularRelatorioJur(); });
    });
  }
  function aplicarInad(btn) {
    var R = jurRelatorio; if (!R) return;
    btn.disabled = true; btn.textContent = "Gravando…";
    api("POST", "/api/juridico/inadimplencia", { linhas: R.enviadas, simular: false, competencia: R.competencia, regras: R.regras, dataRelatorio: R.dataRel || hoje(), arquivos: R.arquivos.map(function (a) { return a.nome; }) }).then(function (d) {
      $("jurRelFiltros").innerHTML = ""; jurRelatorio = null; btn.textContent = "Gravado";
      $("jurImpRes").innerHTML = '<p><b style="color:var(--success)">Competência ' + mesBR(d.mes) + " gravada:</b> " + d.resumo.noRelatorio + " aluno(s) no relatório, " + d.alterados + " caso(s) atualizado(s)" +
        (d.atualizaPainel ? "" : " (mês antigo: só o histórico foi gravado)") + ". As movimentações ficaram nas tratativas e no histórico de cada aluno; " + d.resumo.conferir + " caso(s) ficaram marcados para conferência.</p>";
      toast("Competência " + mesBR(d.mes) + " gravada."); return carregarJuridico();
    }).catch(function (x) {
      btn.disabled = false; btn.textContent = "Tentar de novo";
      $("jurImpRes").insertAdjacentHTML("afterbegin", '<div class="form-err">Não foi possível gravar: ' + esc(x.message) + "</div>");
    });
  }
  ligarDropzone($("jurDrop"), $("jurFile"), null, receberArquivoJur);
  $("jurImpOk").addEventListener("click", function () { if (jurModo === "carteira") aplicarCarteiraJur(this); else aplicarInad(this); });

  // evolução mensal (competências importadas)
  var graficosJur = {};
  function corVar(c) { return getComputedStyle(document.documentElement).getPropertyValue("--" + c).trim(); }
  function graficoJur(id, cfg) {
    var jaTinha = !!graficosJur[id]; // redesenho da atualização automática: sem animação
    if (jaTinha) graficosJur[id].destroy();
    cfg.options = cfg.options || {};
    cfg.options.responsive = true; cfg.options.maintainAspectRatio = false; if (jaTinha) cfg.options.animation = false;
    cfg.options.plugins = { legend: { position: "bottom", labels: { boxWidth: 10, color: corVar("muted") } } };
    graficosJur[id] = new window.Chart($(id), cfg);
  }
  function renderEvoJur() {
    Promise.all([carregarChart(), api("GET", "/api/juridico/competencias")]).then(function (r) {
      if (jurTab !== "evolucao") return;
      var Chart = r[0], comps = r[1].competencias || [];
      Chart.defaults.color = corVar("muted"); Chart.defaults.borderColor = corVar("line"); Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
      $("jCompNota").textContent = comps.length ? comps.length + " competência(s) importada(s), desde " + mesBR(comps[0].mes) + "." : "Nenhuma competência importada ainda. Use “Importar inadimplência” para gravar o primeiro mês.";
      // em aberto e negociado em linhas separadas (nunca somados)
      graficoJur("jChartComp", {
        type: "line",
        data: { labels: comps.map(function (c) { return mesBR(c.mes); }), datasets: [
          { label: "Valor em aberto", borderColor: corVar("danger"), backgroundColor: corVar("danger"), fill: false, tension: 0.2, data: comps.map(function (c) { return c.aberto || 0; }) },
          { label: "Valor negociado GM", borderColor: corVar("info"), backgroundColor: corVar("info"), fill: false, tension: 0.2, data: comps.map(function (c) { return c.negociado || 0; }) }
        ] },
        options: { scales: { y: { ticks: { callback: function (v) { return "R$ " + Number(v).toLocaleString("pt-BR"); } } } } }
      });
      function varCel(c, i, k) {
        if (!i) return "";
        var d = Math.round(((Number(c[k]) || 0) - (Number(comps[i - 1][k]) || 0)) * 100) / 100;
        return '<div class="meta">' + (d ? (d > 0 ? "+" : "−") + money(Math.abs(d)) : "sem variação") + "</div>";
      }
      $("jCompTabela").innerHTML = comps.slice().reverse().map(function (c) {
        var i = comps.indexOf(c);
        return "<tr><td><b>" + mesBR(c.mes) + '</b><div class="meta">' + (c.importadoPor ? esc(c.importadoPor) + " · " : "") + dataCurta(c.importadoEm) + '</div></td><td class="tabular right">' + (c.noRelatorio || 0) + " de " + (c.casos || 0) +
          '</td><td class="tabular right">' + money(c.aberto) + varCel(c, i, "aberto") + '</td><td class="tabular right">' + money(c.negociado) + varCel(c, i, "negociado") +
          '</td><td class="tabular right">' + (c.casosAberto || 0) + " · " + (c.casosNegociado || 0) + '</td><td class="tabular right">' + (c.reclassificados || 0) + '</td><td class="tabular right">' + (c.semMovimento || 0) +
          '</td><td class="tabular right">' + (c.sairam || 0) + '</td><td class="tabular right">' + (c.conferir || 0) + "</td></tr>";
      }).join("");
      $("jCompVazio").hidden = comps.length > 0;
    }).catch(function (x) { toast(x.message); });
  }

  // ---------------------------------------------------------------- Cheques
  // Duas listas, como as abas da planilha CHEQUES_SER: cheques devolvidos e cheques recebidos.
  // Os registros antigos vêm da planilha (importar); os novos são cadastrados aqui.
  var cheques = [], chqCarregado = false, chqTab = "devolvido", chqLimite = 300, chqEdit = null, chqPendentes = [];
  function carregarCheques() {
    return api("GET", "/api/cheques").then(function (d) {
      cheques = d.cheques; chqCarregado = true; marcarSync(true);
      if (view === "cheques") renderCheques();
    }).catch(function (x) { marcarSync(false); if (x.status !== 401 && x.status !== 403) toast(x.message); });
  }
  function trocarCheque(c) { var i = cheques.findIndex(function (x) { return x.id === c.id; }); if (i === -1) cheques.push(c); else cheques[i] = c; }
  document.querySelectorAll("[data-ctab]").forEach(function (b) {
    b.addEventListener("click", function () {
      chqTab = b.getAttribute("data-ctab"); chqLimite = 300;
      document.querySelectorAll("[data-ctab]").forEach(function (x) { x.classList.toggle("active", x === b); });
      $("cSituacao").value = ""; renderCheques();
    });
  });
  // situação do cheque para o filtro: devolvidos pela coluna Pagamento; recebidos pela devolução
  function situacaoChq(c) {
    if (c.tipo === "devolvido") return (c.pagamento || "").trim().toUpperCase() || "SEM PAGAMENTO";
    return c.motivoDevolucao || c.dataDevolucao ? "DEVOLVIDO" : "SEM DEVOLUÇÃO";
  }
  function pagoChq(c) { return /^(pago|quitad)/i.test((c.pagamento || "").trim()); }
  function renderCheques() {
    var doTipo = cheques.filter(function (c) { return c.tipo === chqTab; });
    // filtros: situação e ano de vencimento
    var sits = {}, anos = {};
    doTipo.forEach(function (c) { sits[situacaoChq(c)] = (sits[situacaoChq(c)] || 0) + 1; if (c.vencimento) anos[c.vencimento.slice(0, 4)] = 1; });
    prepararSelect($("cSituacao"), [{ v: "", l: chqTab === "devolvido" ? "Pagamento: todos" : "Devolução: todos" }].concat(Object.keys(sits).sort().map(function (s) { return { v: esc(s), l: esc(s) + " (" + sits[s] + ")" }; })), "");
    prepararSelect($("cAno"), [{ v: "", l: "Vencimento: todos os anos" }].concat(Object.keys(anos).sort().reverse().map(function (a) { return { v: a, l: a }; })), "");
    var q = $("cBusca").value.trim().toLowerCase(), si = $("cSituacao").value, an = $("cAno").value;
    var vis = doTipo.filter(function (c) {
      if (si && situacaoChq(c) !== si) return false;
      if (an && (c.vencimento || "").slice(0, 4) !== an) return false;
      if (q && [c.aluno, c.ra, c.responsavel, c.emitente, c.cpfEmitente, c.numero].join(" ").toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).sort(function (a, b) { return (b.vencimento || "").localeCompare(a.vencimento || "") || (a.aluno || "").localeCompare(b.aluno || "", "pt-BR"); });
    // indicadores
    var tot = 0, hj = hoje(); vis.forEach(function (c) { tot += Number(c.valor) || 0; });
    var tiles;
    if (chqTab === "devolvido") {
      var pend = vis.filter(function (c) { return !pagoChq(c); }), vPend = pend.reduce(function (t, c) { return t + (Number(c.valor) || 0); }, 0);
      tiles = [{ n: vis.length, l: "Cheques devolvidos" }, { n: money(tot), l: "Valor total", c: "danger" }, { n: pend.length, l: "Ainda não pagos", c: "warn" }, { n: money(vPend), l: "Valor não pago", c: "warn" }];
    } else {
      var aVencer = vis.filter(function (c) { return c.vencimento && c.vencimento >= hj; }), dev = vis.filter(function (c) { return situacaoChq(c) === "DEVOLVIDO"; });
      tiles = [{ n: vis.length, l: "Cheques recebidos" }, { n: money(tot), l: "Valor total", c: "info" },
        { n: aVencer.length + " · " + money(aVencer.reduce(function (t, c) { return t + (Number(c.valor) || 0); }, 0)), l: "A vencer" }, { n: dev.length, l: "Com devolução", c: "warn" }];
    }
    $("chqKpis").innerHTML = tiles.map(function (t) { return '<div class="kpi"><div class="num tabular"' + (t.c ? ' style="color:var(--' + t.c + ')"' : "") + ">" + t.n + '</div><div class="lbl">' + t.l + "</div></div>"; }).join("");
    $("chqCount").textContent = vis.length + " de " + doTipo.length + " cheques · " + money(tot);
    $("chqVazio").hidden = vis.length > 0;
    $("chqVazio").textContent = doTipo.length ? "Nenhum cheque com estes filtros." : "Nenhum cheque cadastrado. Use “Importar planilha” ou “+ Novo cheque”.";
    $("chqHead").innerHTML = chqTab === "devolvido"
      ? "<tr><th>Aluno</th><th>Emitente</th><th>Banco · Agência · Conta · Nº</th><th class=\"right\">Valor</th><th>Vencimento</th><th>Motivo</th><th>Pagamento</th><th>Mentor</th><th>Observações</th></tr>"
      : "<tr><th>Aluno</th><th>Recebido em</th><th>Emitente</th><th>Banco · Agência · Conta · Nº</th><th class=\"right\">Valor</th><th>Vencimento</th><th>Obs</th><th>Devolução</th><th>Formulário · Identificação</th></tr>";
    function obsCurta(t) { return esc(t ? (t.length > 60 ? t.slice(0, 60).trim() + "…" : t) : "—"); }
    $("chqTbody").innerHTML = vis.slice(0, chqLimite).map(function (c) {
      var aluno = '<td><div class="nome">' + esc(c.aluno || "—") + '</div><div class="meta">' + esc(c.responsavel || "sem responsável informado") + (c.ra ? " · RA " + esc(c.ra) : "") + "</div></td>";
      var emit = "<td>" + esc(c.emitente || "—") + (c.cpfEmitente ? '<div class="meta">' + esc(c.cpfEmitente) + "</div>" : "") + "</td>";
      var banco = '<td class="tabular">' + esc([c.banco, c.agencia, c.conta].filter(Boolean).join(" · ") || "—") + (c.numero ? '<div class="meta">nº ' + esc(c.numero) + "</div>" : "") + "</td>";
      var valor = '<td class="tabular right"><b>' + moneyOu(c.valor) + "</b></td>", venc = '<td class="tabular">' + (c.vencimento ? br(c.vencimento) : "—") + "</td>";
      if (c.tipo === "devolvido") {
        var pg = (c.pagamento || "").trim(), cor = pagoChq(c) ? "success" : /negoci/i.test(pg) ? "info" : "warn";
        return '<tr class="click" data-chq="' + esc(c.id) + '">' + aluno + emit + banco + valor + venc + "<td>" + esc(c.motivo || "—") + "</td>" +
          "<td>" + (pg ? '<span class="pill" style="color:var(--' + cor + ");background:var(--" + cor + '-soft)"><i></i>' + esc(pg) + "</span>" : '<span class="muted">—</span>') + "</td>" +
          "<td>" + esc(c.geracaoMentor || "—") + '</td><td class="muted obs-cell">' + obsCurta(c.observacao) + "</td></tr>";
      }
      return '<tr class="click" data-chq="' + esc(c.id) + '">' + aluno + '<td class="tabular">' + (c.dataRecebimento ? br(c.dataRecebimento) : "—") + "</td>" + emit + banco + valor + venc +
        '<td class="muted obs-cell">' + obsCurta(c.observacao) + "</td><td>" + (c.motivoDevolucao || c.dataDevolucao ? esc(c.motivoDevolucao || "devolvido") + (c.dataDevolucao ? '<div class="meta">' + br(c.dataDevolucao) + "</div>" : "") : '<span class="muted">—</span>') + "</td>" +
        "<td>" + (c.dataFormulario ? br(c.dataFormulario) : "—") + (c.identificacao ? '<div class="meta">' + esc(c.identificacao) + "</div>" : "") + "</td></tr>";
    }).join("");
    $("chqMais").hidden = vis.length <= chqLimite;
  }
  ["cBusca", "cSituacao", "cAno"].forEach(function (id) { $(id).addEventListener("input", function () { chqLimite = 300; renderCheques(); }); });
  $("chqMais").addEventListener("click", function () { chqLimite += 300; renderCheques(); });
  $("chqTbody").addEventListener("click", function (e) { var tr = e.target.closest("tr[data-chq]"); if (tr) abrirCheque(tr.getAttribute("data-chq")); });

  // cadastro e edição (janela)
  var CHQ_FORM = [["chRa", "ra"], ["chAluno", "aluno"], ["chResp", "responsavel"], ["chEmitente", "emitente"], ["chCpf", "cpfEmitente"], ["chBanco", "banco"], ["chAgencia", "agencia"],
    ["chConta", "conta"], ["chNumero", "numero"], ["chVenc", "vencimento"], ["chRecebido", "dataRecebimento"], ["chMotivo", "motivo"], ["chPagamento", "pagamento"], ["chMentor", "geracaoMentor"],
    ["chMotDev", "motivoDevolucao"], ["chDataDev", "dataDevolucao"], ["chDataForm", "dataFormulario"], ["chIdent", "identificacao"], ["chObs", "observacao"]];
  function camposPorTipo() { var t = $("chTipo").value; document.querySelectorAll("#formCheque [data-chq]").forEach(function (el) { el.hidden = el.getAttribute("data-chq") !== t; }); }
  $("chTipo").addEventListener("change", camposPorTipo);
  function abrirCheque(id) {
    var c = null; cheques.forEach(function (x) { if (x.id === id) c = x; });
    chqEdit = c; mostrarErro($("chErr"), "");
    $("chTitulo").textContent = c ? "Editar cheque" : "Novo cheque";
    $("chSub").textContent = c ? (c.tipo === "devolvido" ? "Cheque devolvido" : "Cheque recebido") : "Cadastro manual";
    $("chTipo").value = c ? c.tipo : chqTab; $("chTipo").disabled = !!c;
    CHQ_FORM.forEach(function (p) { $(p[0]).value = c ? c[p[1]] || "" : ""; });
    $("chValor").value = c && c.valor != null ? c.valor : "";
    // sugestões com o que já foi usado
    var mot = {}, pag = {}; cheques.forEach(function (x) { if (x.motivo) mot[x.motivo] = 1; if (x.pagamento) pag[x.pagamento] = 1; });
    $("chMotivos").innerHTML = Object.keys(mot).sort().map(function (v) { return '<option value="' + esc(v) + '"></option>'; }).join("");
    $("chPagamentos").innerHTML = Object.keys(pag).sort().map(function (v) { return '<option value="' + esc(v) + '"></option>'; }).join("");
    $("chInfo").textContent = c ? "Cadastrado em " + dataHora(c.criadoEm) + (c.criadoPor ? " por " + c.criadoPor : "") + (c.atualizadoEm && c.atualizadoEm !== c.criadoEm ? " · atualizado em " + dataHora(c.atualizadoEm) + (c.atualizadoPor ? " por " + c.atualizadoPor : "") : "") : "";
    var bx = $("chExcluir"); bx.hidden = !c; bx.classList.remove("armed"); bx.textContent = "Excluir cheque";
    camposPorTipo(); abrir("mCheque");
    setTimeout(function () { $("chRa").focus(); }, 30);
  }
  // RA digitado: aluno e responsável vêm da Base de dados
  $("chRa").addEventListener("change", function () {
    var ra = this.value.trim().toLowerCase(); if (!ra) return;
    var b = null; baseAlunos.forEach(function (x) { if (String(x.ra || "").trim().toLowerCase() === ra) b = x; });
    if (!b) return;
    if (!$("chAluno").value.trim()) $("chAluno").value = b.nome || "";
    if (!$("chResp").value.trim()) $("chResp").value = b.responsavel || "";
  });
  $("btnChqNovo").addEventListener("click", function () { if (!baseCarregada) carregarBaseDados(); abrirCheque(null); });
  $("formCheque").addEventListener("submit", function (e) {
    e.preventDefault();
    var dados = { tipo: $("chTipo").value };
    CHQ_FORM.forEach(function (p) { var el = $(p[0]); if (!el.closest("[data-chq]") || !el.closest("[data-chq]").hidden) dados[p[1]] = el.value.trim(); });
    var v = parseFloat($("chValor").value); dados.valor = isNaN(v) ? null : v;
    if (!(dados.valor > 0)) return mostrarErro($("chErr"), "Informe o valor do cheque.");
    if (!dados.aluno && !dados.emitente) return mostrarErro($("chErr"), "Informe o aluno ou o emitente.");
    var req = chqEdit ? api("PATCH", "/api/cheques/" + encodeURIComponent(chqEdit.id), dados) : api("POST", "/api/cheques", dados);
    req.then(function (d) { trocarCheque(d.cheque); fecharModais(); renderCheques(); toast(chqEdit ? "Cheque atualizado." : "Cheque cadastrado."); })
      .catch(function (x) { mostrarErro($("chErr"), x.message); });
  });
  $("chExcluir").addEventListener("click", function () {
    var b = this;
    if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Confirmar exclusão"; return; }
    api("DELETE", "/api/cheques/" + encodeURIComponent(chqEdit.id)).then(function () {
      cheques = cheques.filter(function (x) { return x.id !== chqEdit.id; }); fecharModais(); renderCheques(); toast("Cheque excluído.");
    }).catch(function (x) { mostrarErro($("chErr"), x.message); });
  });

  // importação da planilha CHEQUES_SER
  var CHQ_COLUNAS = {
    ra: ["ra"], aluno: ["aluno"], responsavel: ["responsavel financeiro", "responsavel"], dataRecebimento: ["dt recebimento", "data recebimento", "data de recebimento"],
    emitente: ["emitente"], cpfEmitente: ["cpf emitente", "cpf/cnpj emitente", "cpf"], banco: ["banco"], agencia: ["agencia"], conta: ["conta"],
    numero: ["n", "no", "numero", "n cheque", "numero do cheque"], valor: ["valor"], vencimento: ["vencimento"], motivo: ["motivo"], pagamento: ["pagamento"],
    geracaoMentor: ["geracao no mentor", "mentor"], observacao: ["observacoes", "observacao", "obs"], motivoDevolucao: ["motivo devolucao", "motivo da devolucao"],
    dataDevolucao: ["data devolucao", "data da devolucao"], dataFormulario: ["data formulario", "data do formulario"], identificacao: ["identificacao do cheque", "identificacao"]
  };
  function cabChq(v) { return normHeader(v).replace(/[^a-z0-9/ ]+/g, " ").replace(/\s+/g, " ").trim(); }
  function colChq(h, nomes) {
    for (var n = 0; n < nomes.length; n++) { var i = h.indexOf(nomes[n]); if (i !== -1) return i; }
    // começo do título ("identificacao do respon..." cortado)
    for (var j = 0; j < h.length; j++) for (var m = 0; m < nomes.length; m++) if (nomes[m].length >= 8 && h[j] && h[j].indexOf(nomes[m]) === 0) return j;
    return -1;
  }
  // "1,349.30" e "$ 600.00" (planilha em formato americano) ou "1.349,30"
  function valorChq(v) {
    if (typeof v === "number") return v;
    var s = String(v || "").replace(/[^\d.,-]/g, ""); if (!/\d/.test(s)) return null;
    // a planilha mistura formatos: 1.449,29 · 1,349.30 · 1041,39 · 394.95 · e até 1.748.47 (ponto nos dois lugares).
    // O último ponto/vírgula seguido de 1 ou 2 dígitos são os centavos; os outros separadores são de milhar.
    var neg = /^-/.test(s), m = /^(.*)[.,](\d{1,2})$/.exec(s.replace(/-/g, ""));
    var n = m ? parseFloat((m[1].replace(/[.,]/g, "") || "0") + "." + m[2]) : parseFloat(s.replace(/[.,-]/g, ""));
    return isNaN(n) ? null : neg ? -n : n;
  }
  // datas como aparecem na planilha: dia/mês/ano (12/7/2017 = 12 de julho)
  function dataChq(v) {
    if (v instanceof Date) return isoLocal(new Date(v.getTime() + 12 * 3600000));
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(String(v || "").trim()); if (!m) return "";
    var d = +m[1], me = +m[2], a = +m[3]; if (a < 100) a += 2000;
    if (d < 1 || d > 31 || me < 1 || me > 12) return "";
    return a + "-" + pad2(me) + "-" + pad2(d);
  }
  function tabelasChq(f, buf) {
    if (!ehExcel(f)) return Promise.resolve([{ nome: f.name, aoa: parseCSVBruto(new TextDecoder("utf-8").decode(buf)) }]);
    return carregarXLSX().then(function (X) {
      var wb = X.read(buf, { type: "array" });
      // texto como aparece na planilha (datas e valores formatados)
      return wb.SheetNames.map(function (n) {
        var ws = wb.Sheets[n], aoa = X.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false, blankrows: true });
        // o número guardado em cada célula (para o valor: o texto formatado pode enganar, ex. 1.749 lido como 1,749)
        var num = aoa.map(function () { return []; });
        if (ws["!ref"]) {
          var rg = X.utils.decode_range(ws["!ref"]);
          Object.keys(ws).forEach(function (ref) {
            if (ref.charAt(0) === "!") return;
            var c = ws[ref]; if (!c || c.t !== "n" || typeof c.v !== "number") return;
            var a = X.utils.decode_cell(ref), r = a.r - rg.s.r;
            if (num[r]) num[r][a.c - rg.s.c] = c.v;
          });
        }
        return { nome: n, aoa: aoa, num: num };
      });
    });
  }
  function parseCSVBruto(txt) {
    var sep = (txt.split("\n")[0].match(/;/g) || []).length > (txt.split("\n")[0].match(/,/g) || []).length ? ";" : ",";
    var linhas = [], cel = "", lin = [], aspas = false;
    for (var i = 0; i < txt.length; i++) {
      var ch = txt[i];
      if (aspas) { if (ch === '"' && txt[i + 1] === '"') { cel += '"'; i++; } else if (ch === '"') aspas = false; else cel += ch; continue; }
      if (ch === '"') aspas = true; else if (ch === sep) { lin.push(cel); cel = ""; } else if (ch === "\n") { lin.push(cel.replace(/\r$/, "")); linhas.push(lin); lin = []; cel = ""; } else cel += ch;
    }
    if (cel || lin.length) { lin.push(cel); linhas.push(lin); }
    return linhas;
  }
  function linhasChq(t, tipoPadrao) {
    // linha de títulos: a que tiver mais nomes de coluna conhecidos
    var melhor = -1, nota = 0;
    for (var i = 0; i < Math.min(t.aoa.length, 8); i++) {
      var h0 = t.aoa[i].map(cabChq), sc = 0;
      Object.keys(CHQ_COLUNAS).forEach(function (k) { if (colChq(h0, CHQ_COLUNAS[k]) !== -1) sc++; });
      if (sc > nota) { nota = sc; melhor = i; }
    }
    if (melhor === -1 || nota < 4) return null;
    var h = t.aoa[melhor].map(cabChq), ix = {};
    Object.keys(CHQ_COLUNAS).forEach(function (k) { ix[k] = colChq(h, CHQ_COLUNAS[k]); });
    if (ix.ra === -1 && ix.aluno > 0) ix.ra = 0; // coluna do RA sem título (ou com título errado)
    if (ix.motivoDevolucao !== -1 && ix.motivo === ix.motivoDevolucao) ix.motivo = -1;
    var nomeAba = normHeader(t.nome);
    var tipo = /devolv/.test(nomeAba) ? "devolvido" : /receb/.test(nomeAba) ? "recebido" : ix.dataRecebimento !== -1 ? "recebido" : ix.pagamento !== -1 ? "devolvido" : tipoPadrao;
    var out = [];
    t.aoa.slice(melhor + 1).forEach(function (r, j) {
      var nr = t.num ? t.num[melhor + 1 + j] || [] : [];
      function cel(k) { return ix[k] === -1 ? "" : String(r[ix[k]] == null ? "" : r[ix[k]]).trim(); }
      // linhas de total ("Total:", "Qtde.:") e linhas vazias ficam de fora
      if (r.some(function (x) { return /^(total|qtde|subtotal)\b/i.test(String(x || "").trim()); })) return;
      var l = { tipo: tipo };
      ["ra", "aluno", "responsavel", "emitente", "cpfEmitente", "banco", "agencia", "conta", "numero", "motivo", "pagamento", "geracaoMentor", "observacao", "motivoDevolucao", "identificacao"].forEach(function (k) { var v = cel(k); if (v) l[k] = v; });
      ["vencimento", "dataRecebimento", "dataDevolucao", "dataFormulario"].forEach(function (k) { var v = dataChq(cel(k)); if (v) l[k] = v; });
      var v = ix.valor !== -1 && typeof nr[ix.valor] === "number" ? nr[ix.valor] : valorChq(cel("valor")); if (v != null) l.valor = Math.round(v * 100) / 100;
      if (!l.aluno && !l.emitente) return;
      if (!(l.valor > 0)) return;
      out.push(l);
    });
    return { tipo: tipo, aba: t.nome, linhas: out };
  }
  $("btnChqImportar").addEventListener("click", function () {
    chqPendentes = []; $("chqImpRes").innerHTML = ""; $("chqFile").value = ""; $("chqImpOk").disabled = true; $("chqImpOk").textContent = "Importar"; abrir("mChqImp");
  });
  function receberPlanilhaChq(f) {
    var res = $("chqImpRes"); res.innerHTML = '<div class="meta">Lendo ' + esc(f.name) + "…</div>";
    chqPendentes = []; $("chqImpOk").disabled = true;
    var r = new FileReader();
    r.onload = function () {
      tabelasChq(f, new Uint8Array(r.result)).then(function (ts) {
        var partes = ts.map(function (t) { return linhasChq(t, chqTab); }).filter(function (p) { return p && p.linhas.length; });
        if (!partes.length) throw new Error("Não achei as colunas dos cheques (Aluno, Emitente, Banco, Valor, Vencimento…).");
        // chave igual à do servidor: conta quantos já estão cadastrados
        function dig(v) { return String(v || "").replace(/\D/g, "").replace(/^0+/, ""); }
        function chave(c) { return [c.tipo, dig(c.banco), dig(c.agencia), dig(c.conta), dig(c.numero), c.vencimento || "", c.valor == null ? "" : Number(c.valor).toFixed(2)].join("|"); }
        // mesmo banco, agência, conta, número e vencimento com outro valor: é o valor sendo corrigido
        function semValor(c) { return dig(c.numero) ? chave(c).replace(/\|[^|]*$/, "") : ""; }
        var ja = {}, jaSV = {}; cheques.forEach(function (c) { ja[chave(c)] = 1; var sv = semValor(c); if (sv) jaSV[sv] = 1; });
        var html = "<p><b>" + esc(f.name) + "</b>:</p>", todas = [];
        partes.forEach(function (p) {
          var vistos = {}, novos = 0, rep = 0, tot = 0, corr = 0;
          p.linhas.forEach(function (l) {
            var k = chave(l), sv = semValor(l); tot += l.valor || 0;
            if (vistos[k]) { rep++; return; } vistos[k] = 1;
            if (ja[k]) return;
            if (sv && jaSV[sv]) corr++; else novos++;
          });
          html += '<div class="arq-linha"><div><b>' + (p.tipo === "devolvido" ? "Cheques devolvidos" : "Cheques recebidos") + '</b><div class="meta">aba ' + esc(p.aba) + " · " + p.linhas.length + " cheque(s) · " + money(tot) +
            " · " + novos + " novo(s), " + (p.linhas.length - rep - novos) + " já cadastrado(s) (serão atualizados)" + (corr ? ", " + corr + " deles com o valor corrigido" : "") + (rep ? ", " + rep + " repetido(s) na planilha (contam uma vez)" : "") + "</div></div></div>";
          todas = todas.concat(p.linhas);
        });
        chqPendentes = todas;
        var ex = todas.slice(0, 6);
        html += '<div class="table-wrap" style="margin-top:8px"><table class="data compacta"><thead><tr><th>Tipo</th><th>Aluno</th><th>Emitente</th><th>Nº</th><th class="right">Valor</th><th>Vencimento</th></tr></thead><tbody>' +
          ex.map(function (l) { return "<tr><td>" + (l.tipo === "devolvido" ? "Devolvido" : "Recebido") + "</td><td>" + esc(l.aluno || "—") + "</td><td>" + esc(l.emitente || "—") + "</td><td>" + esc(l.numero || "—") + '</td><td class="tabular right">' + money(l.valor) + "</td><td>" + (l.vencimento ? br(l.vencimento) : "—") + "</td></tr>"; }).join("") +
          "</tbody></table></div>";
        res.innerHTML = html;
        $("chqImpOk").disabled = false; $("chqImpOk").textContent = "Importar " + todas.length + " cheque(s)";
      }).catch(function (x) { res.innerHTML = '<div class="form-err">Não foi possível ler o arquivo: ' + esc(x.message) + "</div>"; });
    };
    r.readAsArrayBuffer(f);
  }
  ligarDropzone($("chqDrop"), $("chqFile"), null, receberPlanilhaChq);
  $("chqImpOk").addEventListener("click", function () {
    if (!chqPendentes.length) return;
    var btn = this, partes = [], tot = { criados: 0, atualizados: 0, ignorados: 0 };
    for (var i = 0; i < chqPendentes.length; i += 400) partes.push(chqPendentes.slice(i, i + 400));
    btn.disabled = true; btn.textContent = "Importando…";
    partes.reduce(function (p, parte) {
      return p.then(function () { return api("POST", "/api/cheques/importar", { linhas: parte }).then(function (r) { tot.criados += r.criados; tot.atualizados += r.atualizados; tot.ignorados += r.ignorados; }); });
    }, Promise.resolve()).then(function () {
      chqPendentes = []; btn.textContent = "Importado";
      $("chqImpRes").innerHTML = '<p><b style="color:var(--success)">Concluído:</b> ' + tot.criados + " cheque(s) novo(s), " + tot.atualizados + " atualizado(s)" + (tot.ignorados ? ", " + tot.ignorados + " linha(s) ignorada(s)" : "") + ".</p>";
      toast("Cheques importados."); return carregarCheques();
    }).catch(function (x) {
      btn.disabled = false; btn.textContent = "Tentar de novo";
      $("chqImpRes").insertAdjacentHTML("afterbegin", '<div class="form-err">Não foi possível importar: ' + esc(x.message) + "</div>");
    });
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
