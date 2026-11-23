# Assinatura do Windows pela SignPath Foundation

Sem assinatura, o SmartScreen avisa "editor desconhecido" ao abrir o `Briar-Setup.exe`. A SignPath Foundation assina projetos de código aberto de graça. O editor que aparece no Windows é **SignPath Foundation**, e o certificado dela já tem reputação, então o aviso deixa de aparecer.

O repositório já está pronto para isso:

- [`CODE_SIGNING_POLICY.md`](../CODE_SIGNING_POLICY.md): a política de assinatura que a SignPath exige publicada, com o link no README.
- [`.signpath/artifact-configurations/`](../.signpath/artifact-configurations/): o que assinar em cada etapa (`app.xml` e `installers.xml`).
- [`.github/workflows/build.yml`](../.github/workflows/build.yml): os passos de assinatura. Ficam desligados até existir a variável `SIGNPATH_ORGANIZATION_ID`.
- [`scripts/update-info.mjs`](../scripts/update-info.mjs): corrige o `latest.yml` depois da assinatura.

## 1. Antes de se inscrever

- [ ] Autenticação em dois fatores ligada no GitHub de todo mundo com acesso de escrita ao repositório.
- [ ] Repositório público, com licença MIT e sem nenhum componente de código fechado.
- [ ] `CODE_SIGNING_POLICY.md` na `main`, e o README apontando para ele (já está).
- [ ] Revise as seções **Team roles** e **Privacy policy** da política. Se entrar mais alguém no time, adicione lá.

## 2. Inscrição

Inscreva-se em [signpath.org/apply](https://signpath.org/apply.html). Eles pedem, entre outras coisas:

- a URL do repositório: `https://github.com/JoaoManieri/projeto-briar`;
- a URL da política: `https://github.com/JoaoManieri/projeto-briar/blob/main/CODE_SIGNING_POLICY.md`;
- como o build é feito: GitHub Actions, num runner `windows-latest`, com electron-builder.

A análise é manual e pode levar algumas semanas.

## 3. Depois da aprovação, na SignPath

A SignPath cria a organização e o projeto, ou orienta como criar. Confira:

1. **Conector do GitHub (Trusted Build System):** ligado ao repositório `JoaoManieri/projeto-briar`. É ele que garante à SignPath que os arquivos vieram deste workflow.
2. **Projeto** com o slug `briar`. Se for outro, crie a variável `SIGNPATH_PROJECT_SLUG` no passo 4.
3. **Duas configurações de artefato**, com estes slugs e o conteúdo dos arquivos:
   - `app` → [`app.xml`](../.signpath/artifact-configurations/app.xml)
   - `installers` → [`installers.xml`](../.signpath/artifact-configurations/installers.xml)
4. **Políticas de assinatura:** `test-signing` (certificado de teste, sem aprovação) e `release-signing` (certificado de verdade, com aprovação manual).
5. **Token da API:** crie um usuário de CI com permissão de *submitter* nas duas políticas e copie o token.
6. Anote o **ID da organização**, que aparece na URL e nas configurações da organização.

## 4. No GitHub

Em **Settings → Secrets and variables → Actions** do repositório:

| Tipo | Nome | Valor |
| --- | --- | --- |
| Secret | `SIGNPATH_API_TOKEN` | o token do usuário de CI |
| Variable | `SIGNPATH_ORGANIZATION_ID` | o ID da organização (isso liga a assinatura) |
| Variable | `SIGNPATH_SIGNING_POLICY` | `test-signing` no primeiro teste |
| Variable | `SIGNPATH_PROJECT_SLUG` | só se o projeto não se chamar `briar` |

## 5. Primeiro teste e depois para valer

1. Com `SIGNPATH_SIGNING_POLICY=test-signing`, faça um push na `main`. O workflow **Instaladores** deve passar pelos passos de assinatura. Os arquivos saem com o certificado de teste, então o Windows ainda avisa. O objetivo aqui é só validar o caminho.
2. Troque a variável para `release-signing`, ou apague a variável, porque esse já é o padrão.
3. No próximo push, o build para em dois momentos esperando aprovação na SignPath: primeiro o `Briar.exe`, depois o instalador e o portátil. Aprove cada pedido no site da SignPath em até 1 hora; depois disso o job falha e a Release fica como rascunho.
4. Baixe o `Briar-Setup.exe` da Release. Em **Propriedades → Assinaturas digitais** deve aparecer **SignPath Foundation**.
5. Atualize os READMEs: tire a frase sobre o SmartScreen avisar e diga que os executáveis do Windows são assinados.

Como todo push na `main` vira Release, cada uma vai pedir duas aprovações. Se isso pesar, dá para mudar o gatilho do workflow para tags ou só para execução manual.

## Como o workflow assina

1. `npm run dist:win` gera tudo sem assinatura, como antes. A pasta `release/win-unpacked` sai com o `app-update.yml`, que o atualizador automático precisa. Um build só com `--dir` não grava esse arquivo; por isso o build completo vem primeiro.
2. O `Briar.exe` vai para a SignPath (configuração `app`) e volta assinado para `release/win-unpacked`.
3. `electron-builder --prepackaged release/win-unpacked` remonta o instalador e o portátil com o `Briar.exe` assinado dentro.
4. Instalador e portátil vão para a SignPath (configuração `installers`) e voltam assinados.
5. A assinatura muda o instalador. `scripts/update-info.mjs` refaz o `.blockmap` e corrige o `sha512` e o tamanho no `latest.yml`. Sem isso, a atualização automática recusaria o arquivo.

O desinstalador embutido no instalador não é assinado: ele é gerado dentro do NSIS, e a SignPath só recebe arquivos prontos. Isso não gera aviso do SmartScreen.
