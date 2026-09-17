import { relations } from 'drizzle-orm'
import {
  accountsTable,
  audiencesTable,
  documentChunksTable,
  feedbackTable,
  goalsTable,
  ideasTable,
  knowledgeDocumentsTable,
  offeringsTable,
  postCitationsTable,
  postDraftsTable,
  postMediaTable,
  postVariantsTable,
  preferencesTable,
  researchFindingsTable,
  runStepsTable,
  runsTable,
  samplePostsTable,
  schedulesTable,
  voiceConfigsTable
} from './schema'

export const accountsRelations = relations(accountsTable, ({ one, many }) => ({
  voiceConfig: one(voiceConfigsTable),
  preferences: one(preferencesTable),
  schedule: one(schedulesTable),
  offerings: many(offeringsTable),
  samplePosts: many(samplePostsTable),
  audiences: many(audiencesTable),
  knowledgeDocuments: many(knowledgeDocumentsTable),
  goals: many(goalsTable),
  runs: many(runsTable),
  ideas: many(ideasTable),
  postDrafts: many(postDraftsTable),
  feedback: many(feedbackTable)
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

export const documentChunksRelations = relations(
  documentChunksTable,
  ({ one }) => ({
    document: one(knowledgeDocumentsTable, {
      fields: [documentChunksTable.documentId],
      references: [knowledgeDocumentsTable.id]
    }),
    account: one(accountsTable, {
      fields: [documentChunksTable.accountId],
      references: [accountsTable.id]
    })
  })
)

export const goalsRelations = relations(goalsTable, ({ one, many }) => ({
  account: one(accountsTable, {
    fields: [goalsTable.accountId],
    references: [accountsTable.id]
  }),
  runs: many(runsTable),
  ideas: many(ideasTable)
}))

export const preferencesRelations = relations(preferencesTable, ({ one, many }) => ({
  account: one(accountsTable, {
    fields: [preferencesTable.accountId],
    references: [accountsTable.id]
  }),
  runs: many(runsTable)
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
  preferenceSet: one(preferencesTable, {
    fields: [runsTable.preferenceSetId],
    references: [preferencesTable.id]
  }),
  steps: many(runStepsTable),
  findings: many(researchFindingsTable),
  ideas: many(ideasTable)
}))

export const runStepsRelations = relations(runStepsTable, ({ one }) => ({
  run: one(runsTable, {
    fields: [runStepsTable.runId],
    references: [runsTable.id]
  })
}))

export const researchFindingsRelations = relations(
  researchFindingsTable,
  ({ one }) => ({
    run: one(runsTable, {
      fields: [researchFindingsTable.runId],
      references: [runsTable.id]
    })
  })
)

export const ideasRelations = relations(ideasTable, ({ one, many }) => ({
  account: one(accountsTable, {
    fields: [ideasTable.accountId],
    references: [accountsTable.id]
  }),
  run: one(runsTable, {
    fields: [ideasTable.runId],
    references: [runsTable.id]
  }),
  goal: one(goalsTable, {
    fields: [ideasTable.goalId],
    references: [goalsTable.id]
  }),
  offering: one(offeringsTable, {
    fields: [ideasTable.offeringId],
    references: [offeringsTable.id]
  }),
  postDrafts: many(postDraftsTable)
}))

export const postDraftsRelations = relations(postDraftsTable, ({ one, many }) => ({
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
  }),
  variants: many(postVariantsTable),
  citations: many(postCitationsTable),
  media: one(postMediaTable),
  feedback: many(feedbackTable)
}))

export const postVariantsRelations = relations(postVariantsTable, ({ one }) => ({
  draft: one(postDraftsTable, {
    fields: [postVariantsTable.draftId],
    references: [postDraftsTable.id]
  })
}))

export const postCitationsRelations = relations(postCitationsTable, ({ one }) => ({
  draft: one(postDraftsTable, {
    fields: [postCitationsTable.draftId],
    references: [postDraftsTable.id]
  })
}))

export const postMediaRelations = relations(postMediaTable, ({ one }) => ({
  draft: one(postDraftsTable, {
    fields: [postMediaTable.draftId],
    references: [postDraftsTable.id]
  })
}))

export const schedulesRelations = relations(schedulesTable, ({ one }) => ({
  account: one(accountsTable, {
    fields: [schedulesTable.accountId],
    references: [accountsTable.id]
  }),
  preference: one(preferencesTable, {
    fields: [schedulesTable.preferenceId],
    references: [preferencesTable.id]
  })
}))

export const feedbackRelations = relations(feedbackTable, ({ one }) => ({
  account: one(accountsTable, {
    fields: [feedbackTable.accountId],
    references: [accountsTable.id]
  }),
  draft: one(postDraftsTable, {
    fields: [feedbackTable.draftId],
    references: [postDraftsTable.id]
  })
}))
