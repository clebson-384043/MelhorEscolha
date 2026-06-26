-- Cria o primeiro usuário diretamente no banco.
-- Execute no SQL Editor do Supabase.
-- Substitua SENHA_AQUI pela senha desejada.

DO $$
DECLARE
  uid uuid := gen_random_uuid();
  email_addr text := 'carmoclebson@gmail.com';
BEGIN

  -- 1. Cria o usuário
  INSERT INTO auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  ) VALUES (
    uid,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    email_addr,
    crypt('SENHA_AQUI', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  );

  -- 2. Cria a identidade (provider_id = e-mail para provider "email")
  INSERT INTO auth.identities (
    id,
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    email_addr,          -- provider_id obrigatório nas versões recentes do Supabase
    uid,
    format('{"sub":"%s","email":"%s"}', uid::text, email_addr)::jsonb,
    'email',
    now(),
    now(),
    now()
  );

  -- 3. Marca como super admin
  INSERT INTO admin_perfis (email)
  VALUES (email_addr)
  ON CONFLICT DO NOTHING;

END;
$$;
