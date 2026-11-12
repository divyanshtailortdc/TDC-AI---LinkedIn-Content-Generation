/**
 * How posts are written on a platform whose style is casual or fun (see
 * src/lib/formats/styles.ts), in place of the professional rules. They hold
 * for a person or a brand: a dancer's Instagram post and a café's are
 * both written for the people who follow them. The facts still have to be
 * true; what changes is that the posts are personal and playful, can be
 * fiction when they are obviously a skit, and leave the author's own details
 * for them to fill in rather than inventing them.
 */

export const CASUAL_TRUTH_RULES = `- State no fact about the author (an achievement, a number, a place, a person, a brand, a customer or a collaboration) that their details above or the evidence do not give. If a number is not there, do not write one.
- Skits, POV and "when your…" scenarios are welcome as obvious fiction. Never present an invented event as something that really happened to the author.
- When the post needs a real detail only the author knows (the song, the city, the dish, what actually happened), leave a short placeholder in square brackets, like [song name], for them to fill in.
- Say something is trending only when the evidence shows it.
- Write plain text. Real line breaks, no markdown of any kind.`

const SHARED_STYLE_RULES = `- Open on the moment, the joke or the payoff, never on a definition or a lesson.
- No corporate words (leverage, insights, value, stakeholders, thought leadership, synergy) and no "lessons I learned" framing unless the idea is literally a tip.
- Keep it short and let the photo or video carry the rest.
- Never ask for engagement for its own sake ("comment YES", "like if you agree"). Inviting people to tag a friend it fits, try it themselves or say which one they'd pick is fine.`

/** The style rules for a casual or a fun platform. */
export function casualStyleRules(style: 'casual' | 'fun'): string {
  const register =
    style === 'fun'
      ? `- Playful and high-energy: this is entertainment first. Jokes, exaggeration, POV and skits are the point; humour, slang and emoji are welcome when the voice allows them.`
      : `- Relaxed, warm and personal, like talking to the people who follow them rather than presenting to them. Humour where it fits; never stiff.`
  return `- Sound like the author talking to their followers, not a press release and not a LinkedIn post.
${register}
${SHARED_STYLE_RULES}`
}

/** The opening line of a drafting prompt for a casual or fun platform. */
export function casualPersona(platformName: string, style: 'casual' | 'fun'): string {
  return `You are a ghostwriter producing a finished ${platformName} post for one specific author, written for the people who follow them: ${style === 'fun' ? 'fun and playful' : 'casual and personal'}, never corporate. You write in their voice, not yours, and you never invent facts about them.`
}
