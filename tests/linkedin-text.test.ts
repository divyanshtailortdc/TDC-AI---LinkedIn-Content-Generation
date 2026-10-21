import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  linkedInHashtags,
  linkedInPostText,
  toLinkedInText,
  toUnicodeBold
} from '../src/lib/post-text'

describe('post copied for LinkedIn', () => {
  it('puts hook, body, call to action and hashtags a blank line apart', () => {
    const text = linkedInPostText({
      hook: 'Quotes take too long',
      body: 'First point.\n\nSecond point.',
      cta: 'What slows yours down?',
      hashtags: ['Sales', 'CPQ']
    })
    assert.equal(
      text,
      `${toUnicodeBold('Quotes take too long')}\n\nFirst point.\n\nSecond point.\n\nWhat slows yours down?\n\n#Sales #CPQ`
    )
  })

  it('leaves out an empty call to action and no hashtags without blank lines', () => {
    assert.equal(
      linkedInPostText({ hook: 'H', body: 'B', cta: '  ', hashtags: [] }),
      `${toUnicodeBold('H')}\n\nB`
    )
  })

  it('never includes the first comment', () => {
    const post = {
      hook: 'H',
      body: 'B',
      firstComment: 'Link: https://example.com'
    }
    assert.ok(!linkedInPostText(post).includes('example.com'))
  })

  it('keeps single line breaks and one blank line between paragraphs', () => {
    assert.equal(
      toLinkedInText('Line one\nline two\n\n\n\nNext paragraph\n \n\t\nLast'),
      'Line one\nline two\n\nNext paragraph\n\nLast'
    )
  })

  it('drops the spaces LinkedIn drops: trailing, leading, doubled, and Windows line ends', () => {
    assert.equal(
      toLinkedInText('\n\n  Hello   there  \r\n\r\n\tIndented line\t\n\n'),
      'Hello there\n\nIndented line'
    )
  })

  it('keeps emoji, including keycaps, flags, skin tones and joined sequences', () => {
    const emoji = '1️⃣ Step 👍🏽 team 👩‍💻 from 🇮🇳 #️⃣ ✅'
    assert.equal(toLinkedInText(emoji), emoji)
    const hook = toUnicodeBold('3️⃣ ways 🚀')
    assert.ok(hook.startsWith('3️⃣ '), hook)
    assert.ok(hook.endsWith(' 🚀'))
    assert.ok(!/[A-Za-z]/.test(hook))
  })

  it('keeps Unicode-styled letters, accents, other scripts and invisible spacers', () => {
    const styled = '𝗕𝗼𝗹𝗱 and 𝘪𝘵𝘢𝘭𝘪𝘤, café, नमस्ते, 你好\n\u2800\nNext'
    assert.equal(toLinkedInText(styled), styled)
    assert.equal(toLinkedInText('\u2003Em-spaced'), '\u2003Em-spaced')
  })

  it('keeps bullet characters, dash lists and numbered lists as written', () => {
    const list = '• One\n◦ Two\n→ Three\n- Four\n1. Five\n2) Six\n✅ Seven'
    assert.equal(toLinkedInText(list), list)
  })
})

describe('links and hashtags', () => {
  it('keeps links exactly, without the sentence punctuation after them', () => {
    const text =
      'See https://www.example.com/a_b_c?x=1&y=2. Or www.example.org/path_(x), and (https://example.net/).'
    assert.equal(toLinkedInText(text), text)
    assert.equal(
      toUnicodeBold('Read https://www.example.com/a_b now'),
      `${toUnicodeBold('Read')} https://www.example.com/a_b ${toUnicodeBold('now')}`
    )
  })

  it('leaves hashtags, links and email addresses in a bold hook plain', () => {
    const bold = toUnicodeBold(
      'Why #AI fails: hello@example.com, example.com/x'
    )
    assert.ok(bold.includes(' #AI '))
    assert.ok(bold.includes('hello@example.com'))
    // A bare domain is not a link LinkedIn recognises, so it is bolded too.
    assert.ok(!bold.includes('example.com/x'))
  })

  it('keeps inline hashtags in the body', () => {
    const text = 'Big week for #B2B and #SaaS_Ops.\n\n#Growth #ProductLed'
    assert.equal(toLinkedInText(text), text)
  })

  it('turns stored hashtags into one-word tags, each once', () => {
    assert.deepEqual(
      linkedInHashtags([
        'Product Management',
        '#AI',
        'ai',
        'B2B-SaaS',
        '##Growth',
        '  ',
        'डिजिटल'
      ]),
      ['#ProductManagement', '#AI', '#B2BSaaS', '#Growth', '#डिजिटल']
    )
  })
})

