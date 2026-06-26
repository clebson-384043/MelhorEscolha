-- 004_admin_perfis.sql
-- Tabela de super admins do portal (identificados por e-mail).
-- Consultada pela Edge Function admin-users para verificar permissão.

create table if not exists admin_perfis (
  email text primary key
);

alter table admin_perfis enable row level security;

-- Usuário autenticado pode verificar se ele mesmo é admin (para o app exibir o botão)
create policy "auto_verificacao" on admin_perfis
  for select using (auth.email() = email);

-- Clebson como super admin inicial
insert into admin_perfis (email)
values ('carmoclebson@gmail.com')
on conflict do nothing;
