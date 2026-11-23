import type { OnboardingStepKey } from './progress'

/**
 * What the guide says about each step: what it is, why it matters, and what
 * to click, in the words the pages use (the help pages under
 * src/docs/content/account-setup say the same at length). Kept beside the
 * rules in ./progress, so a new step cannot be added without its text.
 */
export type StepContent = {
  /** What to do, as a short instruction. */
  title: string
  /** What the step is, in a line. */
  summary: string
  /** Why it matters. */
  why: string
  /** What to click, in order. */
  how: string[]
  /** About how long it takes. */
  time: string
  /** The button that takes the user to the work. */
  cta: string
  /** For an optional step: the button that leaves it for later. */
  skipLabel?: string
  /** For a step with defaults: the button that accepts them. */
  confirmLabel?: string
}

export const STEP_CONTENT: Record<OnboardingStepKey, StepContent> = {
  profile: {
    title: 'Create your identity',
    summary: 'Who your posts are written for: you, your company or a product.',
    why: 'Every idea and post is written for this identity, in its voice and for its audience.',
    how: [
      'Pick every platform you post on, then click Continue.',
      "Describe who you are, what you post about and who it's for. Add your profile links and website if you have them.",
      "Click Set it up with AI to have the profile filled in for you, or I'll fill it in myself.",
      'Check what was filled in, then click Create identity.'
    ],
    time: 'About 3 minutes',
    cta: 'Create your identity'
  },
  voice: {
    title: 'Set your voice',
    summary:
      'How your posts sound: writing style, who is speaking, emoji and hashtags.',
    why: 'Drafts follow these settings, so posts sound like you rather than a generic AI.',
    how: [
      'Under Adjust if needed, pick a writing style and who is speaking: Me, My team or Brand.',
      'Set how formal and how direct posts should be, and how many emoji and hashtags to use.',
      'Click Save in the header.'
    ],
    time: 'About 2 minutes',
    cta: 'Set your voice'
  },
  knowledge: {
    title: 'Add to your knowledge base',
    summary: 'Articles, case studies or notes your posts can take facts from.',
    why: 'Posts grounded in sources you stand behind are more specific and more accurate.',
    how: [
      'Choose Add a link, paste the address of an article or case study and click Fetch. Or choose Paste text.',
      'Check the preview, then click Save.',
      'Add as many as you like. Optional: you can skip this and add sources later.'
    ],
    time: 'About 2 minutes a source',
    cta: 'Add a source',
    skipLabel: 'Skip for now'
  },
  goals: {
    title: 'Set a goal',
    summary:
      'What your posts are for, and the one point readers should come round to.',
    why: 'Every idea is written toward a goal, so you need at least one to generate ideas.',
    how: [
      'Click New Goal. On a new identity the form is already open.',
      'Give it a Goal Title, pick an Objective and write the Key Message.',
      'Click Save Goal →. Not sure what to write? Suggest Goals proposes a few for you to edit.'
    ],
    time: 'About 2 minutes',
    cta: 'Set a goal'
  },
  preferences: {
    title: 'Check your preferences',
    summary:
      'How many ideas a run makes, each platform’s style, and topics to avoid.',
    why: 'They start with sensible defaults. Check them once so every run follows your rules.',
    how: [
      'Look over Ideas per run, the style of each platform and the topics to stay away from.',
      'To change something, click Edit, make your changes and click Save.',
      'If the defaults suit you, click These look right.'
    ],
    time: 'About 1 minute',
    cta: 'Check your preferences',
    confirmLabel: 'These look right'
  },
  brandTheme: {
    title: 'Set your brand theme',
    summary:
      'Your logo, colours, typefaces and image style, for every generated image.',
    why: 'Images that carry your logo and colours look like they come from you.',
    how: [
      'Upload your logo and pick your primary, accent and background colours.',
      'Choose an image style and typefaces. The Live Canvas Preview shows the result.',
      'Click Save changes at the top of the page.'
    ],
    time: 'About 3 minutes',
    cta: 'Set your brand theme',
    skipLabel: 'Keep the default look'
  },
  buffer: {
    title: 'Connect your Buffer account',
    summary:
      'Posts are published through your own Buffer account. The app never sees your social media passwords.',
    why: 'Buffer publishes to LinkedIn, X, Threads, Facebook and Instagram for you, as your own accounts.',
    how: [
      'In Buffer (buffer.com), add each social account you want to publish to. Buffer calls them channels; a free Buffer account works.',
      "Click Connect Buffer. You go to Buffer's site.",
      'Sign in to Buffer and allow TDC AI to read your channels and create posts. Both are needed.',
      'You come straight back here, ready for the next step.'
    ],
    time: 'About 2 minutes',
    cta: 'Connect Buffer'
  },
  channels: {
    title: 'Choose where your posts go',
    summary: 'Which of your Buffer channels each platform publishes to.',
    why: 'Your posts go only to the accounts you confirm here.',
    how: [
      'Check the account shown for each platform.',
      'To change one, go to the Buffer card in Settings › Integrations, find the account under Your accounts and click Publish here.',
      'Missing an account? Add it in Buffer, then click Sync now on the Buffer card.',
      'When they are right, click Confirm channels.'
    ],
    time: 'About 1 minute',
    cta: 'Choose channels',
    confirmLabel: 'Confirm channels'
  },
  ideas: {
    title: 'Generate your first ideas',
    summary:
      'A run researches your goals and proposes post ideas, each with its sources and scores.',
    why: 'Every post starts from an idea you chose.',
    how: [
      'On Goals, click Generate ideas.',
      'Tick your goal and click Generate for 1 goal.',
      'The run takes a few minutes. You can leave the page: it carries on, and this guide shows when your ideas are ready.'
    ],
    time: 'Usually a few minutes',
    cta: 'Generate ideas'
  },
  post: {
    title: 'Turn an idea into a post',
    summary:
      'Approve the idea you like best, then have it written up as a post.',
    why: 'Nothing is written until you pick an idea, so every post starts from your choice.',
    how: [
      'On Ideas, read the ideas and how they score. Click Approve on the one you like.',
      'Tick it and click Create 1 post.',
      'Pick the platform and the type of post, then click Create posts. Writing takes about a minute.'
    ],
    time: 'About 2 minutes',
    cta: 'Review ideas'
  },
  review: {
    title: 'Review and approve the post',
    summary: 'Read the draft, change anything you like, and approve it.',
    why: 'Only approved posts can be published, so nothing goes out without your say.',
    how: [
      'Open the post. To change the wording, click Edit text, make your changes and click Save.',
      'Check the warnings and the preview.',
      'When it is ready, click Approve (or press A).'
    ],
    time: 'About 3 minutes',
    cta: 'Open the post'
  },
  publish: {
    title: 'Publish your first post',
    summary:
      'Send the approved post to your social account, now or at a time you pick.',
    why: 'The finish line: your first post goes out publicly, as the account you chose.',
    how: [
      'Open the approved post.',
      'Click Publish now, or Schedule to pick a date and time.',
      'Read the final check: the text, what goes with it and the account it goes out as. Tick the box and confirm.'
    ],
    time: 'About 1 minute',
    cta: 'Open the post'
  }
}

/** The journey's three parts, for the dashboard checklist. */
export const ONBOARDING_PHASES: Array<{
  title: string
  steps: OnboardingStepKey[]
}> = [
  {
    title: 'Set up your brand',
    steps: [
      'profile',
      'voice',
      'knowledge',
      'goals',
      'preferences',
      'brandTheme'
    ]
  },
  { title: 'Connect publishing', steps: ['buffer', 'channels'] },
  {
    title: 'Create your first post',
    steps: ['ideas', 'post', 'review', 'publish']
  }
]
