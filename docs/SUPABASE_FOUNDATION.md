# Fundação PostgreSQL para a migração do DirectFuel

Projeto de testes: Directfuel Vixpar, região São Paulo (sa-east-1).
Esta etapa prepara a persistência; não publica o site, não migra dados e não altera o Site em uso.

## Estrutura aplicada

O arquivo db/postgresql/schema.sql registra as duas migrações aplicadas pelo conector Supabase em 7 de outubro de 2026: directfuel_private_foundation e directfuel_reference_indexes. É uma referência SQL da configuração, não um arquivo criado pelo comando supabase migration new.

O schema privado directfuel contém members, state_revision, collections, records, documents, backups e audit_events. Somente a linha inicial de revisão foi criada; não existem usuários, documentos, backups ou registros operacionais importados.

As coleções são persistidas por registro, evitando concentrar todo o estado em uma linha. Isso prepara a substituição do limite de 8 MB da aplicação atual; esse limite continua em vigor até adaptar a API.

## Acesso

Todas as sete tabelas têm RLS habilitado e não concedem acesso aos papéis anon e authenticated. O schema não foi exposto pela Data API. O backend deverá validar o usuário e suas permissões antes de utilizar credenciais de serviço. Credenciais de serviço nunca devem entrar no frontend, no repositório ou nos arquivos publicados pelo GitHub Pages.

Os membros começam inativos. A vinculação com Supabase Auth, os perfis e as unidades precisam ser configurados pelo backend. A autorização não pode confiar em metadados alteráveis pelo usuário.

O papel service_role pode inserir e consultar eventos de auditoria, mas não atualizá-los ou excluí-los.

## Verificação realizada

Um teste transacional inseriu dois registros cujo JSON serializado somava mais de 8 MB. Foram conferidos RLS nas sete tabelas, bloqueio dos papéis de cliente e restrições de alteração da auditoria. O teste foi revertido e não deixou dados de demonstração. A revisão inicial permaneceu em zero.

Os quatro índices de referência ausentes apontados pelo verificador foram adicionados. Os avisos restantes são informativos: índices ainda não usados num banco novo e RLS sem políticas de cliente, decisão intencional para o schema privado.

Referências:
- https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index

## Próximas etapas necessárias

1. Adaptar o frontend estático e criar o workflow de publicação no GitHub Pages, com o caminho /diretfuel/.
2. Implementar login Supabase e backend que valide identidade, perfil, unidade e permissões em cada operação.
3. Portar as APIs existentes, preservando revisão concorrente, proteções fiscais e contábeis e trilha de auditoria.
4. Criar armazenamento privado para PDF/XML e backups. A rotina deverá validar o novo backup antes de excluir excedentes e conservar os cinco mais recentes válidos.
5. Importar uma cópia validada dos dados, conferir totais e documentos e testar os fluxos de uso.
6. Publicar e validar a cópia antes de decidir a troca do endereço de uso.

Não há workflow de publicação, função backend ou rotina de backup implementados por esta etapa. O projeto Supabase criado anteriormente em Ohio não foi alterado.
