-- 008_fn_datas_disponiveis.sql
-- Retorna datas com registros em veiculos_snapshot, com contagem de veículos e arquivos.
-- Usado pelo Upload.tsx para listar datas disponíveis para exclusão.

create or replace function get_datas_disponiveis(p_tenant_id text)
returns table (data_ref date, veiculos bigint, arquivos bigint)
language sql security definer
as $$
  select
    v.data_ref,
    count(*)                    as veiculos,
    count(distinct v.arquivo)   as arquivos
  from veiculos_snapshot v
  where v.tenant_id = p_tenant_id
  group by v.data_ref
  order by v.data_ref desc;
$$;
