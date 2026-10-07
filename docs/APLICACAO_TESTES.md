# Aplicação DirectFuel conectada ao Supabase

A aplicação de testes fica em https://wntconsult-lgtm.github.io/diretfuel/app/ . Entre pelo portal https://wntconsult-lgtm.github.io/diretfuel/ e selecione **Abrir aplicação de testes**. O portal e a aplicação usam a sessão da mesma aba. Sem sessão, a aplicação redireciona para o portal.

Nesta etapa, as telas de dashboard, cadastros, acordos, abastecimentos, medições, contabilização, relatórios DirectFuel, documentos e segurança usam a nova base. Alterações explícitas são enviadas exclusivamente ao backend privado do Supabase, com a revisão concorrente e as validações originais. O Site atual continua sendo o ambiente do trabalho diário; as bases não são sincronizadas automaticamente entre provedores.

Auditoria de capacidade e janelas, calibração de parâmetros, tratamentos manuais, novas cargas Ticketlog, relatórios de postos e atualização dos vínculos pela frota estão disponíveis nesta aplicação. Rotas geográficas e busca automática de coordenadas, gestão de contas, limpeza completa e retenção com compactação continuam em adaptação. O mapa e a revisão manual de postos estão disponíveis. O histórico Ticketlog do sistema anterior não acompanha o backup geral; será necessário importar os CSVs na cópia. PDFs/XMLs históricos não acompanham o backup JSON e ainda não foram migrados; tentar abri-los retorna mensagem de documento não encontrado. Novos PDFs/XMLs individuais podem ser enviados ao backend privado. A validação real do envio de documentos depende de teste com uma conta autorizada e um arquivo do usuário.

## Implementação

O build gera uma aplicação estática sob `dist/pages-preview/app` a partir dos scripts originais, sem alterar `app/`, `public/` nem o Site original. Remove todas as linhas de demonstração do seed, mantém configurações padrão e copia somente os arquivos necessários. Os dados operacionais são lidos após login e nunca embutidos no artefato público.

A função `createGateway` encaminha somente chamadas `/api/` da própria origem para `directfuel-api`, preservando métodos, corpos, arquivos, parâmetros e cancelamento. Envia JWT do usuário e chave pública em cabeçalhos, sem cookies e sem seguir redirecionamentos. Não envia tokens para arquivos estáticos ou serviços externos. Links de documentos/backups usam busca autenticada e URLs temporárias de blob; não tornam o bucket público.

A leitura inicial mantém o snapshot importado e não dispara escrita automática para normalizar NFs ou atualizar identidade local. As alterações explícitas continuam passando pelo mecanismo original de sincronização, conflito, revisão e recuperação. Rascunhos de recuperação podem ser guardados localmente em caso de conflito; o estado operacional principal permanece no servidor.

As limitações aparecem na faixa de testes e nos módulos indisponíveis. Os percentuais de envio representam o envelope de sincronização de 32 MB, e não a cota total do banco ou da nuvem. O armazenamento privado e os cinco backups validados seguem o backend implantado na etapa anterior.

## Validação

```
node scripts/build-supabase-core.mjs
node scripts/build-pages-preview.mjs
node --test tests/pages-preview.test.mjs tests/pages-app.test.mjs tests/supabase-core.test.mjs tests/supabase-operations.test.mjs
```

38 testes passaram: autenticação e rejeições, envio privado de alterações e arquivos, preservação de parâmetros, ausência de tokens em requisições externas, artefato sem dados de demonstração, sintaxe/presença de todos os módulos, revisão coerente e leitura inicial sem normalização ou gravação automática.

Um teste transacional no banco preenchido gravou uma coleção artificial, verificou que todas as coleções existentes permaneciam idênticas e rejeitou revisão antiga. Foi revertido; revisão, registros e backup da importação permaneceram intactos. Não houve alteração dos dados importados por essa verificação.

Os testes de UI são verificações de scripts e simulações de transporte/sincronização; não substituem a validação visual e dos fluxos completos pelo usuário autenticado no navegador. Antes de usar com o time, conferir navegação, uma edição de teste, medições e exportações SAP na cópia, e concluir as funções ainda indisponíveis e a migração de documentos.

## Auditoria e Ticketlog

Os dados dos novos módulos ficam em coleções privadas de registros, com a mesma revisão concorrente do restante da base. Somente as rotas dedicadas podem alterá-los; uma gravação comum do frontend preserva essas coleções. Backups e restauração incluem seus conteúdos, e exclusões guardam os registros na auditoria e criam previamente um backup validado, na mesma transação. A restauração deve considerar o efeito sobre a base inteira.

A auditoria considera abastecimentos anteriores ao início do filtro para calcular as janelas, inclusive em outros postos. A simulação não grava parâmetros. Calibração e tratamentos rejeitam versões desatualizadas. O resumo do dashboard utiliza o intervalo de datas, conforme o comportamento original.

Ticketlog aceita até 500 registros por chamada. Lotes e trechos repetidos são reconhecidos por identificador e SHA-256. Contadores são calculados no servidor; vínculos são derivados da frota cadastrada. Duplicatas podem corrigir somente horários não vazios quando os demais campos essenciais coincidem. Cargas interrompidas aparecem como em andamento e os registros já confirmados permanecem preservados. Datas inválidas são rejeitadas; leituras não executam limpeza automática de importações antigas.

