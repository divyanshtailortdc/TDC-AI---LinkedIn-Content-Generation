import { relations } from 'drizzle-orm'
import {
  accountsTable,
  audiencesTable,
  documentChunksTable,
  goalsTable,
  ideasTable,
  knowledgeDocumentsTable,
  offeringsTable,
  postDraftsTable,
  preferencesTable,
  runsTable,
  samplePostsTable,
  voiceConfigsTable
} from './schema'

export const accountsRelations = relations(accountsTable, ({ one, many }) => ({
  voiceConfig: one(voiceConfigsTable),
  preferences: one(preferencesTable),
  offerings: many(offeringsTable),
  samplePosts: many(samplePostsTable),
  audiences: many(audiencesTable),
  knowledgeDocuments: many(knowledgeDocumentsTable),
  documentChunks: many(documentChunksTable),
  goals: many(goalsTable),
  runs: many(runsTable),
  ideas: many(ideasTable),
  postDrafts: many(postDraftsTable)
}))

export const voiceConfigsRelations = relations(voiceConfigsTable, ({ one }) => ({
  account: one(accountsTable, {
    fields: [voiceConfigsTable.accountId],
    references: [accountsTable.id]
  })
}))

export const offeringsRelations = relations(offeringsTable, ({ one, many }) => ({
  account: one(accountsTable, {
    fields: [offeringsTable.accountId],
    references: [accountsTable.id]
  }),
  ideas: many(ideasTable),
  postDrafts: many(postDraftsTable)
}))

export const samplePostsRelations = relations(samplePostsTable, ({ one }) => ({
  account: one(accountsTable, {
    fields: [samplePostsTable.accountId],
    references: [accountsTable.id]
  })
}))

export const audiencesRelations = relations(audiencesTable, ({ one }) => ({
  account: one(accountsTable, {
    fields: [audiencesTable.accountId],
    references: [accountsTable.id]
  })
}))

export const knowledgeDocumentsRelations = relations(
  knowledgeDocumentsTable,
  ({ one, many }) => ({
    account: one(accountsTable, {
      fields: [knowledgeDocumentsTable.accountId],
      references: [accountsTable.id]
    }),
    chunks: many(documentChunksTable)
  })
)

export const documentChunksRelations = relations(documentChunksTable, ({ one }) => ({
  document: one(knowledgeDocumentsTable, {
    fields: [documentChunksTable.documentId],
    references: [knowledgeDocumentsTable.id]
  }),
  account: one(accountsTable, {
    fields: [documentChunksTable.accountId],
    references: [accountsTable.id]
  })
}))

export const goalsRelations = relations(goalsTable, ({ one, many }) => ({
  account: one(accountsTable, {
    fields: [goalsTable.accountId],
    references: [accountsTable.id]
  }),
  runs: many(runsTable)
}))

export const preferencesRelations = relations(preferencesTable, ({ one }) => ({
  account: one(accountsTable, {
    fields: [preferencesTable.accountId],
    references: [accountsTable.id]
  })
}))

export const runsRelations = relations(runsTable, ({ one, many }) => ({
  account: one(accountsTable, {
    fields: [runsTable.accountId],
    references: [accountsTable.id]
  }),
  goal: one(goalsTable, {
    fields: [runsTable.goalId],
    references: [goalsTable.id]
  }),
  ideas: many(ideasTable)
}))

export const ideasRelations = relations(ideasTable, ({ one, many }) => ({
  account: one(accountsTable, {
    fields: [ideasTable.accountId],
    references: [accountsTable.id]
  }),
  run: one(runsTable, {
    fields: [ideasTable.runId],
    references: [runsTable.id]
  }),
  offering: one(offeringsTable, {
    fields: [ideasTable.offeringId],
    references: [offeringsTable.id]
  }),
  postDrafts: many(postDraftsTable)
}))

export const postDraftsRelations = relations(postDraftsTable, ({ one }) => ({
  account: one(accountsTable, {
    fields: [postDraftsTable.accountId],
    references: [accountsTable.id]
  }),
  idea: one(ideasTable, {
    fields: [postDraftsTable.ideaId],
    references: [ideasTable.id]
  }),
  offering: one(offeringsTable, {
    fields: [postDraftsTable.offeringId],
    references: [offeringsTable.id]
  })
}))
