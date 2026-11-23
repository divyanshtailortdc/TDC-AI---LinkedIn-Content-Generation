/**
 * The help pages under /docs, in the order they are read: the docs sidebar,
 * breadcrumbs, previous/next links, Next steps cards and search all follow
 * this. Each page's text is src/docs/content/<slug>.mdx (introduction.mdx
 * for the home page); tests/docs.test.ts checks the two agree.
 *
 * Plain data, so client components can import it.
 */
import type { DocIconName } from './doc-icons'

export const DOCS_PATH = '/docs'

export type DocNavItem = {
  title: string
  /** Its path under /docs; '' is the home page. A group that only folds pages has none. */
  slug?: string
  /** One line, for search results and Next steps cards. */
  description?: string
  /** Shown beside a top-level entry in the docs sidebar. */
  icon?: DocIconName
  items?: DocNavItem[]
}

export type DocNavSection = { title: string; items: DocNavItem[] }

/** A page that can be opened, with where it sits in the navigation. */
export type DocPage = {
  slug: string
  title: string
  description?: string
  /** The section, then any group, it sits under; for breadcrumbs and search. */
  trail: string[]
}

export const DOCS_NAV: DocNavSection[] = [
  {
    title: 'Getting Started',
    items: [
      {
        title: 'Introduction',
        icon: 'book',
        slug: '',
        description:
          'What the Content Engine does and how its parts fit together.'
      },
      {
        title: 'Quick Start',
        icon: 'rocket',
        slug: 'getting-started',
        description: 'From a new account to your first published post.'
      },
      {
        title: 'Dashboard',
        icon: 'dashboard',
        slug: 'getting-started/dashboard',
        description: 'What the dashboard shows and where to go from it.'
      },
      {
        title: 'Identities',
        icon: 'users',
        slug: 'getting-started/identities',
        description:
          'Write as yourself, your company or a client, each with its own setup.'
      }
    ]
  },
  {
    title: 'Account Setup',
    items: [
      {
        title: 'Profile',
        icon: 'user',
        slug: 'account-setup/profile',
        description:
          'Who is posting, where they post, and what they are known for.'
      },
      {
        title: 'Voice',
        icon: 'voice',
        slug: 'account-setup/voice',
        description: 'How your posts should sound.'
      },
      {
        title: 'Knowledge',
        icon: 'library',
        slug: 'account-setup/knowledge',
        description:
          'Your own documents and newsletter stories that ground posts in facts.'
      },
      {
        title: 'Preferences',
        icon: 'sliders',
        slug: 'account-setup/preferences',
        description:
          'How many ideas a run proposes, and what to stay away from.'
      },
      {
        title: 'Starting a Run',
        icon: 'play',
        slug: 'account-setup/runs',
        description: 'Ask the engine for new ideas and follow its progress.'
      },
      {
        title: 'Goals',
        icon: 'target',
        slug: 'account-setup/goals',
        description:
          'What your posts are for, and how goals steer the ideas you get.'
      },
      {
        title: 'Ideas',
        icon: 'lightbulb',
        slug: 'account-setup/ideas',
        description:
          'Review, approve or reject the ideas a run proposes, and read their scorecards.'
      },
      {
        title: 'Brand Theme',
        icon: 'palette',
        slug: 'account-setup/brand-theme',
        description: 'Colours, logo and image style for your post images.'
      }
    ]
  },
  {
    title: 'Publishing',
    items: [
      {
        title: 'Newsletters',
        icon: 'newspaper',
        items: [
          {
            title: 'Discover',
            slug: 'publishing/newsletters/discover',
            description:
              'Find newsletters on your topics and subscribe your inbox to them.'
          },
          {
            title: 'Inbox',
            slug: 'publishing/newsletters/inbox',
            description:
              'Your identity’s own email address, and the stories read from what arrives.'
          }
        ]
      },
      {
        title: 'Run Details',
        icon: 'steps',
        slug: 'publishing/run-details',
        description:
          'Every run, its steps, the ideas it produced and what it cost.'
      },
      {
        title: 'Posts',
        icon: 'post',
        items: [
          {
            title: 'Overview',
            slug: 'publishing/posts/overview',
            description:
              'Where drafts come from and how a post moves to published.'
          },
          {
            title: 'Editing a Post',
            slug: 'publishing/posts/editing',
            description:
              'Rewrite, check and approve a draft before it goes out.'
          },
          {
            title: 'Post Types & Images',
            slug: 'publishing/posts/post-types',
            description:
              'Text, image and carousel posts, and how their images are made.'
          }
        ]
      },
      {
        title: 'Schedule',
        icon: 'calendar',
        slug: 'publishing/schedule',
        description: 'When each post goes out, and publishing it.'
      }
    ]
  },
  {
    title: 'Settings',
    items: [
      {
        title: 'Security',
        icon: 'shield',
        slug: 'settings/security',
        description: 'Signing in, passkeys and keeping your account safe.'
      },
      {
        title: 'Integrations',
        icon: 'plug',
        slug: 'settings/integrations',
        description: 'Connect the accounts your posts are published to.'
      },
      {
        title: 'Theme',
        icon: 'theme',
        slug: 'settings/theme',
        description: 'Light or dark mode, and the app’s colours.'
      }
    ]
  },
  {
    title: 'Help',
    items: [
      {
        title: 'AI Usage & Limits',
        icon: 'gauge',
        slug: 'help/ai-usage',
        description:
          'What AI work costs, where to see it, and the limits that cap it.'
      },
      {
        title: 'Troubleshooting',
        icon: 'wrench',
        slug: 'help/troubleshooting',
        description: 'What to do when something does not work as expected.'
      },
      {
        title: 'FAQ',
        icon: 'help',
        slug: 'help/faq',
        description: 'Short answers to common questions.'
      }
    ]
  }
]

export function docHref(slug: string) {
  return slug ? `${DOCS_PATH}/${slug}` : DOCS_PATH
}

/** The page a /docs pathname shows, if any. */
export function docSlugFromPathname(pathname: string): string | null {
  if (pathname === DOCS_PATH) return ''
  if (!pathname.startsWith(`${DOCS_PATH}/`)) return null
  return pathname.slice(DOCS_PATH.length + 1).replace(/\/+$/, '')
}

function flatten(items: DocNavItem[], trail: string[]): DocPage[] {
  return items.flatMap(item => {
    const page: DocPage[] =
      item.slug === undefined
        ? []
        : [
            {
              slug: item.slug,
              title: item.title,
              description: item.description,
              trail
            }
          ]
    return item.items
      ? [...page, ...flatten(item.items, [...trail, item.title])]
      : page
  })
}

/** Every page, in reading order. */
export const DOC_PAGES: DocPage[] = DOCS_NAV.flatMap(section =>
  flatten(section.items, [section.title])
)

export function findDocPage(slug: string): DocPage | undefined {
  return DOC_PAGES.find(page => page.slug === slug)
}

/** The pages before and after this one in reading order. */
export function adjacentDocPages(slug: string): {
  previous: DocPage | null
  next: DocPage | null
} {
  const index = DOC_PAGES.findIndex(page => page.slug === slug)
  if (index === -1) return { previous: null, next: null }
  return {
    previous: DOC_PAGES[index - 1] ?? null,
    next: DOC_PAGES[index + 1] ?? null
  }
}

/** The other pages under the same section or group, for Next steps. */
export function siblingDocPages(slug: string): DocPage[] {
  const page = findDocPage(slug)
  if (!page) return []
  const key = page.trail.join('\u0000')
  return DOC_PAGES.filter(
    other => other.slug !== slug && other.trail.join('\u0000') === key
  )
}
