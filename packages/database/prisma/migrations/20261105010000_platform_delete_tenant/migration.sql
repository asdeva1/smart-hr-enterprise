-- ---------------------------------------------------------------------------------------------------------
-- Permanently deleting an organisation. Platform operators only (the function refuses anyone else), and the
-- API asks for the operator's password and the organisation's address before it calls this.
--
-- Rows are removed table by table, children before parents, found from the foreign keys at the time of the
-- call, so a table added later is covered without changing this function. The audit log is append-only and is
-- left alone. Triggers that guard posted journals, payslips and time entries against deletion are switched off
-- for the duration of this one transaction only; if anything fails, the whole deletion rolls back.
--
-- With p_delete_accounts, sign-in accounts that belonged to this organisation alone are removed too (never a
-- platform operator, never someone who also belongs to another organisation), so the same email address can
-- sign up again.
-- ---------------------------------------------------------------------------------------------------------
CREATE FUNCTION platform_delete_tenant(p_tenant uuid, p_delete_accounts boolean DEFAULT false)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
DECLARE
    v_tables text[];
    v_remaining text[];
    v_next text;
    v_count bigint;
    v_counts jsonb := '{}'::jsonb;
    v_members uuid[];
    v_accounts bigint := 0;
    v_self record;
    v_guarded text[] := ARRAY['journal_line', 'payslip', 'time_entry'];
    v_table text;
BEGIN
    IF NOT app_is_platform_actor() THEN
        RAISE EXCEPTION 'Only a platform operator can delete an organisation' USING ERRCODE = '42501';
    END IF;
    PERFORM 1 FROM tenant WHERE id = p_tenant FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Organisation not found' USING ERRCODE = 'P0002';
    END IF;

    SELECT coalesce(array_agg(user_id), '{}') INTO v_members FROM tenant_membership WHERE tenant_id = p_tenant;

    -- Every table that holds organisation data, except the append-only audit log.
    SELECT array_agg(c.table_name::text ORDER BY c.table_name) INTO v_tables
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND c.table_name <> 'audit_event';

    -- A table that points at itself (managers, parent departments) is cleared of those links first.
    FOR v_self IN
        SELECT c.conrelid::regclass::text AS tbl,
               (SELECT string_agg(format('%I = NULL', a.attname), ', ')
                  FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
                   AND a.attname <> 'tenant_id') AS sets
        FROM pg_constraint c
        WHERE c.contype = 'f' AND c.conrelid = c.confrelid
          AND c.conrelid::regclass::text = ANY (v_tables)
    LOOP
        IF v_self.sets IS NOT NULL THEN
            EXECUTE format('UPDATE %s SET %s WHERE tenant_id = $1', v_self.tbl, v_self.sets) USING p_tenant;
        END IF;
    END LOOP;

    FOREACH v_table IN ARRAY v_guarded LOOP
        EXECUTE format('ALTER TABLE %I DISABLE TRIGGER USER', v_table);
    END LOOP;

    v_remaining := v_tables;
    WHILE coalesce(array_length(v_remaining, 1), 0) > 0 LOOP
        -- A table can go once no table still waiting refers to it.
        SELECT r INTO v_next
        FROM unnest(v_remaining) AS r
        WHERE NOT EXISTS (
            SELECT 1 FROM pg_constraint c
            WHERE c.contype = 'f'
              AND c.confrelid = ('public.' || quote_ident(r))::regclass
              AND c.conrelid <> c.confrelid
              AND c.conrelid::regclass::text = ANY (v_remaining)
        )
        ORDER BY r
        LIMIT 1;
        IF v_next IS NULL THEN
            RAISE EXCEPTION 'Cannot order the deletion: tables refer to each other (%)', v_remaining;
        END IF;
        EXECUTE format('DELETE FROM %I WHERE tenant_id = $1', v_next) USING p_tenant;
        GET DIAGNOSTICS v_count = ROW_COUNT;
        IF v_count > 0 THEN
            v_counts := v_counts || jsonb_build_object(v_next, v_count);
        END IF;
        v_remaining := array_remove(v_remaining, v_next);
    END LOOP;

    FOREACH v_table IN ARRAY v_guarded LOOP
        EXECUTE format('ALTER TABLE %I ENABLE TRIGGER USER', v_table);
    END LOOP;

    UPDATE user_session SET active_tenant_id = NULL WHERE active_tenant_id = p_tenant;
    DELETE FROM tenant WHERE id = p_tenant;

    IF p_delete_accounts THEN
        DELETE FROM app_user u
        WHERE u.id = ANY (v_members)
          AND NOT u.is_platform_admin
          AND NOT EXISTS (SELECT 1 FROM tenant_membership m WHERE m.user_id = u.id);
        GET DIAGNOSTICS v_accounts = ROW_COUNT;
    END IF;

    RETURN jsonb_build_object('tables', v_counts, 'accountsDeleted', v_accounts);
END
$$;

REVOKE ALL ON FUNCTION platform_delete_tenant(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_delete_tenant(uuid, boolean) TO app_rw;