Onze verificações adicionais cobrem janelas atravessando dias, resumo e simulação, calibração e tratamento concorrentes, deduplicação, calendário, vínculos, paginação de postos, exclusões, auditoria, restauração e rejeição de conteúdo inseguro. Uma verificação transacional no banco preenchido adicionou apenas registros artificiais e confirmou preservação das coleções anteriores, rejeição de revisão antiga e backup anterior à exclusão. Foi integralmente revertida. A validação visual autenticada continua pendente.

## Mapa e documentos antigos

A análise geográfica está disponível com mapa, filtros por data/produtos/origem/UF/posto/volume, consolidações, exportações e revisão manual da identidade entre postos Ticketlog e DirectFuel. A revisão inclui tratamento de concorrência e auditoria. As regras de negócio foram extraídas para `lib/directfuel-geo-core.ts`; nenhuma consulta de leitura apaga dados nem grava parâmetros.

Nesta cópia, rotas rodoviárias e busca automática de coordenadas permanecem desabilitadas. O servidor OSRM de demonstração restringe uso comercial; o Nominatim público impõe requisitos para consultas e geocodificação em lote. Nenhum desses serviços recebe os dados da nova base. Não se transforma distância em linha reta em rota rodoviária ou saving calculado. Coordenadas existentes no cadastro ou em cargas são utilizadas no mapa. O mapa usa Leaflet 1.9.4 fixado e tiles OpenStreetMap com atribuição. Uma falha no carregamento do Leaflet preserva o acesso aos demais módulos.

- https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server
- https://operations.osmfoundation.org/policies/nominatim/

No menu **Documentos**, a seção **Migrar PDFs e XMLs antigos** confere referências presentes e faltantes e permite selecionar vários arquivos. Nomes ambíguos exigem escolha manual da NF; cada vínculo precisa ser conferido antes do envio. O backend exige uma referência existente, checa a revisão e impede sobrescrever um arquivo já migrado. Cada arquivo é enviado separadamente ao bucket privado, com máximo de 20 MiB. Falhas interrompem o lote e preservam os envios já concluídos. Os arquivos físicos antigos não foram transferidos automaticamente nem fazem parte do JSON; precisam ser disponibilizados pelo usuário.

A seção **Excluir arquivos de NFs concluídas no SAP** analisa os arquivos presentes e protege referências adicionais, NFs pendentes, lançamentos parciais/com erro e layouts. Somente após confirmação explícita do usuário, a exclusão verifica atomicamente revisão da base e SHA-256 do arquivo, marca a remoção e registra auditoria; depois limpa o objeto no bucket. Uma falha de limpeza fica registrada como pendente, sem anunciar sucesso, e pode ser retomada no painel de migração. Os dados operacionais das NFs e medições não são apagados. Backups JSON não recuperam PDFs/XMLs removidos.

48 testes automatizados passaram. Dez verificações adicionais cobrem mapa, filtros, ausência de oportunidades fictícias, revisões concorrentes, referências compartilhadas, prévia de arquivos, exclusão protegida, migração sem sobrescrita, retomada de limpeza e isolamento de credenciais. Uma transação remota com metadados artificiais confirmou proteção de revisão e hash, bloqueio de sobrescrita e acesso RPC restrito ao backend; foi revertida, preservando 5.212 registros, revisão 2, um backup e zero documentos físicos na nova base. A validação visual com login e o envio dos arquivos reais continuam pendentes.

Gestão de contas da equipe e limpeza completa ainda estão indisponíveis. Retenção avançada com prévia e execução manual está disponível na seção a seguir. O acesso continua exclusivo do Master vinculado; usuários do JSON não provisionam contas Supabase.

## Retenção avançada da cópia

Em **Configurações → Consumo e capacidade → Política de retenção**, o Master pode salvar prazo e seleção de PDF, XML e detalhes fiscais, analisar a prévia e confirmar a execução. A elegibilidade exige NF aprovada com chave válida e todos os vínculos SAP ativos confirmados, com pedido e data válida anteriores ao limite. O prazo considera o último lançamento ativo, não apenas o primeiro. Leituras e prévias não limpam dados; não há tarefa agendada.

Arquivos compartilhados com notas mais recentes, referências adicionais e layouts são preservados. Referências de PDFs/XMLs ainda não migrados permanecem na base. A compactação remove somente os campos volumosos de leitura, mantendo totais, chaves, IVA, materiais, campos adicionais, abastecimentos e vínculos SAP. Políticas desmarcadas mantêm os respectivos conteúdos.

A RPC privada `directfuel_retention` grava um backup validado, altera a revisão e marca os arquivos selecionados na mesma transação. Uma revisão ou hash desatualizados abortam a operação inteira. A remoção física ocorre depois da transação, somente em caminhos imutáveis e com limpeza imediata limitada a três arquivos; os demais ficam no registro de pendências e podem ser concluídos em **Documentos → Migrar PDFs e XMLs antigos → Conferir arquivos faltantes → Concluir limpezas pendentes**. Não se anuncia remoção física que ainda não ocorreu. O backup JSON preserva a base, mas não recupera arquivos físicos apagados.

55 testes automatizados passaram, incluindo sete cenários de retenção: preservação de dados, múltiplos vínculos SAP, arquivos compartilhados, referências faltantes, políticas, confirmação e conflito, falhas transacionais/físicas e limite de limpeza imediata. A verificação remota usa somente metadados artificiais com rollback e nunca executa retenção nos dados reais.
