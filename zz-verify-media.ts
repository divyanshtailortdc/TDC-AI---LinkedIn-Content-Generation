// Real end-to-end check of post images on a disposable DB. Deleted after use.
import fs from 'node:fs'
import sharp from 'sharp'

if (!process.env.DATABASE_URL?.includes('127.0.0.1:54338')) {
  throw new Error('Refusing to run: DATABASE_URL must be the disposable DB')
}

const OUT = 'debug/ref-eval'
const DRAFT_1 = '7ae45262-3d0f-4b50-ab1d-224c95e75f8c'
const DRAFT_2 = '4a0ef90a-8f60-4201-b11c-e59a648064ff'
const ACCOUNT = '46356da7-2ccf-46ee-9033-8f589893b85e'
const only = process.argv[2]

async function main() {
  const { db } = await import('./src/db')
  const { brandThemesTable, postMediaTable } = await import('./src/db/schema')
  const { eq, desc } = await import('drizzle-orm')
  const { normalizeLogo, toDataUrl, decodeImageDataUrl } = await import('./src/lib/media/brand-logo')
  const { createPostMedia } = await import('./src/lib/media/post-media')
  const { createPromptMediaForDraft } = await import('./src/lib/media/prompt-media')

  const save = (name: string, dataUrl?: string | null) => {
    const decoded = dataUrl ? decodeImageDataUrl(dataUrl) : null
    if (decoded) fs.writeFileSync(`${OUT}/${name}.jpg`, decoded.buffer)
  }

  // Survives revalidatePath outside a Next request: the row is written before it.
  const settle = async <T,>(label: string, run: () => Promise<T>) => {
    const t = Date.now()
    try {
      const out = await run()
      console.log(`\n== ${label}: ${((Date.now() - t) / 1000).toFixed(1)}s`)
      return out
    } catch (err: any) {
      console.log(`\n== ${label}: threw after ${((Date.now() - t) / 1000).toFixed(1)}s: ${err?.message}`)
      return null
    }
  }

  const latest = async (draftId: string) =>
    (await db.select().from(postMediaTable).where(eq(postMediaTable.draftId, draftId)).orderBy(desc(postMediaTable.createdAt)).limit(1))[0]

  const report = async (name: string, draftId: string) => {
    const row = await latest(draftId)
    if (!row) return console.log('no media row')
    const m = row.metadata as any
    save(name, row.imageUrl)
    save(`${name}-base`, row.baseImageUrl)
    console.log(JSON.stringify({
      version: row.version, status: row.status, model: m.modelId, size: `${m.width}x${m.height}`,
      usedReference: m.usedReference, workflow: m.workflow, logo: m.logo,
      visualType: m.visualType, concept: m.mediaBrief?.primaryConcept, headline: m.textOverlay?.headline,
      review: m.review, issues: m.issues, costUsd: m.usage?.costUsd, hasBase: Boolean(row.baseImageUrl)
    }, null, 1))
  }

  if (!only || only === 'setup') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="200"><rect x="8" y="30" width="190" height="140" rx="26" fill="none" stroke="#102a43" stroke-width="14"/><text x="103" y="128" font-family="DejaVu Sans" font-weight="bold" font-size="76" fill="#102a43" text-anchor="middle">TDC</text><text x="230" y="128" font-family="DejaVu Sans" font-size="84" fill="#0e9aa7">Commerce</text></svg>`
    const png = await sharp(Buffer.from(svg)).png().toBuffer()
    const logo = await normalizeLogo(toDataUrl(png, 'image/png'))
    fs.writeFileSync(`${OUT}/test-logo.png`, decodeImageDataUrl(logo.dataUrl)!.buffer)
    await db.insert(brandThemesTable).values({ accountId: ACCOUNT, logoImage: logo.dataUrl, primaryColor: '#0e9aa7', accentColor: '#102a43' })
      .onConflictDoUpdate({ target: brandThemesTable.accountId, set: { logoImage: logo.dataUrl, primaryColor: '#0e9aa7', accentColor: '#102a43' } })
    console.log('brand theme saved', logo.width, logo.height)
  }

  const reference = fs.readFileSync('debug/image-eval/existing-3d7e47a3.jpeg')

  if (!only || only === 'A') {
    const out = await settle('A: first image from the post', () => createPostMedia({ draftId: DRAFT_1, accountId: ACCOUNT }))
    console.log('outcome', out?.status, (out as any)?.error ?? '')
    await report('A', DRAFT_1)
  }
  if (!only || only === 'B') {
    const out = await settle('B: reference image', () => createPostMedia({ draftId: DRAFT_1, accountId: ACCOUNT, referenceImage: reference }))
    console.log('outcome', out?.status, (out as any)?.error ?? '')
    await report('B', DRAFT_1)
  }
  if (!only || only === 'C') {
    const out = await settle('C: regenerate with the same reference', () => createPostMedia({ draftId: DRAFT_1, accountId: ACCOUNT, referenceImage: reference }))
    console.log('outcome', out?.status, (out as any)?.error ?? '')
    await report('C', DRAFT_1)
  }
  if (!only || only === 'D') {
    const out = await settle('D: typed prompt', () => createPromptMediaForDraft({ draftId: DRAFT_2, accountId: ACCOUNT, prompt: 'A flat illustration of one sales order moving once through a single connected system, instead of being typed in again at every desk' }))
    console.log('outcome', out?.status)
    await report('D', DRAFT_2)
  }
  if (!only || only === 'E') {
    const current = await latest(DRAFT_2)
    const out = await settle('E: edit current image', () => createPromptMediaForDraft({ draftId: DRAFT_2, accountId: ACCOUNT, prompt: 'Make the background a warm off-white', referenceMediaId: current!.id }))
    console.log('outcome', out?.status)
    await report('E', DRAFT_2)
  }
  if (!only || only === 'F') {
    const before = (await latest(DRAFT_1))?.id
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 8000)
    const out = await settle('F: stopped after 8s', () => createPostMedia({ draftId: DRAFT_1, accountId: ACCOUNT, referenceImage: reference, abortSignal: controller.signal }))
    console.log('outcome', out?.status, 'active image unchanged:', (await latest(DRAFT_1))?.id === before)
  }

}

main().then(() => process.exit(0), err => { console.error(err); process.exit(1) })