describe('Markdown removed', () => {
  it('turns bold into Unicode bold and drops italic, code and strikethrough markers', () => {
    assert.equal(
      toLinkedInText(
        'This is **key** and __vital__, *really* _quite_ ~~not~~ `code`.'
      ),
      `This is ${toUnicodeBold('key')} and ${toUnicodeBold('vital')}, really quite not code.`
    )
    assert.equal(toLinkedInText('***Both***'), toUnicodeBold('Both'))
  })

  it('turns headings into bold lines and * or + lists into bullets', () => {
    assert.equal(
      toLinkedInText('## Three lessons ##\n\n* First\n  * Nested\n+ Second'),
      `${toUnicodeBold('Three lessons')}\n\n• First\n◦ Nested\n• Second`
    )
  })

  it('shows links as their text and address, or the address alone', () => {
    assert.equal(
      toLinkedInText(
        'Read [the report](https://www.example.com/report_(2026)) or [example.com](https://example.com/). [Top](#top)'
      ),
      'Read the report (https://www.example.com/report_(2026)) or https://example.com/. Top'
    )
    assert.equal(
      toLinkedInText(
        'Write to [us](mailto:team@example.com) ![chart](https://x.io/c.png)'
      ),
      'Write to us (team@example.com)'
    )
  })

  it('removes code fences and * or _ rules but keeps --- dividers', () => {
    assert.equal(
      toLinkedInText('```js\nconst a_b_c = 1\n```\n***\nAfter\n\n---\n\nEnd'),
      'const a_b_c = 1\n\nAfter\n\n---\n\nEnd'
    )
  })

  it('does not touch link text that only looks like Markdown', () => {
    assert.equal(
      toLinkedInText('https://example.com/_draft_/**x and #tag_one_'),
      'https://example.com/_draft_/**x and #tag_one_'
    )
  })

  it('leaves plain text that merely contains * or _ alone', () => {
    const text =
      'snake_case_name, 5*3*2, 2 * 3 = 6, C# devs, *Terms apply, first_last@example.com, __init__ish'
    assert.equal(toLinkedInText(text), text)
  })
})

describe('HTML removed', () => {
  it('turns paragraphs and line breaks into lines', () => {
    assert.equal(
      toLinkedInText(
        '<p>First paragraph</p>\n<p>Second<br>line two<br />\nline three</p>'
      ),
      'First paragraph\n\nSecond\nline two\nline three'
    )
    assert.equal(
      toLinkedInText(
        '<div>One</div><div><br></div><div>Two</div><div>Three</div>'
      ),
      'One\n\nTwo\nThree'
    )
  })

  it('turns lists into bullets and numbers, bold into Unicode bold, and links into addresses', () => {
    assert.equal(
      toLinkedInText(
        '<h2>Plan</h2><ul>\n<li>One</li>\n<li><strong>Two</strong></li>\n</ul><ol><li>A</li><li>B</li></ol><p>See <a href="https://example.com/x?a=1&amp;b=2">the guide</a> <em>today</em>.</p>'
      ),
      `${toUnicodeBold('Plan')}\n\n• One\n• ${toUnicodeBold('Two')}\n\n1. A\n2. B\n\nSee the guide (https://example.com/x?a=1&b=2) today.`
    )
  })

  it('decodes entities and keeps text that only looks like a tag', () => {
    assert.equal(
      toLinkedInText(
        'AT&amp;T &lt;3 R&D &#128640; &nbsp;x &unknown; a <b and c> d, 1 < 2 > 0, <3'
      ),
      'AT&T <3 R&D 🚀 x &unknown; a <b and c> d, 1 < 2 > 0, <3'
    )
  })
})

describe('preview and copy agree', () => {
  it('gives the same text when cleaned twice', () => {
    const messy =
      '<p>**Big** news 🚀</p>\n\n\n* item one  \n* item _two_\n\nVisit [site](https://www.example.com).\r\n#Launch'
    const once = toLinkedInText(messy)
    assert.equal(toLinkedInText(once), once)
    const post = {
      hook: '**Hook** 1️⃣',
      body: messy,
      cta: ' Ask? ',
      hashtags: ['A B']
    }
    assert.equal(
      linkedInPostText({
        hook: toLinkedInText(post.hook),
        body: once,
        cta: toLinkedInText(post.cta),
        hashtags: linkedInHashtags(post.hashtags)
      }),
      linkedInPostText(post)
    )
  })
})
