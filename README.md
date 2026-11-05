# Briar — cliente Git do time

Cliente Git de desktop no estilo GitKraken, feito para o time da Hipona Studios. Roda no seu computador, sobre o seu clone local, usando o Git instalado na máquina.

## Baixar

| Sistema | Download | Observação |
| --- | --- | --- |
| **Windows** | [**Briar-Setup.exe**](https://github.com/JoaoManieri/projeto-briar/releases/latest/download/Briar-Setup.exe) | Instalador (recomendado) |
| Windows | [Briar-Portable.exe](https://github.com/JoaoManieri/projeto-briar/releases/latest/download/Briar-Portable.exe) | Roda sem instalar |
| **Linux** | [**Briar-x86_64.AppImage**](https://github.com/JoaoManieri/projeto-briar/releases/latest/download/Briar-x86_64.AppImage) | Qualquer distribuição |
| Linux (Ubuntu/Debian) | [Briar-amd64.deb](https://github.com/JoaoManieri/projeto-briar/releases/latest/download/Briar-amd64.deb) | Aparece no menu de aplicativos |

Todas as versões: [página de Releases](https://github.com/JoaoManieri/projeto-briar/releases).

### Antes de instalar

Instale o **Git** ([git-scm.com/downloads](https://git-scm.com/downloads)). Para push e pull, ele precisa estar autenticado no GitHub do mesmo jeito que no terminal.

### Instalar

- **Windows:** abra `Briar-Setup.exe` e siga o instalador. Os executáveis não são assinados, então o SmartScreen pode avisar. Nesse caso clique em **Mais informações → Executar assim mesmo**.
- **Linux (AppImage):** `chmod +x Briar-x86_64.AppImage` e abra o arquivo.
- **Linux (.deb):** `sudo apt install ./Briar-amd64.deb`. Para desinstalar: `sudo apt remove briar`.

Ao abrir, clique em **Escolher pasta…** e selecione o seu clone, por exemplo `~/Projetos/projeto-pindorama`. O caminho fica salvo, e as abas abertas voltam na próxima vez.

### Atualizar

O Briar procura versão nova ao abrir e depois a cada 4 horas. Para procurar na hora, clique na versão (**Briar 0.x.y**) no canto inferior direito.

- **Instalador do Windows, AppImage e .deb:** a nova versão é baixada em segundo plano. Quando terminar, aparece **Reiniciar para atualizar** no topo. No `.deb` a instalação pede a senha de administrador.
- **Briar-Portable.exe:** aparece **Versão X disponível**, que abre a página de download. Baixe o novo executável no lugar do antigo.

A atualização automática começou na versão 0.4.0. Quem tem uma versão anterior precisa instalar a 0.4.0 manualmente uma vez.

## O que ele faz

- **Vários repositórios em abas**, como no GitKraken.
  - O **+** (ou <kbd>Ctrl</kbd>+<kbd>T</kbd>) mostra os repositórios salvos e permite abrir outro clone. Clicar no nome do repositório na barra de ferramentas faz o mesmo.
  - Cada aba tem o próprio estado. Um push numa aba não trava as outras.
  - A aba mostra a branch atual, um ponto quando há alterações não commitadas e um aviso quando há merge em andamento.
  - <kbd>Ctrl</kbd>+<kbd>Tab</kbd> troca de aba. O botão do meio do mouse fecha a aba.
- **Descartar alterações (lixeira vermelha no WIP).**
  - Em cada arquivo, ou em **Descartar** no topo de Unstaged para todos de uma vez. Sempre pede confirmação.
  - O arquivo volta a ficar como no último commit: arquivos apagados voltam e arquivos novos somem.
  - Nada se perde de vez. As alterações vão para o stash do Git como "Briar: descartado…" e o aviso que aparece depois tem **Desfazer**. Mais tarde dá para recuperar com `git stash list` e `git stash apply`.
- **Checkout com duplo clique.** Numa branch remota cuja local já existe (ex.: `origin/main` com `main`), o Briar troca para a local e a atualiza até o remoto quando possível. Se elas divergiram, ele avisa para fazer merge.
- **Arrastar para fazer merge.** Arraste uma branch sobre outra: na lateral, num rótulo do grafo ou no seletor de branch do topo.
  - Antes do merge aparece quantos commits entram e quais arquivos vão dar conflito.
  - Se o destino não é a branch atual, o Briar faz o checkout dele antes.
  - Se o destino é remoto, o merge vai para a branch local equivalente. Depois é só dar **Push**.
- **Conflitos visíveis até alguém resolver.**
  - Uma faixa vermelha fica no topo e a branch aparece como **CONFLITO**. Isso continua mesmo depois de fechar e abrir o app, porque é o estado do próprio Git.
  - Cada arquivo abre num editor por trecho, com *sua versão* e *recebida* lado a lado e os botões *Usar a minha*, *Usar a recebida* ou *As duas*.
  - Depois, **Concluir merge** ou **Abortar**.
- **Botão direito em branches, tags e commits** (na lateral, no grafo e na lista "+N").
  - **Branch:** checkout, merge na atual, criar tag ali, apagar a local, apagar no remoto ou as duas.
    - A branch atual não pode ser apagada.
    - Se os commits dela não estão em nenhuma outra branch, o Briar recusa até você marcar "Apagar mesmo assim".
  - **Criar tag:** o nome já vem com o próximo número da última tag criada (`v1.0.4` → `v1.0.5`).
    - Não deixa repetir uma tag que já existe.
    - Com mensagem, vira tag anotada.
    - A caixa "Enviar a tag (push)" vem marcada.
  - **Tag:** push para o remoto, localizar no grafo, apagar local, apagar no remoto ou nos dois.
  - **Commit:** criar tag ou branch ali, copiar o hash.
- **Grafo** no estilo GitKraken, com a branch atual sempre na primeira coluna.
  - Quando um commit tem várias branches, aparece **+N**. Ao passar o mouse abre a lista delas: clique numa para fazer checkout, ou arraste para fazer merge.
- **// WIP:** a linha no topo mostra os arquivos ainda não commitados. No painel direito ficam Stage/Unstage, diff e commit.
- **Pull** (fast-forward ou com merge), **Push** (cria o upstream na primeira vez, nunca faz force push), **Fetch** e **Branch**.
- Histórico das operações Git da sessão (ícone de terminal).

Não há rebase, reset hard nem force push. A troca de branch é bloqueada quando há alterações em arquivos rastreados (arquivos novos não atrapalham). A autenticação usa a configuração de Git/SSH já existente: o Briar nunca pede senha ou token.

Cada pessoa usa o Briar no próprio computador, com o próprio clone. O time continua se comunicando pelo remoto Git (push/pull).

## Desenvolver

Requer **Node.js 22.13+** e **Git**.

```bash
npm install
npm run app        # compila a interface e abre o Briar numa janela
npm run dev        # modo navegador com recarga automática: http://127.0.0.1:5173
npm test           # testes com repositórios temporários (não tocam no Pindorama)
```

No modo navegador dá para indicar o clone ao iniciar: `npm run dev -- --repo ~/Projetos/projeto-pindorama`.

Estrutura:

- `src/`: interface (React).
- `server/`: operações Git, chamando o `git` do sistema.
- `electron/`: janela do aplicativo.
- `tests/`: testes da camada Git.

## Publicar uma versão

Os links de download e a atualização automática usam sempre a Release mais recente do repositório `JoaoManieri/projeto-briar`.

**É automático: todo push na `main` publica uma versão nova.** O workflow **Instaladores** (`.github/workflows/build.yml`) faz o seguinte:

1. Calcula a versão com `scripts/next-version.mjs`. Normalmente é a última tag mais 1 no patch (`v0.6.2` → `0.6.3`).
2. Gera os instaladores de Windows e Linux com essa versão.
3. Publica a Release `vX.Y.Z` com os instaladores e os arquivos da atualização automática. A tag é criada nesse momento.

- **Subir minor ou major:** mude a versão no `package.json` (ex.: `0.7.0`) e faça o push. Se ela for maior que a última tag, vale ela. Depois disso o patch volta a subir sozinho.
- **Push sem Release:** ponha `[skip ci]` na mensagem do commit. Pushes que só mexem em arquivos `.md`, `LICENSE` ou `.gitignore` também não geram Release.
- **Não crie tags `v*` à mão.** O próprio workflow cria.
- Se o build falhar, a Release fica como rascunho e nada chega aos usuários. O próximo push tenta de novo com o mesmo número.

Para gerar e publicar à mão (só se o GitHub Actions estiver fora do ar):

1. Suba a versão em `package.json` (ex.: `0.4.1`).
2. Gere os instaladores. Eles saem em `release/`, sem a versão no nome, para os links continuarem valendo.
   - **No Windows:** `npm ci` e depois `npm run dist:win`. Gera `Briar-Setup.exe`, `Briar-Portable.exe`, `Briar-Setup.exe.blockmap` e `latest.yml`.
   - **No Linux:** `npm ci` e depois `npm run dist:linux`. Gera `Briar-x86_64.AppImage`, `Briar-amd64.deb` e `latest-linux.yml`.
   - Os arquivos `.yml` e `.blockmap` são o que a atualização automática lê. Envie-os junto com os instaladores.
3. Crie a Release e envie os arquivos. Com o GitHub CLI:

   ```bash
   gh release create v0.4.1 --title "Briar 0.4.1" --notes "O que mudou…"
   gh release upload v0.4.1 release/Briar-Setup.exe release/Briar-Portable.exe release/Briar-Setup.exe.blockmap release/latest.yml   # do Windows
   gh release upload v0.4.1 release/Briar-x86_64.AppImage release/Briar-amd64.deb release/latest-linux.yml                          # do Linux
   ```

   Também dá para arrastar os arquivos na página da Release, no site do GitHub.

O ícone sai de `public/favicon.svg`. Para regenerar: `npx electron scripts/make-icon.mjs`.

## Limites

- **Histórico carregado:**
  - O grafo carrega até 300 commits recentes de todas as referências e até 300 ancestrais do HEAD. Pontas tracejadas indicam ancestrais fora desse recorte.
  - Commits de merge mostram os pais em vez de um diff.
- **Diffs:** a revisão é por arquivo inteiro e cada diff vai até 250 KB.
- **Atualização:**
  - O estado é relido a cada 15 s, ao voltar à janela e após cada operação.
  - Fetch só acontece quando você clica nele ou num pull.
