CREATE INDEX "post_drafts_account_created_idx" ON "post_drafts" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "post_drafts_idea_idx" ON "post_drafts" USING btree ("idea_id");--> statement-breakpoint
CREATE INDEX "goals_account_idx" ON "goals" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ideas_account_created_idx" ON "ideas" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "ideas_run_idx" ON "ideas" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "knowledge_documents_account_idx" ON "knowledge_documents" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "post_citations_draft_idx" ON "post_citations" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "post_media_draft_status_idx" ON "post_media" USING btree ("draft_id","status");--> statement-breakpoint
CREATE INDEX "post_variants_draft_idx" ON "post_variants" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "research_findings_run_idx" ON "research_findings" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "run_steps_run_idx" ON "run_steps" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "runs_account_created_idx" ON "runs" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "runs_status_created_idx" ON "runs" USING btree ("status","created_at");