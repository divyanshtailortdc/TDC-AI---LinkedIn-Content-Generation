-- Banned words now live only in Voice. Append any word an account listed under
-- Preferences that its voice list lacks (case-insensitive), so nothing the
-- account asked to avoid drops out of the prompt. Additive: nothing is removed,
-- and preferences.guardrails keeps its copy until the deferred cleanup.
UPDATE "voice_configs" v
SET "banned_words" = COALESCE(v."banned_words", '[]'::jsonb) || COALESCE((
  SELECT jsonb_agg(pw)
  FROM jsonb_array_elements_text(p."guardrails"->'banned_words') AS pw
  WHERE lower(trim(pw)) NOT IN (
    SELECT lower(trim(vw))
    FROM jsonb_array_elements_text(COALESCE(v."banned_words", '[]'::jsonb)) AS vw
  )
), '[]'::jsonb)
FROM "preferences" p
WHERE p."account_id" = v."account_id"
  AND jsonb_typeof(p."guardrails"->'banned_words') = 'array'
  AND (v."banned_words" IS NULL OR jsonb_typeof(v."banned_words") = 'array');
