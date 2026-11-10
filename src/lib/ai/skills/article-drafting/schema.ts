import { z } from 'zod'

/**
 * One block inside a section. Flat rather than a union so every provider's
 * structured output accepts it: `text` for paragraph, subheading and quote,
 * `items` for the two list kinds.
 */
export const ArticleSectionBlockSchema = z.object({
  type: z
    .enum(['paragraph', 'subheading', 'bullets', 'numbered', 'quote'])
    .describe(
      'paragraph: 2-5 sentences of prose. subheading: a short subheading inside the section. bullets / numbered: a list, only where the content really is a list or steps. quote: a short quotation taken word for word from the evidence, with its source named in the next paragraph.'
    ),
  text: z
    .string()
    .optional()
    .describe(
      'For paragraph, subheading and quote. Plain text; **bold** sparingly for one key phrase; links only as [text](https://url) and only to URLs given in the brief.'
    ),
  items: z
    .array(z.string())
    .optional()
    .describe('For bullets and numbered: 3-7 items, each one complete line.')
})

export const ArticleGenerationSchema = z.object({
  title: z
    .string()
    .describe(
      'The article headline: specific, concrete, at most 100 characters, no clickbait, no colon-subtitle'
    ),
  subtitle: z
    .string()
    .describe(
      'One or two sentences under the title saying what the reader will get from the article; at most 250 characters'
    ),
  introduction: z
    .array(z.string())
    .describe(
      '2-3 paragraphs that open on one concrete thing and set up the argument; no definition of the topic'
    ),
  sections: z
    .array(
      z.object({
        heading: z
          .string()
          .describe(
            'The section heading: says what the section argues, in plain words'
          ),
        blocks: z
          .array(ArticleSectionBlockSchema)
          .describe(
            'Mostly paragraphs: 3-5 of them (about 200-350 words in the section), with a list, quote or subheading only where it helps'
          )
      })
    )
    .describe(
      '3 to 6 sections, each making one distinct point in the argument, with transitions between them'
    ),
  conclusionHeading: z
    .string()
    .describe(
      'Heading over the closing section; not the word "Conclusion" on its own'
    ),
  conclusion: z
    .array(z.string())
    .describe(
      '1-2 paragraphs that land the main point and add something new; never a summary of the sections'
    ),
  callToAction: z
    .string()
    .describe(
      'One closing line asking the reader to act or reflect, following from the article; an empty string when none fits'
    ),
  coverImage: z
    .object({
      concept: z
        .string()
        .describe(
          'A cover image concept for a 16:9 banner: the subject, composition and mood, matching the article and brand; no words in the image'
        ),
      altText: z.string().describe('Alt text describing that image')
    })
    .describe('A suggested cover image'),
  promoPost: z
    .string()
    .describe(
      'A short feed post (at most 600 characters, plain text, no hashtags, no link) in the author voice that makes a reader want to open the article'
    ),
  sourcesUsed: z
    .array(z.string())
    .default([])
    .describe(
      'The ids of the evidence and knowledge items the article relies on, e.g. ["E1", "K2"]'
    ),
  selfFlags: z
    .array(z.string())
    .default([])
    .describe('Any weakness or caveat the reviewer should check')
})

export type ArticleGenerationResult = z.infer<typeof ArticleGenerationSchema>
export type ArticleSectionBlock = z.infer<typeof ArticleSectionBlockSchema>
