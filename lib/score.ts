import { User, FeedCard, Swipe } from '@/types'

/** Build the set of user IDs to exclude from the feed.
 *  Passes expire after 30 days — that person reappears in the feed. */
export function buildSwipedSet(swipes: Pick<Swipe, 'to_user' | 'sentiment' | 'created_at'>[]): Set<string> {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
  return new Set(
    swipes
      .filter(s => {
        if (s.sentiment === 'pass') return new Date(s.created_at).getTime() > thirtyDaysAgo
        return true // like/dislike/neutral/block are permanent
      })
      .map(s => s.to_user)
  )
}

/** Returns true if a wants to date b and b wants to date a.
 *  Null-safe: if either side has no preference set, treat as open to everyone. */
function mutuallyCompatible(a: User, b: User): boolean {
  function prefMatchesGender(prefs: string[] | string | null | undefined, gender: string | null | undefined): boolean {
    if (!prefs || !gender) return true // no pref set = open to everyone
    // handle Supabase returning text column as string instead of text[]
    const arr = Array.isArray(prefs) ? prefs : [prefs]
    if (arr.length === 0) return true
    return arr.some(p =>
      (p === 'Men' && gender === 'Man') ||
      (p === 'Women' && gender === 'Woman') ||
      (p === 'Non-binary' && gender === 'Non-binary')
    )
  }
  return prefMatchesGender(a.want_to_date, b.gender) && prefMatchesGender(b.want_to_date, a.gender)
}

export function proximityScore(a: User, b: User): number {
  if (!mutuallyCompatible(a, b)) return 0
  let score = 1 // baseline — everyone compatible shows up
  if (a.campus && b.campus && a.campus === b.campus) score += 1
  return score
}

export function buildFeed(
  currentUser: User,
  others: User[],
  swipedIds: Set<string>,
  admiredByIds: Set<string> = new Set(),
  totalUserCount?: number
): FeedCard[] {
  // With fewer than 20 users (demo / early launch) skip compat filtering so
  // everyone can see each other regardless of gender preferences.
  const tinyPool = (totalUserCount ?? others.length + 1) < 20

  return others
    .filter((u) => !swipedIds.has(u.id))
    .map((u) => {
      const base = tinyPool ? 1 : proximityScore(currentUser, u)
      return {
        user: u,
        score: base,
        hint: buildHint(currentUser, u),
      }
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
}

function buildHint(a: User, b: User): string {
  if (a.campus && b.campus && a.campus === b.campus) return 'y\'all are literally on the same campus'
  return 'you two have probably crossed paths ngl'
}
