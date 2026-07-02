-- 006_unique_por_arquivo.sql
-- Permite o mesmo veículo aparecer em múltiplos arquivos/listas no mesmo dia.
-- Antes: unique (tenant_id, data_ref, placa)
-- Depois: unique (tenant_id, data_ref, arquivo, placa)
--
-- Isso é necessário porque um carro pode constar em mais de um pátio/lista
-- no mesmo dia, e queremos manter todos os registros para análise histórica.

alter table veiculos_snapshot
  drop constraint if exists veiculos_snapshot_tenant_id_data_ref_placa_key;

alter table veiculos_snapshot
  add constraint veiculos_snapshot_tenant_data_arquivo_placa_key
  unique (tenant_id, data_ref, arquivo, placa);
