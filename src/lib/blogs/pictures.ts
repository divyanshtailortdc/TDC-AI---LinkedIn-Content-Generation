import {
  docSections,
  type BlogBlock,
  type BlogDoc,
  type BlogImageNode
} from './doc'
import { normalizeQuestion } from './questions'

/**
 * Where section pictures go in a document: new ones into the sections the
 * plan chose, old ones carried into a regenerated piece, a section's own
 * picture kept through a rewrite, and pictures the blog does not have left
 * out. Pure.
 *
 * A picture sits after the section's opening answer (and the paragraph
 * after it, when there is one), so the answer stays right under the heading
 * where search and answer engines look for it.
 */

/** Where in a section's blocks (heading first) a picture goes. */
function pictureIndex(blocks: BlogBlock[]): number {
  if (blocks.length <= 1) return blocks.length
  if (blocks[1]!.type === 'paragraph' && blocks[2]?.type === 'paragraph') return 3
  return 2
}

/** The section's blocks with the picture in its place; a section already holding one keeps its own. */
function withPicture(blocks: BlogBlock[], node: BlogImageNode): BlogBlock[] {
  if (blocks.some(block => block.type === 'image')) return blocks
  const at = Math.min(pictureIndex(blocks), blocks.length)
  return [...blocks.slice(0, at), node, ...blocks.slice(at)]
}

/** The document rebuilt from its sections (the introduction first). */
const joinSections = (sections: Array<{ blocks: BlogBlock[] }>): BlogDoc => ({
  type: 'doc',
  content: sections.flatMap(section => section.blocks)
})

/**
 * New pictures placed in their sections (1 = the first H2). A section
 * index past the end, or a section already holding a picture, places none.
 */
export function placePictures(
  doc: BlogDoc,
  placements: Array<{ sectionIndex: number; node: BlogImageNode }>
): BlogDoc {
  const sections = docSections(doc).map(section => ({ ...section }))
  for (const { sectionIndex, node } of placements) {
    const section = sections[sectionIndex]
    if (!section || sectionIndex < 1) continue
    section.blocks = withPicture(section.blocks, node)
  }
  return joinSections(sections)
}

const SMALL_WORDS = new Set(
  'a an the of to in on for and or is are how what why when which who your you vs with do does can should'.split(' ')
)
const headingWords = (heading: string) =>
  new Set(
    normalizeQuestion(heading)
      .split(' ')
      .filter(word => word && !SMALL_WORDS.has(word))
  )

/**
 * The pictures of an earlier version carried into a regenerated one, with
 * the alt text and captions the author gave them: each goes to the new
 * section whose heading shares the most words with its old section's
 * heading, else to the section at the same place in the outline, at most one
 * per section. Pictures with nowhere to go are left out (their files stay
 * with the blog).
 */
export function carryPictures(previous: BlogDoc, next: BlogDoc): BlogDoc {
  const old = docSections(previous)
    .slice(1)
    .flatMap(section =>
      section.blocks
        .filter((block): block is BlogImageNode => block.type === 'image')
        .slice(0, 1)
        .map(node => ({ node, heading: section.heading ?? '', index: section.index }))
    )
  if (old.length === 0) return next
  const sections = docSections(next).map(section => ({ ...section }))
  const taken = new Set(
    sections.filter(s => s.blocks.some(block => block.type === 'image')).map(s => s.index)
  )
  const place = (index: number, node: BlogImageNode) => {
    taken.add(index)
    sections[index]!.blocks = withPicture(sections[index]!.blocks, node)
  }
  // Pictures whose old heading shares words with a new one go first, so a
  // picture placed by position never takes a section another one matches.
  const unplaced: typeof old = []
  for (const picture of old) {
    const theirs = headingWords(picture.heading)
    let best: { index: number; score: number } | null = null
    for (const section of sections.slice(1)) {
      if (taken.has(section.index)) continue
      const ours = headingWords(section.heading ?? '')
      const shared = [...theirs].filter(word => ours.has(word)).length
      if (shared > 0 && (!best || shared > best.score)) best = { index: section.index, score: shared }
    }
    if (best) place(best.index, picture.node)
    else unplaced.push(picture)
  }
  for (const picture of unplaced) {
    if (sections[picture.index] && picture.index >= 1 && !taken.has(picture.index)) {
      place(picture.index, picture.node)
    }
  }
  return joinSections(sections)
}

/** A rewritten section's blocks with the picture the old section had. */
export function keepSectionPicture(oldBlocks: BlogBlock[], newBlocks: BlogBlock[]): BlogBlock[] {
  const picture = oldBlocks.find((block): block is BlogImageNode => block.type === 'image')
  return picture ? withPicture(newBlocks, picture) : newBlocks
}

/** The document without pictures the blog's list does not have. */
export function keepKnownPictures(doc: BlogDoc, imageIds: string[]): BlogDoc {
  const known = new Set(imageIds)
  return {
    type: 'doc',
    content: doc.content.filter(block => block.type !== 'image' || known.has(block.attrs.imageId))
  }
}
