begin;

-- Smart Hoppers geometry (usable height, circumference) is optional on a
-- receiver_weight_profile payload: profiles saved before this feature
-- existed simply won't have usable_heights_in/circumferences_in, and
-- that's fine - only *malformed* geometry (wrong length, non-numeric,
-- negative) is rejected. Packing factor is not part of this: it's a trait
-- of the resin, not the hopper, and belongs in the resin database instead
-- once that field exists there. Not applied yet; this is
-- server-side hardening to match the client-side validation already added
-- in workspace-configuration-payloads.js. The existing function already
-- accepted these extra JSONB keys without complaint (it doesn't reject
-- unrecognized fields), so the client-side feature works against the
-- currently-deployed function too - this migration only adds stricter
-- server-side checks as defense in depth, same rigor already given to
-- receiver_weights_lb.
create or replace function private.assert_workspace_configuration_payload(
  p_configuration_type text,
  p_schema_version integer,
  p_payload jsonb
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_line_type integer;
  v_expected_names text[];
  v_expected_layers integer;
  v_layer jsonb;
  v_hopper jsonb;
  v_index integer;
  v_hopper_index integer;
  v_layer_total numeric := 0;
  v_hopper_total numeric;
  v_secondary_total numeric;
begin
  if p_configuration_type not in ('receiver_weight_profile', 'recipe') then
    raise exception using errcode = '22023', message = 'invalid_configuration_type';
  end if;
  if p_schema_version <> 1 then
    raise exception using errcode = '22023', message = 'unsupported_workspace_configuration_schema_version';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'workspace_configuration_payload_must_be_an_object';
  end if;
  if octet_length(p_payload::text) > 131072 then
    raise exception using errcode = '22023', message = 'workspace_configuration_payload_too_large';
  end if;
  if jsonb_typeof(p_payload->'schema_version') <> 'number'
     or p_payload->>'schema_version' <> '1' then
    raise exception using errcode = '22023', message = 'unsupported_workspace_configuration_payload_schema_version';
  end if;
  if jsonb_typeof(p_payload->'line_type') <> 'number'
     or p_payload->>'line_type' not in ('1', '3', '5') then
    raise exception using errcode = '22023', message = 'invalid_workspace_configuration_line_type';
  end if;
  if jsonb_typeof(p_payload->'hopper_naming_mode') <> 'string'
     or p_payload->>'hopper_naming_mode' not in ('standard', 'main') then
    raise exception using errcode = '22023', message = 'invalid_workspace_configuration_hopper_naming_mode';
  end if;

  v_line_type := (p_payload->>'line_type')::integer;
  v_expected_names := case v_line_type
    when 1 then array['A']
    when 3 then array['A','B','C']
    when 5 then array['A','B','C','D','E']
  end;
  v_expected_layers := array_length(v_expected_names, 1);
  if jsonb_typeof(p_payload->'layers') <> 'array'
     or jsonb_array_length(p_payload->'layers') <> v_expected_layers then
    raise exception using errcode = '22023', message = 'invalid_workspace_configuration_layers';
  end if;

  for v_index in 0..v_expected_layers - 1 loop
    v_layer := p_payload->'layers'->v_index;
    if jsonb_typeof(v_layer) <> 'object'
       or v_layer->>'name' <> v_expected_names[v_index + 1] then
      raise exception using errcode = '22023', message = 'invalid_workspace_configuration_layer_name';
    end if;

    if p_configuration_type = 'receiver_weight_profile' then
      if p_payload ? 'layer_pct' or p_payload ? 'hoppers'
         or v_layer ? 'layer_pct' or v_layer ? 'hoppers'
         or jsonb_typeof(p_payload->'hoppers_per_layer') <> 'number'
         or p_payload->>'hoppers_per_layer' <> '6'
         or jsonb_typeof(v_layer->'receiver_weights_lb') <> 'array'
         or jsonb_array_length(v_layer->'receiver_weights_lb') <> 6 then
        raise exception using errcode = '22023', message = 'invalid_receiver_weight_profile_payload';
      end if;
      for v_hopper_index in 0..5 loop
        if jsonb_typeof(v_layer->'receiver_weights_lb'->v_hopper_index) <> 'number'
           or (v_layer->'receiver_weights_lb'->>v_hopper_index)::numeric < 0 then
          raise exception using errcode = '22023', message = 'invalid_receiver_weight';
        end if;
      end loop;

      if v_layer ? 'usable_heights_in' then
        if jsonb_typeof(v_layer->'usable_heights_in') <> 'array'
           or jsonb_array_length(v_layer->'usable_heights_in') <> 6 then
          raise exception using errcode = '22023', message = 'invalid_hopper_usable_heights';
        end if;
        for v_hopper_index in 0..5 loop
          if jsonb_typeof(v_layer->'usable_heights_in'->v_hopper_index) <> 'number'
             or (v_layer->'usable_heights_in'->>v_hopper_index)::numeric < 0 then
            raise exception using errcode = '22023', message = 'invalid_hopper_usable_height';
          end if;
        end loop;
      end if;
      if v_layer ? 'circumferences_in' then
        if jsonb_typeof(v_layer->'circumferences_in') <> 'array'
           or jsonb_array_length(v_layer->'circumferences_in') <> 6 then
          raise exception using errcode = '22023', message = 'invalid_hopper_circumferences';
        end if;
        for v_hopper_index in 0..5 loop
          if jsonb_typeof(v_layer->'circumferences_in'->v_hopper_index) <> 'number'
             or (v_layer->'circumferences_in'->>v_hopper_index)::numeric < 0 then
            raise exception using errcode = '22023', message = 'invalid_hopper_circumference';
          end if;
        end loop;
      end if;
    else
      if p_payload ? 'hoppers_per_layer'
         or v_layer ? 'receiver_weights_lb'
         or jsonb_typeof(v_layer->'layer_pct') <> 'number'
         or (v_layer->>'layer_pct')::numeric not between 0 and 100
         or jsonb_typeof(v_layer->'hoppers') <> 'array'
         or jsonb_array_length(v_layer->'hoppers') <> 6 then
        raise exception using errcode = '22023', message = 'invalid_recipe_layer';
      end if;
      v_layer_total := v_layer_total + (v_layer->>'layer_pct')::numeric;
      v_hopper_total := 0;
      v_secondary_total := 0;
      for v_hopper_index in 0..5 loop
        v_hopper := v_layer->'hoppers'->v_hopper_index;
        if jsonb_typeof(v_hopper) <> 'object'
           or not (v_hopper ? 'resin_name')
           or jsonb_typeof(v_hopper->'resin_name') not in ('null', 'string')
           or (jsonb_typeof(v_hopper->'resin_name') = 'string' and char_length(v_hopper->>'resin_name') > 100)
           or jsonb_typeof(v_hopper->'pct') <> 'number'
           or (v_hopper->>'pct')::numeric not between 0 and 100 then
          raise exception using errcode = '22023', message = 'invalid_recipe_hopper';
        end if;
        v_hopper_total := v_hopper_total + (v_hopper->>'pct')::numeric;
        if v_hopper_index > 0 then
          v_secondary_total := v_secondary_total + (v_hopper->>'pct')::numeric;
        end if;
      end loop;
      if v_secondary_total > 100.0001
         or abs(v_hopper_total - 100) > 0.0001
         or abs((v_layer->'hoppers'->0->>'pct')::numeric - (100 - v_secondary_total)) > 0.0001 then
        raise exception using errcode = '22023', message = 'invalid_recipe_hopper_percentages';
      end if;
    end if;
  end loop;

  if p_configuration_type = 'recipe' and abs(v_layer_total - 100) > 0.0001 then
    raise exception using errcode = '22023', message = 'invalid_recipe_layer_percentages';
  end if;
end;
$$;

commit;
