import { relations } from 'drizzle-orm'
import { draftsTable, ideasTable, mediaAssetsTable } from './schema'

export const ideasRelations = relations(ideasTable, ({ many }) => ({
  drafts: many(draftsTable)
}))

export const draftsRelations = relations(draftsTable, ({ one, many }) => ({
  idea: one(ideasTable, {
    fields: [draftsTable.ideaId],
    references: [ideasTable.id]
  }),
  mediaAssets: many(mediaAssetsTable)
}))

export const mediaAssetsRelations = relations(mediaAssetsTable, ({ one }) => ({
  draft: one(draftsTable, {
    fields: [mediaAssetsTable.draftId],
    references: [draftsTable.id]
  })
}))
