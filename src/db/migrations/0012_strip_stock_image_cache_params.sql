-- Stock image URLs used to be saved with "v=<ms timestamp>&attempt=<n>"
-- appended, which many image hosts answer with a 404. Strip that suffix so
-- the provider's own URL is left; the version and attempt are columns already.
UPDATE "post_media"
SET "image_url" = regexp_replace("image_url", '[?&]v=[0-9]{13}&attempt=[0-9]+$', '')
WHERE "image_url" NOT LIKE 'data:%'
  AND "image_url" ~ '[?&]v=[0-9]{13}&attempt=[0-9]+$';
