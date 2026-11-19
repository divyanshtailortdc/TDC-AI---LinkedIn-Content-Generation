/**
 * Builds src/docs/search-embeddings.json: one vector per section of each
 * help page, which the docs search compares a question with
 * (src/docs/semantic-search.ts). Run after changing the help pages:
 *
 *   pnpm docs:index           embed new and changed sections
 *   pnpm docs:index --check   only report; fails if any section is missing
 *
 * Sections whose text has not changed keep their vector, so a run embeds
 * only what was edited (a few thousand tokens for the whole docs). This is
 * a developer step, paid by the AI Gateway key and charged to no user, so
 * it calls the model directly rather than through the usage ledger, and
 * prints what it used.
 */
import { embedMany } from 'ai'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EMBEDDING_MODEL_ID, getEmbeddingModel } from '../../lib/ai'
import { buildDocsSearchIndex } from '../build-index'
import {
  encodeVector,
  sectionEmbeddingHash,
  sectionEmbeddingInput,
  type StoredDocEmbeddings
} from '../embedding-input'

const DOCS_DIR = join(process.cwd(), 'src/docs')
const CONTENT_DIR = join(DOCS_DIR, 'content')
const OUTPUT = join(DOCS_DIR, 'search-embeddings.json')
const checkOnly = process.argv.includes('--check')

function readStored(): StoredDocEmbeddings | null {
  if (!existsSync(OUTPUT)) return null
  return JSON.parse(readFileSync(OUTPUT, 'utf8')) as StoredDocEmbeddings
}

async function main() {
  const pages = buildDocsSearchIndex(file => {
    const path = join(CONTENT_DIR, file)
    return existsSync(path) ? readFileSync(path, 'utf8') : undefined
  })
  const stored = readStored()
  const kept = new Map(
    stored?.model === EMBEDDING_MODEL_ID
      ? stored.sections.map(section => [section.hash, section.vector])
      : []
  )

  const sections = pages.flatMap(page =>
    page.sections
      .filter(section => section.text)
      .map(section => {
        const input = sectionEmbeddingInput(page, section)
        return {
          key: `${page.slug}#${section.id}`,
          input,
          hash: sectionEmbeddingHash(EMBEDDING_MODEL_ID, input)
        }
      })
  )
  const missing = sections.filter(section => !kept.has(section.hash))
  const dropped =
    (stored?.sections.length ?? 0) - (sections.length - missing.length)

  console.log(
    `${pages.length} pages, ${sections.length} sections: ${sections.length - missing.length} unchanged, ${missing.length} to embed, ${Math.max(0, dropped)} no longer used.`
  )
  if (checkOnly) {
    if (missing.length > 0) {
      console.error(
        'The docs search index is out of date: run pnpm docs:index.'
      )
      process.exit(1)
    }
    return
  }

  if (missing.length > 0) {
    const handle = getEmbeddingModel()
    if (!handle) {
      console.error('No embedding model: AI_GATEWAY_API_KEY is not set.')
      process.exit(1)
    }
    const { embeddings, usage } = await embedMany({
      model: handle.model,
      values: missing.map(section => section.input),
      maxParallelCalls: 2
    })
    missing.forEach((section, i) => {
      const vector = embeddings[i]
      if (!vector) throw new Error(`No embedding for ${section.key}`)
      kept.set(section.hash, encodeVector(vector))
    })
    console.log(`Embedded ${missing.length} sections: ${usage.tokens} tokens.`)
  }

  const output: StoredDocEmbeddings = {
    model: EMBEDDING_MODEL_ID,
    sections: sections.map(({ key, hash }) => ({
      key,
      hash,
      vector: kept.get(hash)!
    }))
  }
  writeFileSync(OUTPUT, `${JSON.stringify(output, null, 1)}\n`)
  console.log(`Wrote ${OUTPUT}`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
