-- LinkedIn publishes through Buffer since 2026-11-16 (docs/BUFFER_OAUTH.md);
-- the direct LinkedIn publishing connection is gone. Each direct LinkedIn
-- connection is disconnected as the app's Disconnect would do it: its tokens
-- are deleted, auto-publishing is off, and the LinkedIn posts waiting to go
-- out through it (scheduled, or claimed but not sent yet) are cancelled with a
-- message saying why. Published posts and their history stay. The user picks
-- their LinkedIn account on the Buffer card to publish again. Idempotent: a
-- second run finds nothing left to change.
UPDATE "linkedin_publications" SET
	"status" = 'cancelled',
	"locked_at" = NULL,
	"error" = 'Cancelled because LinkedIn now publishes through Buffer. Choose your LinkedIn account on the Buffer card in Settings, then schedule it again.',
	"error_code" = 'not_connected',
	"updated_at" = now()
WHERE "platform" = 'linkedin'
	AND ("status" = 'scheduled' OR ("status" = 'publishing' AND NOT ("metadata" ? 'postRequestedAt')))
	AND "account_id" IN (
		SELECT "account_id" FROM "linkedin_connections"
		WHERE "platform" = 'linkedin' AND "buffer_connection_id" IS NULL AND "status" <> 'disconnected'
	);
--> statement-breakpoint
UPDATE "linkedin_connections" SET
	"status" = 'disconnected',
	"access_token" = NULL,
	"access_token_expires_at" = NULL,
	"refresh_token" = NULL,
	"refresh_token_expires_at" = NULL,
	"auto_publish" = false,
	"auto_publish_enabled_at" = NULL,
	"last_error" = NULL,
	"updated_at" = now()
WHERE "platform" = 'linkedin' AND "buffer_connection_id" IS NULL AND "status" <> 'disconnected';
