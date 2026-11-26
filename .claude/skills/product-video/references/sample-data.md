# Sample Data Playbook

A product video is only as convincing as the data on screen. Empty charts, lorem ipsum and real customers' names all hurt it. Build a demo dataset that tells a story.

## Safety First

- Record against a local or staging database. Never seed or record production.
- Confirm which database the app points at before you delete anything. Show the user what is there and get approval to wipe it.
- Refuse to run the seed when the app says it is in production (an `APP_ENV`, `NODE_ENV` or similar guard).
- Never show real people, real customers or real company data. Invent everything.

## Pick a Fictional Brand

- Invent a brand that fits the product's best customer, for example an outdoor gear store for a retail analytics tool.
- Invent competitors too. Real competitor names beside made-up numbers create legal and trust risk.
- Give each brand a distinct personality: a market leader, a close rival, a niche specialist, a budget option.
- Use plausible domains and names, and the same demo person throughout (name, email, avatar initials).
- Use platforms everyone knows (Reddit, YouTube, Wikipedia) only as neutral sources, never with invented claims about them.

## Tell a Story Over Time

Static numbers look fake. Shape the data so each screen has something to say:

- **A trend:** the demo brand improves over 8 to 10 weeks, for example from 25% to 38%. Keep it believable, not a hockey stick.
- **Cause and effect:** changes the user shipped line up with improvements afterwards.
- **A leader to chase:** one competitor is ahead and slowly slipping.
- **Wins and losses:** some items score high, a few score near zero, so "opportunities" screens have content.
- **A few problems:** a handful of warnings or errors (wrong facts, price mismatches, alerts), enough to demo the feature but not so many the product looks broken.
- **Recent activity:** the newest events land today or yesterday, so "last updated" labels look fresh.

Date everything relative to the day you seed. Tell the user to reseed right before each recording.

## Make the Numbers Consistent

- Generate raw records (events, answers, orders) and let the app's own code compute totals, scores and aggregates. Handwritten totals disagree with detail screens.
- Reuse the app's pure functions (parsers, matchers, classifiers) inside the seed so derived fields match what the product would compute.
- Use a seeded random generator so every reseed tells the same story.
- Add day-to-day noise, but keep a stable baseline per item so charts don't zigzag.
- Fill every status field with its finished value (completed, analyzed, sent). Pending or running states show spinners on camera.
- Set any plan or subscription so the demo account has no trial banners, upgrade prompts or locked features.

## Write the Seed as a Script

- Write it in the project's language, beside its existing seed or database scripts. A TypeScript app with a seed in `src/db/seed.ts` gets `src/db/seed-demo.ts`, not a new `.mjs` file in a new folder.
- Run it the way the project runs its other scripts (its package manager, `tsx`, Bun), with a package script such as `db:seed:demo`.
- Import the app's own database client, schema and helpers rather than duplicating them.
- Wipe and rebuild in one run so it is repeatable, and keep it under a minute.
- Print a short summary at the end: counts and the demo login.
- Document the command and the demo login in the project's README or agent instructions.

## Check Before Recording

Open every screen the video shows, at the recording viewport size, and confirm:

- No empty states, spinners, error toasts or "pending" badges.
- Numbers agree across screens.
- Text is readable at 1080p, with no truncated labels.
- Nothing internal shows: debug badges, admin-only costs, vendor names the marketing site avoids.

Report any real bugs you notice to the user instead of hiding them with data.
