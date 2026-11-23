import assert from 'node:assert'
import { describe, it } from 'node:test'
import { isSearchRedirect } from '../src/lib/research/search-redirect'

// Seen 2026-11-20: Serper returned 7 of 10 Instagram results for
// site:instagram.com "Join Zomato on Instagram" as Google redirect links, so
// profile insights found 1 post of an account with 3,000.
const WRAPPED =
  'https://www.google.com/goto?url=CAESZQHEIkXX4E04TmbcBLmm6LycGGPy0nKbCIX9zwdPxtz08zBDrsRG3mojGsnnmB0lbdPonl1vrW62RPhBkSmCCsqJkk1KTO9onmeZ5lE-2amjMq1T9j92BBEq4K9eVFQ7CT6Oe7wm&gsessionid=j7HsZmChNy3_ILfUxGTVI46I4i67EJ8h'

describe('search results wrapped in a Google redirect', () => {
  it('tells a redirect link from a result link', () => {
    assert.ok(isSearchRedirect(WRAPPED))
    assert.ok(isSearchRedirect('https://google.com/goto?url=abc'))
    assert.ok(!isSearchRedirect('https://www.instagram.com/p/DaFv8cjkwxt/'))
    assert.ok(!isSearchRedirect('https://www.google.com/search?q=goto'))
    assert.ok(!isSearchRedirect('https://www.google.com/goto'))
    assert.ok(!isSearchRedirect('https://notgoogle.com/goto?url=abc'))
    assert.ok(!isSearchRedirect('not a url'))
  })
})
