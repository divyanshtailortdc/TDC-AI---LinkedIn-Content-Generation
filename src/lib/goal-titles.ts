/** A goal title without case or extra spacing, for comparing. */
function normalizeGoalTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** The one rule for "this goal already exists", shared by the form and the save. */
export function hasGoalTitle(existing: string[], title: string): boolean {
  const wanted = normalizeGoalTitle(title)
  return wanted !== '' && existing.some(t => normalizeGoalTitle(t) === wanted)
}
