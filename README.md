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

Ao abrir, clique em **Escolher pasta…** e selecione o seu clone, por exemplo `~/Projetos/projeto-pindorama`. O caminho fica salvo.

## O que ele faz

- **Checkout com duplo clique.** Numa branch remota cuja local já existe (ex.: `origin/main` com `main`), o Briar troca para a local e a atualiza até o remoto quando possível. Se elas divergiram, ele avisa para fazer merge.
- **Arrastar para fazer merge.** Arraste uma branch sobre outra: na lateral, num rótulo do grafo ou no seletor de branch do topo.
  - Antes do merge aparece quantos commits entram e quais arquivos vão dar conflito.
  - Se o destino não é a branch atual, o Briar faz o checkout dele antes.
  - Se o destino é remoto, o merge vai para a branch local equivalente. Depois é só dar **Push**.
- **Conflitos visíveis até alguém resolver.**
  - Uma faixa vermelha fica no topo e a branch aparece como **CONFLITO**. Isso continua mesmo depois de fechar e abrir o app, porque é o estado do próprio Git.
  - Cada arquivo abre num editor por trecho, com *sua versão* e *recebida* lado a lado e os botões *Usar a minha*, *Usar a recebida* ou *As duas*.
  - Depois, **Concluir merge** ou **Abortar**.
- **Grafo** no estilo GitKraken, com a branch atual sempre na primeira coluna.
  - Quando um commit tem várias branches, aparece **+N**. Ao passar o mouse abre a lista delas: clique numa para fazer checkout, ou arraste para fazer merge.
- **// WIP:** a linha no topo mostra os arquivos ainda não commitados. No painel direito ficam Stage/Unstage, diff e commit.
- **Pull** (fast-forward ou com merge), **Push** (cria o upstream na primeira vez, nunca faz force push), **Fetch** e **Branch**.
- Histórico das operações Git da sessão (ícone de terminal).

Não há rebase, descarte de alterações, reset hard nem force push. A troca de branch é bloqueada quando há alterações em arquivos rastreados (arquivos novos não atrapalham). A autenticação usa a configuração de Git/SSH já existente: o Briar nunca pede senha ou token.

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

Os links de download apontam sempre para a Release mais recente do repositório `JoaoManieri/projeto-briar`. Para publicar:

1. Suba a versão em `package.json` (ex.: `0.3.1`).
2. Gere os instaladores. Eles saem em `release/`, sem a versão no nome, para os links continuarem valendo.
   - **No Windows:** `npm ci` e depois `npm run dist:win`. Gera `Briar-Setup.exe` e `Briar-Portable.exe`.
   - **No Linux:** `npm ci` e depois `npm run dist:linux`. Gera `Briar-x86_64.AppImage` e `Briar-amd64.deb`.
3. Crie a Release e envie os arquivos. Com o GitHub CLI:

   ```bash
   gh release create v0.3.1 --title "Briar 0.3.1" --notes "O que mudou…"
   gh release upload v0.3.1 release/Briar-Setup.exe release/Briar-Portable.exe       # do Windows
   gh release upload v0.3.1 release/Briar-x86_64.AppImage release/Briar-amd64.deb   # do Linux
   ```

   Também dá para arrastar os arquivos na página da Release, no site do GitHub.

Alternativa sem precisar de Windows: o workflow **Instaladores** (`.github/workflows/build.yml`) gera tudo nas máquinas do GitHub. Ao criar uma tag `v*`, ele mesmo publica a Release com os quatro arquivos.

O ícone sai de `public/favicon.svg`. Para regenerar: `npx electron scripts/make-icon.mjs`.

## Limites

- **Histórico carregado:**
  - O grafo carrega até 300 commits recentes de todas as referências e até 300 ancestrais do HEAD. Pontas tracejadas indicam ancestrais fora desse recorte.
  - Commits de merge mostram os pais em vez de um diff.
- **Diffs:** a revisão é por arquivo inteiro e cada diff vai até 250 KB.
- **Atualização:**
  - O estado é relido a cada 15 s, ao voltar à janela e após cada operação.
  - Fetch só acontece quando você clica nele ou num pull.
