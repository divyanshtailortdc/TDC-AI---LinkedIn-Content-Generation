# Images that look like the identity's own posts

## Why

Generated images looked AI-made and nothing like what the identities post. Every
post got the same canvas template (an AI photo beside a headline); the photos
carried fake lettering; the look learned from the account's posts reached the
art director only as a paragraph and lost to the default style (Photorealistic);
and it reached only platforms whose profile had been analysed.

The user asked that images learn from the images the identity posts on its
platforms, and that a better image model be used. They approved: (1) the learned
look decides the image, (2) build from the account's own posts, (3) let users
upload example posts where search finds too few.

## What a live comparison showed (2026-11-23, ~$1.33)

Same prompts on FLUX 3, GPT Image 2, Nano Banana Pro, Nano Banana 2.1 and Seedream 5.5,
with TDCCommerce's one LinkedIn infographic and Zomato's one Instagram quote card as
references (outputs in debug/image-look/):

- Every new model reproduced each account's style closely and spelled all
  requested text correctly. A model-rendered design from the account's own
  examples beats rebuilding the layout by code (the canvas blueprint), so (2) is
  done by the model, with a vision check on the words.
- Nano Banana 2.1 (`google/gemini-nano-banana-2.1`): realistic photo (wear,
  clutter, no gibberish), strong designs, ~$0.06, ~40 s. Chosen.
- Fallbacks: Nano Banana Pro (`google/gemini-3-pro-image`, $0.14), GPT Image 2
  (best photo, but 75–150 s, $0.17–0.22), then FLUX.2 Pro as the last resort.
- Seedream 5.5 stamps "AI generated" on its images; FLUX 3 refused the Zomato card.

## Goals

- An identity's images look like its own posts on that platform: same kind of
  image (photo, infographic, quote card...), layout, colours, type and finish.
- Better pictures everywhere, including identities with no examples.
- Users can add example posts per platform when search finds too few.

Non-goals: carousels (keep their code-drawn slides; their picture gets the new
model). Video. Copying any example's words, numbers, people or logos.

## Design

1. **Image models.** `renderImage` tries Nano Banana 2.1 → Nano Banana Pro →
   GPT Image 2 → FLUX.2 Pro, text-to-image and edits alike. Gemini models are
   language models on the gateway (`generateText`, `files`, `imageConfig`
   aspect ratio + 2K); output is cropped to the exact target size.
2. **Example posts** (`visual_examples`, migration 0061): per identity and
   platform; source `search` / `buffer` (from the profile analysis, replaced on
   each analysis) or `upload` (kept until removed). Images live in storage
   under `examples/<accountId>/`. The analysis keeps up to 12 images; Instagram
   image results are attributed by title as well as by known post.
3. **"Like my posts"** is a new image style choice and the new default (stored
   'auto' and unset read as it; explicit choices stay). With examples for the
   post's platform (else another platform's), the image is made on the new path;
   without any, it falls back to Photorealistic on the existing canvas path.
4. **New path.** An art director (Sonnet, sees the examples) picks 1–3 examples
   to follow, says whether this is a photo or a designed graphic, writes the
   exact words on the image (from the post only), the scene and layout, and
   where the examples keep a logo. Code builds the prompt (exact-text block, no
   copied content, no drawn logos) and the model renders it with the chosen
   examples attached, at the platform's shape. A vision check compares the
   words with what was asked and looks for invented facts, foreign logos and
   artefacts; one retry with the problems spelled out; the better is kept. The
   real logo is laid on by code where the examples keep theirs.
5. **UI.** Profile page, under each platform's link: the example posts as
   thumbnails, "Add images", remove. Brand page and the post's image panel list
   "Like my posts" first.

## Calls left to the builder

Prompt wording, thumbnail sizes, upload limits (12 per platform, 8 MB each,
stored downscaled to 1536 px), how many examples go to the art director (8).
