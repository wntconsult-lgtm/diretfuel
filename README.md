# DirectFuel Vixpar

Sistema de gestão de abastecimentos, acordos, medições, documentos fiscais e integração contábil com o SAP.

## Situação da migração

Este repositório contém a cópia do código do DirectFuel para preparar a migração de infraestrutura. A implantação externa e a transferência do banco, PDFs, XMLs e backups ainda precisam ser realizadas.

Origem: https://directfuel-vixpar.espa-o-de-tr-3403.chatgpt.site

O ambiente atual continua sendo o ambiente operacional durante a preparação. A criação deste repositório não reduz a ocupação indicada no site atual.

## Arquitetura do código importado

| Componente | Implementação atual |
| --- | --- |
| Interface | React, Vinext e arquivos JavaScript do DirectFuel |
| APIs | Rotas do servidor executadas em Cloudflare Workers |
| Banco | Cloudflare D1, binding `DB` |
| Documentos e backups | Cloudflare R2, binding `BUCKET` |
| Identidade | Login e cabeçalhos autenticados fornecidos pelo ChatGPT Sites |

A configuração `.openai/hosting.json` registra a origem e os bindings da aplicação existente. Ela foi preservada como parte do código importado; a nova hospedagem precisa de configuração própria.

## Destino previsto

- GitHub privado para o código e seu histórico.
- Hospedagem com servidor e HTTPS para a aplicação e suas APIs.
- PostgreSQL para os dados operacionais, preservando a decisão adotada para o projeto.
- Armazenamento de objetos com acesso privado para PDFs, XMLs e backups.

O GitHub Pages oferece hospedagem estática. A aplicação completa exige APIs, banco, documentos e autenticação; este repositório ainda não é uma implantação no GitHub Pages ou em outro provedor.

## Ocupação de armazenamento

No código importado, o indicador compara o tamanho da base operacional serializada com `STATE_LIMIT_BYTES = 8_000_000`. Esse percentual não representa a capacidade total da hospedagem. A base armazenada em uma linha também tem um limite seguro de 1.900.000 bytes após compactação.

Mover este mesmo código manteria esses controles. A migração deve adaptar a persistência, distribuir os registros por tabelas e preservar versões, permissões e regras de concorrência.

## Estrutura

- `app/`: páginas e APIs.
- `lib/`: regras e serviços do DirectFuel.
- `public/`: interface, estilos, bibliotecas e arquivos de referência.
- `db/` e `drizzle/`: schema e migrações do banco atual.
- `worker/`: entrada do servidor Cloudflare.
- `tests/`: testes existentes do projeto.
- `docs/`: orientação e identificação da origem da migração.

## Desenvolvimento e validação

O projeto importado requer Node.js >= 22.13.0. Seus scripts existentes usam Linux, `flock`, `curl` e GNU `timeout`, com dependências fixadas por `package-lock.json`.

```bash
npm run install:ci
npm run dev
```

A execução depende de bindings D1/R2 e do fluxo de autenticação de Sites. O código ainda precisa ser adaptado antes de executar em um servidor Node com PostgreSQL e autenticação própria.

```bash
npm run typecheck
npm run build
npm test
```

Esses são os comandos existentes. A importação verifica a integridade dos arquivos; os testes funcionais da aplicação e da infraestrutura de destino serão executados após as adaptações.

## Transferência dos dados

A cópia dos dados será uma etapa separada e validada: gerar um backup consistente, exportar as tabelas, transferir documentos e comparar contagens, vínculos, hashes e totais financeiros. A virada requer sincronizar as últimas alterações e definir qual ambiente receberá as gravações.

Detalhes: [docs/MIGRACAO.txt](docs/MIGRACAO.txt).
