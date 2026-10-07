# Aplicação DirectFuel conectada ao Supabase

A aplicação de testes fica em https://wntconsult-lgtm.github.io/diretfuel/app/ . Entre pelo portal https://wntconsult-lgtm.github.io/diretfuel/ e selecione **Abrir aplicação de testes**. O portal e a aplicação usam a sessão da mesma aba. Sem sessão, a aplicação redireciona para o portal.

Nesta etapa, as telas de dashboard, cadastros, acordos, abastecimentos, medições, contabilização, relatórios DirectFuel, documentos e segurança usam a nova base. Alterações explícitas são enviadas exclusivamente ao backend privado do Supabase, com a revisão concorrente e as validações originais. O Site atual continua sendo o ambiente do trabalho diário; as bases não são sincronizadas automaticamente entre provedores.

Ticketlog, análise geográfica, auditoria de capacidade, gestão de contas, limpeza completa e retenção de documentos ainda estão em adaptação e ficam indisponíveis nesta aplicação. PDFs/XMLs históricos não acompanham o backup JSON e ainda não foram migrados; tentar abri-los retorna mensagem de documento não encontrado. Novos PDFs/XMLs individuais podem ser enviados ao backend privado. A validação real do envio de documentos depende de teste com uma conta autorizada e um arquivo do usuário.

## Implementação

O build gera uma aplicação estática sob `dist/pages-preview/app` a partir dos scripts originais, sem alterar `app/`, `public/` nem o Site original. Remove todas as linhas de demonstração do seed, mantém configurações padrão e copia somente os arquivos necessários. Os dados operacionais são lidos após login e nunca embutidos no artefato público.

A função `createGateway` encaminha somente chamadas `/api/` da própria origem para `directfuel-api`, preservando métodos, corpos, arquivos, parâmetros e cancelamento. Envia JWT do usuário e chave pública em cabeçalhos, sem cookies e sem seguir redirecionamentos. Não envia tokens para arquivos estáticos ou serviços externos. Links de documentos/backups usam busca autenticada e URLs temporárias de blob; não tornam o bucket público.

A leitura inicial mantém o snapshot importado e não dispara escrita automática para normalizar NFs ou atualizar identidade local. As alterações explícitas continuam passando pelo mecanismo original de sincronização, conflito, revisão e recuperação. Rascunhos de recuperação podem ser guardados localmente em caso de conflito; o estado operacional principal permanece no servidor.

As limitações aparecem na faixa de testes e nos módulos indisponíveis. Os percentuais de envio representam o envelope de sincronização de 32 MB, e não a cota total do banco ou da nuvem. O armazenamento privado e os cinco backups validados seguem o backend implantado na etapa anterior.

## Validação

```
node scripts/build-supabase-core.mjs
node scripts/build-pages-preview.mjs
node --test tests/pages-preview.test.mjs tests/pages-app.test.mjs tests/supabase-core.test.mjs
```

27 testes passaram: autenticação e rejeições, envio privado de alterações e arquivos, preservação de parâmetros, ausência de tokens em requisições externas, artefato sem dados de demonstração, sintaxe/presença de todos os módulos, revisão coerente e leitura inicial sem normalização ou gravação automática.

Um teste transacional no banco preenchido gravou uma coleção artificial, verificou que todas as coleções existentes permaneciam idênticas e rejeitou revisão antiga. Foi revertido; revisão, registros e backup da importação permaneceram intactos. Não houve alteração dos dados importados por essa verificação.

Os testes de UI são verificações de scripts e simulações de transporte/sincronização; não substituem a validação visual e dos fluxos completos pelo usuário autenticado no navegador. Antes de usar com o time, conferir navegação, uma edição de teste, medições e exportações SAP na cópia, e concluir as funções ainda indisponíveis e a migração de documentos.
