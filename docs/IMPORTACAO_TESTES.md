# Importação inicial da cópia de testes

O portal publicado permite entrar e importar o backup geral JSON para uma base privada separada. A aplicação conectada já está disponível para testes; veja [APLICACAO_TESTES.md](APLICACAO_TESTES.md) para módulos disponíveis e limitações. O Site atual continua sendo o ambiente operacional. A importação não reduz a ocupação do Site atual e não constitui a migração concluída.

## Procedimento

1. No DirectFuel atual, exportar o backup geral JSON, sem zerar ou excluir dados.
2. Abrir https://wntconsult-lgtm.github.io/diretfuel/ e entrar com a conta já vinculada.
3. Em **Importar o backup geral**, selecionar o arquivo. Conferir a quantidade de registros e marcar a confirmação.
4. Selecionar **Importar registros** e aguardar a confirmação de gravação e backup validado.
5. Usar **Atualizar situação** para conferir a revisão e a quantidade importada.

Uma base preenchida bloqueia a importação inicial. Se a conexão cair durante o envio, atualizar a situação antes de repetir: uma gravação concluída não será sobrescrita. PDFs e XMLs não fazem parte do backup geral e serão migrados separadamente. O arquivo selecionado é enviado diretamente ao Supabase mediante sessão do usuário, sem passar pelo GitHub. Não incluir backups ou documentos no repositório público.

## Backend implantado

A função `directfuel-api` exige JWT e valida a conta confirmada com Auth `/user`. Cada operação verifica novamente o membro Master ativo vinculado ao UUID real de Auth. Somente o responsável pela migração pode acessar nesta etapa; usuários legados preservados no JSON não ganham acesso de Auth automaticamente.

O banco mantém coleções e registros separados. A escrita usa revisão concorrente com erro PT409; a gravação e o histórico são transacionais. As regras fiscais e de negócio reutilizam o código de `lib/` da versão original. Alterações comuns recebem numeração automática, enquanto importação inicial e restauração preservam números históricos. A importação mantém o histórico legado em `importedAuditHistory`, sem tratá-lo como auditoria autenticada da nova base.

A importação e a criação do primeiro backup validado ocorrem na mesma transação. Backups posteriores são validados por leitura e SHA-256 antes de descartar os mais antigos; são mantidos cinco backups validados. Nesta etapa, seus conteúdos JSON ficam em `directfuel.backup_payloads`, consumindo a cota do PostgreSQL. PDFs/XMLs usam o bucket privado `directfuel-documents`, preparado no primeiro envio autorizado. O envio individual de novos documentos está disponível na aplicação conectada; o portal de importação não possui essa opção. Limite por documento: 20 MiB; envelope de sincronização: 32 MB, que não representa a capacidade total do banco ou a cota do provedor.

Rotas disponíveis no backend: versão, leitura/gravação do estado, importação inicial, backups/auditoria/restauração, uso da base, documentos individuais, relatório de contabilização, auditoria de volume e Ticketlog. Atualização de vínculos Ticketlog pela frota está disponível. Análise geográfica completa, retenção e documentos concluídos ainda exigem adaptação. Rotas indisponíveis retornam erro explícito; não apresentam sucesso fictício.

## Validação executada

```
node scripts/build-supabase-core.mjs
node scripts/build-pages-preview.mjs
node --test tests/pages-preview.test.mjs tests/supabase-core.test.mjs
```

20 testes automatizados passaram nesta etapa inicial; a integração das telas acrescenta sete verificações. `tests/supabase-transaction.sql` foi executado no banco remoto vazio, com dados artificiais de aproximadamente 9 MB: importação, cópia exata, backup validado, rejeição de revisão antiga, bloqueio de sobrescrita da base preenchida, retenção de cinco backups, recusa de backup corrompido e imutabilidade de PDFs de layout. Tudo foi revertido; nenhuma amostra operacional foi publicada e os contadores voltaram a zero. O login do portal foi verificado pelo usuário. A importação real foi concluída pelo usuário e conferida com 5.212 registros e um backup validado; os fluxos completos dos módulos ainda precisam de validação.

Referências SQL aplicadas por migrações remotas, sem simular histórico da CLI: `operational-core.sql`, `documents.sql` e `import.sql`. Correções remotas: `directfuel_security_query_correction`, `directfuel_state_input_guard` e `directfuel_document_concurrency_and_initial_import`. A função operacional não altera nem publica o Site original.

## Verificação de segurança

Tabelas privadas com RLS e sem políticas para clientes são intencionais; RPCs usam SECURITY INVOKER, com EXECUTE reservado a service_role. Os avisos de RLS sem políticas e índices ainda não usados são informativos:

- https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index

O advisor também aponta proteção contra senhas vazadas desativada. A documentação disponibiliza esse recurso somente nos planos Pro ou superiores; nenhum plano foi contratado nem alterado. Referência: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection . Não confundir esse aviso de Auth com exposição das tabelas privadas.

