import 'server-only'

import type { Idea } from '@/db/schema'
import { isPictureStyle, type ImageStyle } from '@/lib/brand/theme'
import {
  lookDesign,
  PICTURE_LAYOUTS,
  type SlideContent
} from '@/lib/carousel/types'
import {
  carouselSpecOf,
  FORMATS,
  slideCountRange,
  type FormatId
} from '@/lib/formats'
import { forFormat } from '../../channel-context'
import type { GenerationContext } from '../../context'
import { runSkill, SkillError } from '../../run-skill'
import type { CallUsage } from '../../usage'
import { collectFigureSources } from '../post-drafting/guard'
import { slideFactIssues } from '@/lib/carousel/checks'
import {
  carouselFactIssues,
  carouselIssues,
  IncompleteCarouselError,
  toCarousel,
  toSlide
} from './guard'
import {
  buildSlidePrompt,
  buildSlidesInstructions,
  buildSlidesPrompt
} from './prompt'
import { OneSlideOutputSchema, SlidesOutputSchema } from './schema'

/** A carousel is one call, a little longer than a post. */
const SLIDES_TIMEOUT_MS = 150_000

export interface WrittenSlides {
  slides: SlideContent[]
  /** What the reviewer should know: slides that repeat the caption. */
  issues: string[]
  /** Each slide's figures and quote that no source states, in slide order. */
  factIssues: string[][]
  usage: CallUsage
  modelId: string
}

/**
 * Skill: an idea, its caption and its platform in; the carousel's slides
 * out, each with its words, design and picture prompt. The caption is given
 * so the slides carry the points and leave the context to it. Throws
 * SkillError on failure; its usage is what the attempt cost.
 */
export async function writeSlides(input: {
  ctx: GenerationContext
  idea: Idea
  formatId: FormatId
  caption: string
  imageStyle: ImageStyle
  /** What the reviewer wants, when the carousel is written again. */
  instruction?: string | null
  /**
   * Every slide is made like the author's own posts (src/lib/carousel/
   * look.ts): words written for that, and no drawn layouts or pictures.
   */
  likeTheirPosts?: boolean
}): Promise<WrittenSlides> {
  const spec = carouselSpecOf(input.formatId)
  if (!spec) {
    throw new SkillError(
      `A ${FORMATS[input.formatId].label} takes no carousel.`,
      'failed'
    )
  }
  const ctx = forFormat(input.ctx, input.formatId)
  const count = slideCountRange(input.formatId)
  const { output, usage, modelId } = await runSkill({
    stage: 'drafting',
    instructions: buildSlidesInstructions(
      ctx,
      input.imageStyle,
      input.likeTheirPosts
    ),
    cacheInstructions: true,
    prompt: buildSlidesPrompt(
      ctx,
      input.idea,
      input.formatId,
      input.caption,
      count,
      input.instruction
    ),
    schema: SlidesOutputSchema,
    timeoutMs: SLIDES_TIMEOUT_MS,
    maxRetries: 1
  })

  try {
    const figureSources = collectFigureSources(ctx, input.idea)
    const slides = toCarousel(output?.slides ?? [], {
      maxSlides: spec.maxSlides,
      pictures: !input.likeTheirPosts && isPictureStyle(input.imageStyle),
      figureSources
    })
    if (input.likeTheirPosts) {
      for (const slide of slides) slide.design = lookDesign(slide.role)
    }
    return {
      slides,
      issues: carouselIssues(input.caption, slides),
      factIssues: carouselFactIssues(slides, figureSources),
      usage,
      modelId
    }
  } catch (err) {
    if (err instanceof IncompleteCarouselError) {
      throw new SkillError(err.message, 'failed', { usage })
    }
    throw err
  }
}

/**
 * Skill: one slide of a carousel written again, with what the reviewer
 * wants changed, the rest of the carousel shown so it still fits between
 * its neighbours. Keeps the slide's role.
 */
export async function rewriteSlide(input: {
  ctx: GenerationContext
  idea: Idea
  formatId: FormatId
  caption: string
  slides: SlideContent[]
  /** 0-based. */
  index: number
  instruction: string | null
  imageStyle: ImageStyle
  /** The carousel is made like the author's own posts (see writeSlides). */
  likeTheirPosts?: boolean
}): Promise<{
  slide: SlideContent
  /** Its figures and quote that no source states. */
  factIssues: string[]
  usage: CallUsage
  modelId: string
}> {
  const ctx = forFormat(input.ctx, input.formatId)
  const current = input.slides[input.index]
  if (!current) throw new SkillError('That slide no longer exists.', 'failed')
  const { output, usage, modelId } = await runSkill({
    stage: 'drafting',
    instructions: buildSlidesInstructions(
      ctx,
      input.imageStyle,
      input.likeTheirPosts
    ),
    cacheInstructions: true,
    prompt: buildSlidePrompt(
      ctx,
      input.idea,
      input.formatId,
      input.caption,
      input.slides,
      input.index,
      input.instruction,
      input.likeTheirPosts
    ),
    schema: OneSlideOutputSchema,
    timeoutMs: SLIDES_TIMEOUT_MS,
    maxRetries: 1
  })
  const figureSources = collectFigureSources(ctx, input.idea)
  const slide = toSlide(output?.slide, current.role, {
    // A rewritten slide keeps the picture it had or did not have; the
    // reviewer adds or removes one separately.
    pictures: isPictureStyle(input.imageStyle),
    figureSources
  })
  if (!slide.headline) {
    throw new SkillError('The model returned an empty slide.', 'failed', {
      usage
    })
  }
  if (input.likeTheirPosts) {
    slide.design = lookDesign(slide.role)
  } else {
    // Kept as it was where the new layout shows a picture: a rewrite never
    // adds a picture (an image-model call) the reviewer did not ask for.
    slide.design.picture =
      current.design.picture === true &&
      PICTURE_LAYOUTS.includes(slide.design.layout)
  }
  return {
    slide,
    factIssues: slideFactIssues(slide, figureSources),
    usage,
    modelId
  }
}
