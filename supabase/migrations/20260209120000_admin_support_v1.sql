-- Admin: Support (tickets + internal notes + help center CRUD)
--
-- Adds:
--  - support_internal_notes table (agent-only notes)
--  - Admin RPCs for Support Tickets and Help Center content
--
-- Permissions:
--  - support.read   (view tickets + help center content)
--  - support.manage (respond/update/curate content)

BEGIN;

-- ------------------------------------------------------------
-- 1) Admin audit actions (extend enum)
-- ------------------------------------------------------------

ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'support_ticket_assign';
ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'support_ticket_status_update';
ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'support_ticket_reply';
ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'support_ticket_internal_note';
ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'support_section_upsert';
ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'support_article_upsert';

-- ------------------------------------------------------------
-- 2) Admin-only internal notes (separate table; agent-only)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.support_internal_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_support_internal_notes_ticket_id_created_at
  ON public.support_internal_notes(ticket_id, created_at DESC);

ALTER TABLE public.support_internal_notes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='support_internal_notes' AND policyname='support_internal_notes_admin_select'
  ) THEN
    CREATE POLICY support_internal_notes_admin_select
      ON public.support_internal_notes
      FOR SELECT TO authenticated
      USING (public.admin_has_permission('support.read'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='support_internal_notes' AND policyname='support_internal_notes_admin_insert'
  ) THEN
    CREATE POLICY support_internal_notes_admin_insert
      ON public.support_internal_notes
      FOR INSERT TO authenticated
      WITH CHECK (public.admin_has_permission('support.manage') AND author_id = auth.uid());
  END IF;
END $$;

GRANT SELECT, INSERT ON TABLE public.support_internal_notes TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3) Ticket inbox RPCs
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_support_tickets_list_v1(
  p_q text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_priority text DEFAULT NULL,
  p_assigned_to uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  category_code text,
  category_title text,
  subject text,
  status public.support_ticket_status,
  priority public.support_ticket_priority,
  ride_id uuid,
  created_by uuid,
  created_by_name text,
  created_by_phone text,
  assigned_to uuid,
  assigned_to_name text,
  resolved_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  last_message text,
  last_message_at timestamptz,
  messages_count integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  q text := NULLIF(btrim(COALESCE(p_q, '')), '');
  st text := NULLIF(btrim(COALESCE(p_status, '')), '');
  pr text := NULLIF(btrim(COALESCE(p_priority, '')), '');
  lim integer := LEAST(200, GREATEST(1, COALESCE(p_limit, 50)));
  off integer := GREATEST(0, COALESCE(p_offset, 0));
BEGIN
  IF NOT public.admin_has_permission('support.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.category_code,
    c.title AS category_title,
    s.subject,
    s.status,
    s.priority,
    s.ride_id,
    s.created_by,
    p.display_name AS created_by_name,
    p.phone_e164 AS created_by_phone,
    t.assigned_to,
    ap.display_name AS assigned_to_name,
    t.resolved_at,
    s.created_at,
    s.updated_at,
    s.last_message,
    s.last_message_at,
    s.messages_count
  FROM public.support_ticket_summaries s
  JOIN public.support_tickets t ON t.id = s.id
  LEFT JOIN public.support_categories c ON c.code = s.category_code
  LEFT JOIN public.profiles p ON p.id = s.created_by
  LEFT JOIN public.profiles ap ON ap.id = t.assigned_to
  WHERE
    (q IS NULL OR s.subject ILIKE '%' || q || '%'
      OR COALESCE(s.last_message, '') ILIKE '%' || q || '%'
      OR COALESCE(p.display_name, '') ILIKE '%' || q || '%'
      OR COALESCE(p.phone_e164, '') ILIKE '%' || q || '%')
    AND (st IS NULL OR s.status::text = st)
    AND (pr IS NULL OR s.priority::text = pr)
    AND (p_assigned_to IS NULL OR t.assigned_to = p_assigned_to)
  ORDER BY COALESCE(s.last_message_at, s.updated_at) DESC
  OFFSET off
  LIMIT lim;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_support_tickets_list_v1(text, text, text, uuid, integer, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_support_ticket_get_v1(p_ticket_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_ticket public.support_tickets;
  v_cat public.support_categories;
  v_creator public.profiles;
  v_assignee public.profiles;
  v_msgs jsonb;
  v_notes jsonb;
BEGIN
  IF NOT public.admin_has_permission('support.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ticket
  FROM public.support_tickets
  WHERE id = p_ticket_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ticket_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_cat
  FROM public.support_categories
  WHERE code = v_ticket.category_code;

  SELECT * INTO v_creator FROM public.profiles WHERE id = v_ticket.created_by;
  SELECT * INTO v_assignee FROM public.profiles WHERE id = v_ticket.assigned_to;

  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.created_at ASC), '[]'::jsonb)
    INTO v_msgs
  FROM (
    SELECT id, ticket_id, sender_id, message, attachments, created_at
    FROM public.support_messages
    WHERE ticket_id = v_ticket.id
    ORDER BY created_at ASC
  ) m;

  SELECT COALESCE(jsonb_agg(to_jsonb(n) ORDER BY n.created_at DESC), '[]'::jsonb)
    INTO v_notes
  FROM (
    SELECT id, ticket_id, author_id, note, created_at
    FROM public.support_internal_notes
    WHERE ticket_id = v_ticket.id
    ORDER BY created_at DESC
  ) n;

  RETURN jsonb_build_object(
    'ok', true,
    'ticket', to_jsonb(v_ticket),
    'category', CASE WHEN v_cat.code IS NULL THEN NULL ELSE jsonb_build_object('code', v_cat.code, 'title', v_cat.title) END,
    'creator', CASE WHEN v_creator.id IS NULL THEN NULL ELSE jsonb_build_object('id', v_creator.id, 'display_name', v_creator.display_name, 'phone', v_creator.phone_e164) END,
    'assignee', CASE WHEN v_assignee.id IS NULL THEN NULL ELSE jsonb_build_object('id', v_assignee.id, 'display_name', v_assignee.display_name, 'phone', v_assignee.phone_e164) END,
    'messages', v_msgs,
    'internal_notes', v_notes
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_support_ticket_get_v1(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_support_ticket_assign_v1(
  p_ticket_id uuid,
  p_assigned_to uuid DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  actor uuid := auth.uid();
  v_ticket public.support_tickets;
BEGIN
  IF NOT public.admin_has_permission('support.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.support_tickets
  SET assigned_to = p_assigned_to,
      updated_at = now()
  WHERE id = p_ticket_id
  RETURNING * INTO v_ticket;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ticket_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.admin_audit_log(actor_id, action, target_user_id, note, details)
  VALUES (
    actor,
    'support_ticket_assign',
    v_ticket.created_by,
    COALESCE(NULLIF(btrim(p_note), ''), 'Assigned support ticket'),
    jsonb_build_object('ticket_id', v_ticket.id, 'assigned_to', p_assigned_to)
  );

  RETURN jsonb_build_object('ok', true, 'ticket', to_jsonb(v_ticket));
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_support_ticket_assign_v1(uuid, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_support_ticket_set_status_v1(
  p_ticket_id uuid,
  p_status public.support_ticket_status,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  actor uuid := auth.uid();
  v_ticket public.support_tickets;
BEGIN
  IF NOT public.admin_has_permission('support.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.support_tickets
  SET status = p_status,
      resolved_at = CASE WHEN p_status IN ('resolved','closed') THEN now() ELSE NULL END,
      updated_at = now()
  WHERE id = p_ticket_id
  RETURNING * INTO v_ticket;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ticket_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.admin_audit_log(actor_id, action, target_user_id, note, details)
  VALUES (
    actor,
    'support_ticket_status_update',
    v_ticket.created_by,
    COALESCE(NULLIF(btrim(p_note), ''), 'Updated support ticket status'),
    jsonb_build_object('ticket_id', v_ticket.id, 'status', v_ticket.status)
  );

  RETURN jsonb_build_object('ok', true, 'ticket', to_jsonb(v_ticket));
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_support_ticket_set_status_v1(uuid, public.support_ticket_status, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_support_ticket_post_message_v1(
  p_ticket_id uuid,
  p_message text,
  p_attachments jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  actor uuid := auth.uid();
  v_ticket public.support_tickets;
  v_msg public.support_messages;
  msg text := NULLIF(btrim(COALESCE(p_message, '')), '');
BEGIN
  IF NOT public.admin_has_permission('support.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF msg IS NULL THEN
    RAISE EXCEPTION 'missing_message' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ticket_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.support_messages(ticket_id, sender_id, message, attachments)
  VALUES (p_ticket_id, actor, msg, COALESCE(p_attachments, '[]'::jsonb))
  RETURNING * INTO v_msg;

  INSERT INTO public.admin_audit_log(actor_id, action, target_user_id, note, details)
  VALUES (
    actor,
    'support_ticket_reply',
    v_ticket.created_by,
    'Replied to support ticket',
    jsonb_build_object('ticket_id', p_ticket_id, 'message_id', v_msg.id)
  );

  RETURN jsonb_build_object('ok', true, 'message', to_jsonb(v_msg));
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_support_ticket_post_message_v1(uuid, text, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_support_ticket_add_internal_note_v1(
  p_ticket_id uuid,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  actor uuid := auth.uid();
  v_ticket public.support_tickets;
  v_note public.support_internal_notes;
  note text := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  IF NOT public.admin_has_permission('support.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF note IS NULL THEN
    RAISE EXCEPTION 'missing_note' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ticket_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.support_internal_notes(ticket_id, author_id, note)
  VALUES (p_ticket_id, actor, note)
  RETURNING * INTO v_note;

  INSERT INTO public.admin_audit_log(actor_id, action, target_user_id, note, details)
  VALUES (
    actor,
    'support_ticket_internal_note',
    v_ticket.created_by,
    'Added internal note',
    jsonb_build_object('ticket_id', p_ticket_id, 'note_id', v_note.id)
  );

  RETURN jsonb_build_object('ok', true, 'internal_note', to_jsonb(v_note));
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_support_ticket_add_internal_note_v1(uuid, text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4) Help Center content RPCs (sections + articles)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_support_sections_list_v1()
RETURNS TABLE(
  id uuid,
  key text,
  title text,
  sort_order integer,
  enabled boolean,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NOT public.admin_has_permission('support.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT s.id, s.key, s.title, s.sort_order, s.enabled, s.created_at, s.updated_at
  FROM public.support_sections s
  ORDER BY s.sort_order ASC, s.title ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_support_sections_list_v1() TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.admin_support_section_upsert_v1(uuid, text, text, integer, boolean);
CREATE OR REPLACE FUNCTION public.admin_support_section_upsert_v1(
  p_key text,
  p_title text,
  p_sort_order integer DEFAULT 0,
  p_enabled boolean DEFAULT true,
  p_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  actor uuid := auth.uid();
  v_section public.support_sections;
  v_id uuid := COALESCE(p_id, gen_random_uuid());
  k text := NULLIF(btrim(COALESCE(p_key, '')), '');
  t text := NULLIF(btrim(COALESCE(p_title, '')), '');
BEGIN
  IF NOT public.admin_has_permission('support.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF k IS NULL OR t IS NULL THEN
    RAISE EXCEPTION 'invalid_section' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.support_sections(id, key, title, sort_order, enabled)
  VALUES (v_id, k, t, COALESCE(p_sort_order, 0), COALESCE(p_enabled, true))
  ON CONFLICT (id) DO UPDATE
    SET key = EXCLUDED.key,
        title = EXCLUDED.title,
        sort_order = EXCLUDED.sort_order,
        enabled = EXCLUDED.enabled,
        updated_at = now()
  RETURNING * INTO v_section;

  INSERT INTO public.admin_audit_log(actor_id, action, target_user_id, note, details)
  VALUES (
    actor,
    'support_section_upsert',
    actor,
    'Upserted support section',
    jsonb_build_object('section_id', v_section.id, 'key', v_section.key)
  );

  RETURN jsonb_build_object('ok', true, 'section', to_jsonb(v_section));
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_support_section_upsert_v1(text, text, integer, boolean, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_support_articles_list_v1(
  p_q text DEFAULT NULL,
  p_section_id uuid DEFAULT NULL,
  p_enabled boolean DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  section_id uuid,
  section_title text,
  slug text,
  title text,
  summary text,
  enabled boolean,
  tags text[],
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  q text := NULLIF(btrim(COALESCE(p_q, '')), '');
  lim integer := LEAST(200, GREATEST(1, COALESCE(p_limit, 50)));
  off integer := GREATEST(0, COALESCE(p_offset, 0));
BEGIN
  IF NOT public.admin_has_permission('support.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.section_id,
    s.title AS section_title,
    a.slug,
    a.title,
    a.summary,
    a.enabled,
    a.tags,
    a.created_at,
    a.updated_at
  FROM public.support_articles a
  LEFT JOIN public.support_sections s ON s.id = a.section_id
  WHERE
    (q IS NULL OR a.title ILIKE '%' || q || '%' OR a.slug ILIKE '%' || q || '%')
    AND (p_section_id IS NULL OR a.section_id = p_section_id)
    AND (p_enabled IS NULL OR a.enabled = p_enabled)
  ORDER BY a.updated_at DESC
  OFFSET off
  LIMIT lim;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_support_articles_list_v1(text, uuid, boolean, integer, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_support_article_get_v1(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  a public.support_articles;
  s public.support_sections;
BEGIN
  IF NOT public.admin_has_permission('support.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO a FROM public.support_articles WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'article_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO s FROM public.support_sections WHERE id = a.section_id;

  RETURN jsonb_build_object(
    'ok', true,
    'article', to_jsonb(a),
    'section', CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object('id', s.id, 'key', s.key, 'title', s.title) END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_support_article_get_v1(uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.admin_support_article_upsert_v1(uuid, uuid, text, text, text, text, text[], boolean);
CREATE OR REPLACE FUNCTION public.admin_support_article_upsert_v1(
  p_slug text,
  p_title text,
  p_section_id uuid DEFAULT NULL,
  p_summary text DEFAULT NULL,
  p_body_md text DEFAULT '',
  p_tags text[] DEFAULT NULL,
  p_enabled boolean DEFAULT true,
  p_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  actor uuid := auth.uid();
  v_id uuid := COALESCE(p_id, gen_random_uuid());
  v_slug text := lower(regexp_replace(btrim(COALESCE(p_slug, '')), '\\s+', '-', 'g'));
  v_title text := NULLIF(btrim(COALESCE(p_title, '')), '');
  v_article public.support_articles;
BEGIN
  IF NOT public.admin_has_permission('support.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_slug IS NULL OR v_slug = '' OR v_title IS NULL THEN
    RAISE EXCEPTION 'invalid_article' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.support_articles
    WHERE slug = v_slug AND id <> v_id
  ) THEN
    RAISE EXCEPTION 'slug_taken' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.support_articles(id, section_id, slug, title, summary, body_md, tags, enabled)
  VALUES (
    v_id,
    p_section_id,
    v_slug,
    v_title,
    NULLIF(btrim(COALESCE(p_summary, '')), ''),
    COALESCE(p_body_md, ''),
    COALESCE(p_tags, ARRAY[]::text[]),
    COALESCE(p_enabled, true)
  )
  ON CONFLICT (id) DO UPDATE
    SET section_id = EXCLUDED.section_id,
        slug = EXCLUDED.slug,
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        body_md = EXCLUDED.body_md,
        tags = EXCLUDED.tags,
        enabled = EXCLUDED.enabled,
        updated_at = now()
  RETURNING * INTO v_article;

  INSERT INTO public.admin_audit_log(actor_id, action, target_user_id, note, details)
  VALUES (
    actor,
    'support_article_upsert',
    actor,
    'Upserted support article',
    jsonb_build_object('article_id', v_article.id, 'slug', v_article.slug, 'enabled', v_article.enabled)
  );

  RETURN jsonb_build_object('ok', true, 'article', to_jsonb(v_article));
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_support_article_upsert_v1(text, text, uuid, text, text, text[], boolean, uuid) TO authenticated, service_role;

COMMIT;
