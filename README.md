# Painel de Cobrança — Colégio Ser

Painel de cobrança com login, gestão de acessos e banco de dados, publicado na
**Cloudflare** (Workers + banco **D1**, plano gratuito) a partir deste repositório do GitHub.

## Estrutura

| Pasta / arquivo | Para que serve |
|---|---|
| `public/` | As telas do painel (`index.html`, `app.js`, `styles.css`). |
| `src/worker.js` | O servidor: login, sessões, usuários e leitura/gravação no banco. |
| `wrangler.toml` | Configuração que a Cloudflare lê para publicar (nome, pastas e banco). |
| `gerar-worker.ps1` | Opcional: gera `dist/worker-completo.js` (tudo em um arquivo) para colar no editor da Cloudflare, caso um dia não usem o GitHub. |

**Nunca envie para o GitHub** as pastas `migracao/` (dados pessoais de alunos) e `dist/`.
Deixe o repositório como **privado** (GitHub → Settings → General → Danger Zone → Change visibility).

---

## Publicar pela primeira vez

### 1. Banco de dados
1. <https://dash.cloudflare.com> → **Storage & Databases → D1 SQL Database → Create** → nome `cobranca-ser`.
2. Na página do banco, copie o **Database ID**.
3. No GitHub, abra `wrangler.toml` → lápis (Edit) → troque `COLE_AQUI_O_ID_DO_BANCO` pelo ID → **Commit changes**.

As tabelas são criadas automaticamente no primeiro acesso.

### 2. Conectar o GitHub à Cloudflare
1. Se existir um Worker antigo `cobranca-colegioser` criado por upload de arquivos, exclua-o
   (Configurações → Zona de perigo → Excluir).
2. **Trabalhadores e Páginas → Criar → Importar um repositório** → conecte a conta do GitHub
   → escolha `cobranca-colegioser`.
3. Nome do projeto: `cobranca-colegioser` (igual ao `name` do `wrangler.toml`).
   Comando de build: deixe vazio. Comando de implantação: `npx wrangler deploy`. → **Implantar**.

### 3. Chave da configuração inicial
No Worker → **Configurações → Variáveis e segredos → Adicionar** → tipo **Segredo**,
nome `SETUP_KEY`, valor: uma frase que só a administração saiba → **Implantar**.

### 4. Configuração inicial
1. Abra o endereço do Worker (botão **Visita**, termina em `.workers.dev`).
2. Tela **Configuração inicial**: chave, seu nome (use o mesmo do histórico, ex.: `Damyla`), usuário e senha.

### 5. Dados do painel antigo
**Usuários e acessos → Trazer dados do painel antigo** → arraste `migracao/backup-painel-antigo.json`
(do computador, não do GitHub). Deve aparecer *229 alunos e 64 atendimentos gravados*.
Enviar de novo não duplica. Depois, apague a pasta `migracao/` do computador.

### 6. Acessos da equipe
**Usuários e acessos → + Criar acesso**: nome (ex.: `Dani Andrade`, `Cecília`), usuário, perfil e
senha provisória. No primeiro login a pessoa troca a senha.

---

## Abas

- **Painel** — carteira principal de cobrança.
- **Evolução** — produção da equipe (todos os atendimentos).
- **Contraturno** — mesma tela e indicadores do Painel, com carteira própria (importada do
  relatório do contraturno). Quando o aluno está nas duas carteiras (mesmo RA, ou mesmo nome sem RA),
  um atendimento registrado em qualquer aba aparece no histórico das duas e atualiza "último atendimento",
  "próximo retorno" e atendente nas duas. Status e valor em aberto são próprios de cada aba.
- **Serasa** — controle de negativação por parcela (RA, aluno, responsável, CPF, vencimento, valor, tipo,
  situação no Mentor e no Serasa, data e responsável pela inclusão). Importação de planilha, seleção de
  várias parcelas para marcar "Mentor OK", "Serasa: incluído hoje", "Pago" ou "Não negativar", e exportação.
  A lista mostra uma linha por aluno com todas as parcelas dele; ao clicar abre a janela do aluno, com
  "Sim" no Mentor e no Serasa por parcela (ou todas de uma vez). A tabela "Acompanhamento de negativações
  por mês" conta as parcelas incluídas no Serasa em cada mês, pela data de inclusão.
  Cada **período** equivale a uma aba da planilha: cada parcela pertence a um período, e a mesma
  parcela pode estar em mais de um (como na planilha). Os 9 períodos da planilha já vêm criados; os
  próximos são criados em "+ Novo período" e entram no campo "Período" (o ✎ edita ou exclui).
  Ao importar, escolha o período de destino — ou use um arquivo com a coluna PERÍODO.
  O histórico completo, com o período de cada linha, está em `migracao/serasa-por-periodo.csv`
  (Serasa → Importar planilha → arraste o arquivo). Reimportar não duplica.
- **Importar relatório em PDF** (Painel e Contraturno) — além do CSV, a importação aceita o PDF do relatório
  de Inadimplência do sistema (Código, Nome, Data vcto. … Devido). O PDF é lido no navegador (pdf.js);
  cada linha é uma parcela, agrupadas por RA, e o valor em aberto é a coluna Devido.
- **Base de dados** — alunos e responsáveis financeiros (relatório total do sistema, em CSV). Guarda SÓ:
  aluno, matrícula, descrição da turma e nome, e-mail e telefone do responsável financeiro; as demais
  colunas (CPF, RG, endereço, nascimento…) são descartadas no navegador e nunca chegam ao servidor.
  Ao importar a base, os alunos do Painel/Contraturno recebem nome completo, turma, responsável e
  contato, e as parcelas do Serasa recebem o responsável quando estiver vazio. Nas
  importações seguintes do Painel/Contraturno/Serasa isso acontece automaticamente (pelo RA; sem RA,
  pelo nome, se for único na base).

## Atualizar o site
Altere os arquivos no GitHub (ou envie novos com **Add file → Upload files**). A cada *commit*
na branch principal a Cloudflare publica sozinha em cerca de 1 minuto. Os dados do banco não são afetados.
O andamento aparece em **Trabalhadores e Páginas → cobranca-colegioser → Implantações**.

## Problemas comuns
- **"Banco de dados não vinculado"**: o `database_id` no `wrangler.toml` está errado ou faltando.
- **Falha na implantação dizendo que o nome não confere**: o nome do projeto na Cloudflare precisa ser igual ao `name` do `wrangler.toml`.

---

## Segurança, em resumo
- Senhas guardadas só como hash PBKDF2 com sal (ninguém consegue ver a senha de ninguém).
- Sessão em cookie `HttpOnly` / `Secure` / `SameSite=Strict`; expira após 8 horas sem uso.
- **Sair** encerra a sessão no servidor. Desativar ou redefinir a senha de alguém derruba as sessões dessa pessoa.
- 5 senhas erradas seguidas bloqueiam o usuário por 15 minutos.
- Sempre existe pelo menos um administrador ativo.
- Todo atendimento é gravado com o nome de quem estava logado.
- O site não aparece em buscadores (`noindex`).

## Perfis
- **Administrador:** tudo, mais criar/editar/desativar/excluir acessos, redefinir senhas, importar backup e excluir qualquer atendimento.
- **Atendente:** painel, evolução, cadastrar e editar alunos, registrar atendimentos, importar/exportar planilhas, excluir os próprios atendimentos e trocar a própria senha.
