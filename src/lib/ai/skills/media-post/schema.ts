import { z } from 'zod'

/**
 * What the model returns for uploaded media: first what it sees, then what
 * the media is for (its message), then one post per platform written from
 * that. Looking and understanding come first in the schema so the posts are
 * written after them, and rest on them: a post written straight from the
 * frames retold a product video caption by caption instead of saying what
 * it means for the reader.
 *
 * No length or count constraints here: the structured-output mode refuses
 * some of them, and the guard enforces the platform's own limits instead.
 */

/** How much a feature carries the media's message (see MediaFeatureSchema). */
export const FEATURE_PRIORITIES = ['lead', 'supporting', 'minor'] as const
export type FeaturePriority = (typeof FEATURE_PRIORITIES)[number]

/**
 * One capability a product or explainer video demonstrates. A post written
 * from the main message alone ("keep customers on your brand") left out what
 * the video showed of it (the mobile preview, the brand settings, the
 * marketing tab), so each is listed, with what it does for the business, and
 * the posts with room are checked for them (./quality).
 *
 * Held to all of them equally, the next posts read like a manual: a bullet
 * per feature, every control named. So each is now ranked (the lead
 * demonstrations carry the post, supporting ones get a clause, minor ones
 * stay out) and grouped by the outcome it serves, and it names the frames
 * it is in, so one no frame shows is dropped (./quality verifiedAnalysis).
 */
export const MediaFeatureSchema = z.object({
  name: z
    .string()
    .describe(
      'The capability in a few plain words, as a reader would name it (mobile preview, brand styling, discount banners). One capability, not one control: brand colours, fonts, logo and button shape are one feature, brand styling, with the controls in "shown". Never a sample name from the demo.'
    ),
  frames: z
    .array(z.number())
    .describe(
      "The numbers of the frames it can be seen in (frame 1 is the first attached; an image is frame 1). Empty only when it comes from the author's notes alone. A capability no frame shows is not a feature: leave it out."
    ),
  shown: z
    .string()
    .describe(
      'What the media shows of it, in one short sentence: the caption or on-screen text that names it, the controls or settings that make it up, the action and its result.'
    ),
  benefit: z
    .string()
    .describe(
      'Why it matters to the audience, in their business: what it lets them do, or stop worrying about, as a plain outcome that what is shown supports. No figures unless visible or in the notes.'
    ),
  priority: z
    .enum(FEATURE_PRIORITIES)
    .describe(
      'lead: one of the one to three demonstrations that carry the main message (a title card or caption of its own and the most screen time, or the end result shown). supporting: shown on purpose, but secondary to the lead ones. minor: glimpsed in passing, a single setting, or there only to make another feature work; never a feature a caption or title card names.'
    ),
  group: z
    .string()
    .describe(
      'The outcome for the audience it serves, in two to five plain words (looks like your own store, sells while they wait). Features serving the same outcome share it, written exactly the same way; most media has two to four groups.'
    ),
  terms: z
    .array(z.string())
    .describe(
      'Two to four lower-case words a post naming this feature would use, the plain word first (for a mobile preview: "mobile", "phone"). Single words, no phrases.'
    )
})

/** What the media is for, worked out before any post is written. */
export const MediaMessageSchema = z.object({
  kind: z
    .enum(['product', 'explainer', 'moment', 'announcement', 'other'])
    .describe(
      'product: a product, service or tool shown, demonstrated or promoted (a demo, walkthrough, launch or promo video, a product shot). explainer: a how-to, a tip or an idea explained. moment: an event, a place, people, behind the scenes, a story. announcement: news, hiring, a milestone. other: none of these.'
    ),
  subject: z
    .string()
    .describe(
      'What it is about in a few words: the product, service, idea or occasion, named only as the media or the notes name it.'
    ),
  problem: z
    .string()
    .describe(
      'The problem, frustration or need it addresses, as the media (captions, title cards, what the demo fixes) or the notes put it. Empty when it addresses none.'
    ),
  audience: z
    .string()
    .describe(
      "Who has that problem or would care: a role or a kind of business, from the media, the notes or the author's details. Empty when it cannot be told."
    ),
  value: z
    .string()
    .describe(
      'The main message: what changes for that audience, in one sentence. The outcome, not a feature. Empty when it cannot be told.'
    ),
  features: z
    .array(MediaFeatureSchema)
    .describe(
      'Every capability the media demonstrates or names, one per item, in the order it appears, including those on screen only briefly, each checked against the frames it is in. Empty for media that shows no product, service or method.'
    ),
  scaffolding: z
    .array(z.string())
    .describe(
      'Names and data that only make a demo work: a sample company, store or person, test orders, sample addresses, tracking numbers, sample products, prices, discount amounts and codes, placeholder text. Exactly as written in the media. Posts never name or quote these.'
    )
})

export const MediaAnalysisSchema = z.object({
  summary: z
    .string()
    .describe(
      'One or two plain sentences: what the image or video shows, as seen.'
    ),
  details: z
    .array(z.string())
    .describe(
      'Concrete things that can be seen (people and what they do, objects, setting, colours, actions, what changes across the frames), one per item, each a short phrase of a few words; at most ten. Do not quote on-screen text here (it goes in visibleText) or walk through the features (they go in message.features).'
    ),
  visibleText: z
    .array(z.string())
    .describe(
      'Words readable in the media, exactly as written. Empty when there are none.'
    ),
  mood: z.string().describe('The feel of the media in a few words.'),
  uncertain: z
    .array(z.string())
    .describe(
      'What cannot be told from the media alone (who someone is, where or when it is, what is said), so the posts do not claim it.'
    ),
  message: MediaMessageSchema.describe(
    'What the media is for, worked out from all of the above, the notes and the author\'s details, before any post is written.'
  )
})

export const MediaPostItemSchema = z.object({
  platform: z
    .string()
    .describe('The platform id, exactly as listed in the request.'),
  angle: z
    .string()
    .describe(
      "Written before the post, never posted: this post's main message in a sentence (the reader's problem or what changes for them), then the groups it covers, strongest first, with the lead demonstration of each."
    ),
  hook: z.string().describe('The opening line(s) that stop the scroll.'),
  body: z
    .string()
    .describe('The rest of the caption, after the hook. May be empty.'),
  cta: z
    .string()
    .describe('The call to action. Empty when none follows naturally.'),
  hashtags: z
    .array(z.string())
    .describe(
      'One hashtag per item, without the # sign and without spaces (OrderTracking, Ecommerce), never several in one item.'
    ),
  firstComment: z
    .string()
    .describe(
      "The platform's comment field as described for it; empty when it needs none."
    ),
  title: z
    .string()
    .describe('The video title, for YouTube only; empty everywhere else.'),
  altText: z
    .string()
    .describe(
      'For an image: a plain description for screen readers. Empty for a video.'
    )
})

export const MediaPostSchema = z.object({
  analysis: MediaAnalysisSchema,
  posts: z.array(MediaPostItemSchema)
})

export type MediaFeature = z.infer<typeof MediaFeatureSchema>
export type MediaMessage = z.infer<typeof MediaMessageSchema>
export type MediaAnalysis = z.infer<typeof MediaAnalysisSchema>
export type MediaPostItem = z.infer<typeof MediaPostItemSchema>
export type MediaPostOutput = z.infer<typeof MediaPostSchema>

/**
 * A request to rewrite posts that failed their checks: over their
 * platform's limit, or written in a way the checks catch (see ./quality).
 */
export const FixSchema = z.object({
  posts: z.array(MediaPostItemSchema)
})
