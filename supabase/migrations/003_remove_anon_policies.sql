-- 003_remove_anon_policies.sql
-- Remove acesso anônimo: o portal agora exige autenticação (Supabase Auth).
-- Execute APÓS configurar o usuário do cliente em Authentication → Users.

drop policy if exists "snapshot_leitura_anon"     on veiculos_snapshot;
drop policy if exists "eventos_leitura_anon"      on eventos_diarios;
drop policy if exists "preferencias_leitura_anon" on preferencias;

-- As políticas de leitura para 'authenticated' criadas na migration 001 permanecem.
-- Apenas usuários com JWT válido (via signInWithPassword) conseguem ler os dados.
