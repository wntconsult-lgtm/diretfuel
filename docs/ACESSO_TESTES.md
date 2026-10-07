# Acesso de testes no GitHub Pages e Supabase

Esta etapa permite validar login e comunicação com o novo banco. A página não contém os módulos operacionais do DirectFuel; não permite importar, alterar, excluir ou enviar documentos. O Site atual permanece em uso. Não confundir esta página com a migração concluída.

## Componentes

- migration/pages: tela em português, login Supabase Auth e situação do banco.
- supabase/functions/directfuel-preview: API de consulta protegida com verify_jwt habilitado. Valida a sessão online em Auth /user e consulta somente a função restrita public.directfuel_preview_access.
- db/postgresql/preview-access.sql: referência da função aplicada pela migração remota directfuel_preview_access. SECURITY INVOKER, sem EXECUTE para PUBLIC, anon ou authenticated; somente service_role.
- .github/workflows/pages-preview.yml: gera e testa os arquivos estáticos. Publicação requer execução manual com publish habilitado na branch main; commits e pull requests executam somente verificação.

O SDK de autenticação no navegador usa versão exata 2.117.2, registrada em dependencies.lock.json. O backend e a geração dos arquivos usam APIs nativas, sem instalar pacotes. Nenhuma credencial de serviço entra nos arquivos estáticos. A chave sb_publishable é pública; o banco permanece inacessível aos papéis de cliente.

## Primeiro usuário

O projeto começou sem usuários de Auth. A conta utilizada para administrar o Supabase é separada dos usuários da aplicação.

1. Abrir o projeto de São Paulo no painel Supabase.
2. Abrir Autenticação → Usuários.
3. Selecionar Adicionar usuário → Criar novo usuário.
4. Usar o e-mail do responsável pela migração e definir uma senha particular. Confirmar automaticamente o e-mail da conta criada, quando a opção estiver disponível. Não enviar a senha em mensagens ou salvá-la no repositório.
5. Depois da criação, vincular o UUID real de Auth à linha correspondente em directfuel.members e ativá-la. A linha inicial do responsável está inativa e sem vínculo; login sem esse vínculo continua recusado.

A cópia de testes aceita somente o membro Master responsável pela migração. Os demais perfis e regras de unidade dependem da adaptação das APIs operacionais. Nunca autorizar por user_metadata.

## Verificação

Executar:

```
node scripts/build-pages-preview.mjs
node --test tests/pages-preview.test.mjs
```

Os testes verificam autenticação no servidor, restrição de origem, preflight, bloqueio de gravações, contas anônimas ou sem confirmação, permissões recusadas, falhas externas sem exposição de informações, transporte do JWT do usuário e conteúdo do artefato estático. As respostas HTTP dos testes são simuladas; não substituem o teste com uma conta real após seu cadastro.

O teste SQL confirma que um UUID não vinculado recebe NULL, sem revelar contagens. As tabelas privadas continuam com RLS habilitado e sem políticas de cliente. Avisos informativos de RLS sem políticas e índices ainda não usados são esperados nesse banco novo:
- https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index

## Publicação e pendências

Após validar o usuário real e revisar a mudança, incorporar a proposta à main. Em Ações → DirectFuel - acesso de testes → Executar fluxo de trabalho, selecionar main e habilitar Publicar. O destino esperado é https://wntconsult-lgtm.github.io/diretfuel/; não considerar esse endereço publicado antes de uma implantação bem-sucedida.

A API de consulta de testes pode ser implantada independentemente da página, sem disponibilizar dados sem autenticação. O acesso ao backend usa Authorization com o JWT do usuário e apikey com a chave pública; uma chave pública não deve ser enviada como Bearer.

Faltam a adaptação dos módulos operacionais, as APIs de gravação com revisão concorrente e validações fiscais, o armazenamento privado e sua retenção, a importação dos dados e a validação dos fluxos do time. O indicador atual de 88% continua relacionado ao limite de gravação de 8 MB da aplicação existente e não foi resolvido por esta etapa.

Referências verificadas: https://supabase.com/changelog ; https://supabase.com/docs/guides/functions/auth ; https://supabase.com/docs/reference/javascript/auth-signinwithpassword ; https://supabase.com/docs/reference/javascript/auth-getuser .
