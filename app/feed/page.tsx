'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { buildFeed, buildSwipedSet } from '@/lib/score'
import { User, FeedCard, Match, Notification } from '@/types'

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string
            scope: string
            callback: (resp: { access_token?: string; error?: string }) => void
          }) => { requestAccessToken: () => void }
        }
      }
    }
  }
}

const COLORS = [
  'bg-rose-50 text-rose-500',
  'bg-sky-50 text-sky-500',
  'bg-emerald-50 text-emerald-500',
  'bg-amber-50 text-amber-500',
  'bg-violet-50 text-violet-500',
  'bg-teal-50 text-teal-500',
]

function avatarColor(id: string) {
  const n = id.charCodeAt(0) + id.charCodeAt(id.length - 1)
  return COLORS[n % COLORS.length]
}
function nameColor(name: string) {
  const n = name.charCodeAt(0) + name.charCodeAt(name.length - 1)
  return COLORS[n % COLORS.length]
}

type Sentiment = 'like' | 'dislike' | 'neutral' | 'pass' | 'block'
type BellStatus = 'off' | 'watching' | 'triggered'
type EmailContact = { name: string; email: string }
type ClassmateOnMaple = FeedCard & { contactName: string }
type ContactNotOnMaple = EmailContact & { invited: boolean }

export default function FeedPage() {
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [feed, setFeed] = useState<FeedCard[]>([])
  const [knownOnMaple, setKnownOnMaple] = useState<ClassmateOnMaple[]>([])
  const [knownOff, setKnownOff] = useState<ContactNotOnMaple[]>([])
  const [loading, setLoading] = useState(true)
  const [contactsLoading, setContactsLoading] = useState(false)
  const [emailConnected, setEmailConnected] = useState(false)
  const [spotifyConnected, setSpotifyConnected] = useState(false)
  const [swipeLoading, setSwipeLoading] = useState<string | null>(null)
  const [inviteLoading, setInviteLoading] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const [match, setMatch] = useState<Match | null>(null)
  const [bellStatus, setBellStatus] = useState<BellStatus>('off')
  const [dailyCap, setDailyCap] = useState(false)
  const tokenClientRef = useRef<{ requestAccessToken: () => void } | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  function handleLogout() {
    localStorage.removeItem('anlan_user_id')
    localStorage.removeItem('anlan_user_name')
    localStorage.removeItem('anlan_match_id')
    router.push('/')
  }

  // Handle Spotify OAuth callback (token in URL hash)
  useEffect(() => {
    const hash = window.location.hash
    if (!hash.includes('access_token')) return
    const params = new URLSearchParams(hash.slice(1))
    const token = params.get('access_token')
    if (!token) return
    window.history.replaceState(null, '', window.location.pathname)

    const userId = localStorage.getItem('anlan_user_id')
    if (!userId) return

    async function saveSpotify() {
      try {
        const [artistsRes, tracksRes] = await Promise.all([
          fetch('https://api.spotify.com/v1/me/top/artists?limit=10&time_range=medium_term', {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch('https://api.spotify.com/v1/me/top/tracks?limit=10&time_range=medium_term', {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ])
        const [artistsData, tracksData] = await Promise.all([artistsRes.json(), tracksRes.json()])
        const top_artists = (artistsData.items ?? []).map((a: { name: string; genres: string[] }) => a.name)
        const top_tracks = (tracksData.items ?? []).map((t: { name: string; artists: { name: string }[] }) => `${t.name} — ${t.artists[0]?.name}`)
        const genres = [...new Set((artistsData.items ?? []).flatMap((a: { genres: string[] }) => a.genres))].slice(0, 8)
        await supabase.from('users').update({ spotify_interests: { top_artists, top_tracks, genres } }).eq('id', userId)
        setSpotifyConnected(true)
        showToast('🎵 Spotify connected!')
      } catch {
        showToast('Failed to connect Spotify')
      }
    }
    saveSpotify()
  }, [])

  // Bell: geolocation → update user_presence every 30s
  useEffect(() => {
    const userId = localStorage.getItem('anlan_user_id')
    if (!userId || !navigator.geolocation) return

    async function updatePresence(lat: number, lng: number) {
      await supabase.from('user_presence').upsert(
        { user_id: userId, lat, lng, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      )
      setBellStatus(s => s === 'triggered' ? s : 'watching')
    }

    navigator.geolocation.getCurrentPosition(
      pos => updatePresence(pos.coords.latitude, pos.coords.longitude),
      () => setBellStatus('off')
    )

    const interval = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        pos => updatePresence(pos.coords.latitude, pos.coords.longitude),
        () => {}
      )
    }, 30000)

    return () => clearInterval(interval)
  }, [])

  // Bell: listen for proximity notifications
  useEffect(() => {
    const userId = localStorage.getItem('anlan_user_id')
    if (!userId) return

    const chan = supabase.channel('bell-' + userId)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `to_user=eq.${userId}` },
        (payload) => {
          const notif = payload.new as Notification
          if (notif.type === 'bell') {
            setBellStatus('triggered')
            showToast(notif.message || 'Someone nearby likes you 🍁')
            setTimeout(() => setBellStatus(s => s === 'triggered' ? 'watching' : s), 10000)
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(chan) }
  }, [])

  // Load Google Identity Services script
  useEffect(() => {
    if (document.getElementById('gis-script')) return
    const script = document.createElement('script')
    script.id = 'gis-script'
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    document.head.appendChild(script)
  }, [])

  // Load main data
  useEffect(() => {
    const userId = localStorage.getItem('anlan_user_id')
    if (!userId) { router.push('/'); return }

    async function load() {
      setLoading(true)
      try {
        const todayStart = new Date()
        todayStart.setUTCHours(0, 0, 0, 0)

        const [{ data: me }, { data: all }, { data: swiped }, { data: admirers }, { count: swipedToday }] = await Promise.all([
          supabase.from('users').select('*').eq('id', userId).single(),
          supabase.from('users').select('*').neq('id', userId),
          supabase.from('swipes').select('to_user,sentiment,created_at').eq('from_user', userId),
            // Who already liked me? (fetched but not exposed to UI — mutual match only)
          supabase.from('swipes').select('from_user').eq('to_user', userId).eq('sentiment', 'like'),
          // How many swipes today?
          supabase.from('swipes').select('*', { count: 'exact', head: true })
            .eq('from_user', userId).gte('created_at', todayStart.toISOString()),
        ])

        if (!me) { router.push('/'); return }
        setCurrentUser(me)
        setAllUsers(all ?? [])

        // 10/day cap — only applies if there are enough users to be meaningful
        if ((swipedToday ?? 0) >= 10 && (all?.length ?? 0) > 10) {
          setDailyCap(true)
          return
        }

        const swipedIds = buildSwipedSet(
          (swiped ?? []) as { to_user: string; sentiment: 'like' | 'dislike' | 'neutral' | 'pass'; created_at: string }[]
        )
        const totalUserCount = (all?.length ?? 0) + 1 // +1 for current user
        const feedResult = buildFeed(me, all ?? [], swipedIds, new Set(), totalUserCount)
        console.log('[feed] me:', me?.id, 'all:', all?.length, 'total:', totalUserCount, 'feed:', feedResult.length, 'swiped:', swipedIds.size)
        setFeed(feedResult)
      } catch (err) {
        console.error('[feed] load error:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [router])

  // Realtime match subscription — instant in demo mode (status='released' on insert)
  useEffect(() => {
    const userId = localStorage.getItem('anlan_user_id')
    if (!userId) return
    const onMatch = (payload: { new: Match }) => {
      if (payload.new.status === 'released') setMatch(payload.new)
    }
    const chanA = supabase.channel('match-a')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matches', filter: `user_a=eq.${userId}` }, onMatch)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `user_a=eq.${userId}` }, onMatch)
      .subscribe()
    const chanB = supabase.channel('match-b')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matches', filter: `user_b=eq.${userId}` }, onMatch)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `user_b=eq.${userId}` }, onMatch)
      .subscribe()
    return () => { supabase.removeChannel(chanA); supabase.removeChannel(chanB) }
  }, [])

  useEffect(() => {
    if (match) {
      localStorage.setItem('anlan_match_id', match.id)
      router.push('/match')
    }
  }, [match, router])

  async function fetchContacts(accessToken: string) {
    setContactsLoading(true)
    try {
      // Fetch Google Contacts via People API
      const res = await fetch(
        'https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses&pageSize=500&sortOrder=FIRST_NAME_ASCENDING',
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      const data = await res.json()
      const connections: EmailContact[] = (data.connections ?? [])
        .map((p: { names?: { displayName: string }[]; emailAddresses?: { value: string }[] }) => ({
          name: p.names?.[0]?.displayName ?? '',
          email: p.emailAddresses?.[0]?.value?.toLowerCase() ?? '',
        }))
        .filter((c: EmailContact) => c.name && c.email)

      const swipedIds = new Set(
        (await supabase.from('swipes').select('to_user').eq('from_user', currentUser?.id ?? ''))
          .data?.map((s: { to_user: string }) => s.to_user) ?? []
      )

      const emailToUser = new Map(allUsers.map((u) => [u.email.toLowerCase(), u]))
      const myEmail = currentUser?.email.toLowerCase() ?? ''

      const onMaple: ClassmateOnMaple[] = []
      const offMaple: ContactNotOnMaple[] = []

      for (const contact of connections) {
        if (contact.email === myEmail) continue
        const mapleUser = emailToUser.get(contact.email)
        if (mapleUser && !swipedIds.has(mapleUser.id)) {
          onMaple.push({
            user: mapleUser,
            score: 10,
            hint: `You know each other`,
            contactName: contact.name,
          })
        } else if (!mapleUser) {
          offMaple.push({ ...contact, invited: false })
        }
      }

      setKnownOnMaple(onMaple)
      setKnownOff(offMaple.slice(0, 20)) // cap at 20 for invite list
      setEmailConnected(true)
    } catch {
      showToast('Failed to read contacts')
    } finally {
      setContactsLoading(false)
    }
  }

  function connectSpotify() {
    const clientId = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID
    if (!clientId) { showToast('Spotify not configured'); return }
    const redirectUri = encodeURIComponent(window.location.origin + '/feed')
    const scope = encodeURIComponent('user-top-read')
    window.location.href = `https://accounts.spotify.com/authorize?client_id=${clientId}&response_type=token&redirect_uri=${redirectUri}&scope=${scope}`
  }

  function connectEmail() {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    if (!clientId) { showToast('Google not configured'); return }

    if (!window.google) {
      showToast('Loading Google... try again')
      return
    }

    tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/contacts.readonly',
      callback: (resp) => {
        if (resp.access_token) fetchContacts(resp.access_token)
        else showToast('Google sign-in cancelled')
      },
    })
    tokenClientRef.current.requestAccessToken()
  }

  const swipe = useCallback(async (targetId: string, sentiment: Sentiment, isKnown = false) => {
    const userId = localStorage.getItem('anlan_user_id')
    if (!userId || swipeLoading) return
    setSwipeLoading(targetId + sentiment)
    try {
      const { error } = await supabase.from('swipes')
        .upsert({ from_user: userId, to_user: targetId, sentiment }, { onConflict: 'from_user,to_user' })
      if (error) { showToast('Something went wrong.'); return }
      if (sentiment === 'like') showToast('❤️ shot sent')
      if (sentiment === 'pass') showToast('👋 gone for 30 days')
      if (sentiment === 'block') showToast('🚫 blocked — they\'re gone for good')
      if (isKnown) setKnownOnMaple((f) => f.filter((c) => c.user.id !== targetId))
      else setFeed((f) => f.filter((c) => c.user.id !== targetId))
    } catch {
      showToast('Something went wrong.')
    } finally {
      setSwipeLoading(null)
    }
  }, [swipeLoading])

  const sendInvite = useCallback(async (contact: ContactNotOnMaple) => {
    if (inviteLoading || !currentUser) return
    setInviteLoading(contact.email)
    try {
      await fetch('/api/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to_email: contact.email,
          to_name: contact.name,
          from_name: currentUser.name,
          course_name: 'your network',
        }),
      })
      setKnownOff((prev) => prev.map((c) => c.email === contact.email ? { ...c, invited: true } : c))
      showToast(`✉️ Invited ${contact.name.split(' ')[0]}`)
    } catch {
      showToast('Failed to send invite')
    } finally {
      setInviteLoading(null)
    }
  }, [inviteLoading, currentUser])

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#f8f7f4]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-[#111] border-t-transparent animate-spin" />
          <p className="text-sm text-[#9b9590]">Loading...</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#f8f7f4]">
      <div className="max-w-[420px] mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xl leading-none">🍁</span>
              <h1 className="text-lg font-semibold text-[#111]">Maple</h1>
            </div>
            <p className="text-xs text-[#9b9590]">your crush is probably here 👀</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Bell icon — 3 states */}
            <button
              title={
                bellStatus === 'off' ? 'turn on to get notified when your crush is nearby' :
                bellStatus === 'triggered' ? 'omg someone nearby likes you 👀' : 'active — watching for your people'
              }
              className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[#eeeae4] transition-colors"
            >
              <span className={`text-base transition-all ${
                bellStatus === 'off' ? 'opacity-25 grayscale' :
                bellStatus === 'triggered' ? 'animate-bounce' : ''
              }`}>
                🔔
              </span>
            </button>
            {currentUser && (
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold ${avatarColor(currentUser.id)}`}>
                {currentUser.name[0].toUpperCase()}
              </div>
            )}
            <button
              onClick={handleLogout}
              className="text-xs text-[#9b9590] hover:text-[#111] transition-colors px-2 py-1 rounded-lg hover:bg-[#eeeae4]"
            >
              Log out
            </button>
          </div>
        </div>

        {/* Connect email banner */}
        {!emailConnected && !contactsLoading && (
          <button
            onClick={connectEmail}
            className="w-full mb-5 flex items-center gap-3 bg-white border border-[#e8e6e1] rounded-2xl px-4 py-3.5 text-left hover:border-[#111] transition-colors group"
          >
            <div className="w-9 h-9 rounded-full bg-[#f0ede8] flex items-center justify-center shrink-0 group-hover:bg-[#eeeae4] transition-colors">
              <span className="text-base">✉️</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-[#111]">connect your email</p>
              <p className="text-xs text-[#9b9590]">see if your people are already here 👀</p>
            </div>
            <span className="text-xs text-[#9b9590] shrink-0">→</span>
          </button>
        )}

        {/* Spotify connect banner */}
        {!spotifyConnected && (
          <button
            onClick={connectSpotify}
            className="w-full mb-3 flex items-center gap-3 bg-white border border-[#e8e6e1] rounded-2xl px-4 py-3.5 text-left hover:border-[#1DB954] transition-colors group"
          >
            <div className="w-9 h-9 rounded-full bg-[#f0fdf4] flex items-center justify-center shrink-0">
              <span className="text-base">🎵</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-[#111]">connect Spotify</p>
              <p className="text-xs text-[#9b9590]">match on music taste too? yes please 🎵</p>
            </div>
            <span className="text-xs text-[#9b9590] shrink-0">→</span>
          </button>
        )}

        {contactsLoading && (
          <div className="flex items-center gap-2 text-xs text-[#9b9590] mb-5 px-1">
            <div className="w-3 h-3 rounded-full border border-[#9b9590] border-t-transparent animate-spin" />
            checking who you know...
          </div>
        )}

        {/* Action legend */}
        {(feed.length > 0 || knownOnMaple.length > 0) && (
          <div className="flex items-center justify-center gap-3 mb-4 px-1">
            <span className="text-[10px] text-[#9b9590]">🍁 <span className="font-medium text-[#6b6760]">shoot your shot</span> — only they'll know</span>
            <span className="text-[#ddd]">·</span>
            <span className="text-[10px] text-[#9b9590]">👋 <span className="font-medium text-[#6b6760]">not for me</span> — 30-day break</span>
            <span className="text-[#ddd]">·</span>
            <span className="text-[10px] text-[#9b9590]">🚫 block — forever</span>
          </div>
        )}

        <div className="space-y-6 animate-fade-up">

          {/* People you know on Maple */}
          {knownOnMaple.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3 px-1">
                <span className="text-xs font-semibold text-[#111]">👋 people you actually know</span>
                <span className="text-xs text-[#9b9590]">— already on Maple</span>
              </div>
              <div className="space-y-3">
                {knownOnMaple.map((card) => (
                  <KnownCard
                    key={card.user.id}
                    card={card}
                    swipeLoading={swipeLoading}
                    onSwipe={(s) => swipe(card.user.id, s, true)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Regular anonymous feed */}
          {feed.length > 0 && (
            <section>
              {knownOnMaple.length > 0 && (
                <div className="flex items-center gap-2 mb-3 px-1">
                  <span className="text-xs font-semibold text-[#111]">✦ might know them</span>
                  <span className="text-xs text-[#9b9590]">— same campus, just sayin</span>
                </div>
              )}
              <div className="space-y-3">
                {feed.map((card) => (
                  <AnonymousCard
                    key={card.user.id}
                    card={card}
                    swipeLoading={swipeLoading}
                    onSwipe={(s) => swipe(card.user.id, s, false)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Invite contacts not on Maple */}
          {knownOff.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3 px-1">
                <span className="text-xs font-semibold text-[#111]">✉️ get your friends in on this</span>
                <span className="text-xs text-[#9b9590]">— they're missing out fr</span>
              </div>
              <div className="space-y-2">
                {knownOff.map((c) => (
                  <div key={c.email} className="bg-white rounded-2xl border border-[#e8e6e1] px-4 py-3 flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${nameColor(c.name)}`}>
                      {c.name[0].toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[#111] truncate">{c.name}</p>
                      <p className="text-xs text-[#9b9590] truncate">{c.email}</p>
                    </div>
                    <button
                      onClick={() => sendInvite(c)}
                      disabled={c.invited || inviteLoading === c.email}
                      className={`shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${
                        c.invited ? 'bg-[#f0ede8] text-[#9b9590]' : 'bg-[#111] text-white active:scale-95'
                      }`}
                    >
                      {c.invited ? 'sent ✓' : inviteLoading === c.email ? '···' : 'invite 🍁'}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Daily cap empty state */}
          {dailyCap && (
            <div className="flex flex-col items-center justify-center text-center py-20 gap-3">
              <div className="text-4xl mb-1">✨</div>
              <p className="text-sm font-medium text-[#111]">you&apos;ve seen the whole roster bestie</p>
              <p className="text-xs text-[#9b9590] max-w-[220px] leading-relaxed">
                new drops every Friday night 🍁 go touch some grass in the meantime
              </p>
            </div>
          )}

          {/* Empty state */}
          {!dailyCap && !contactsLoading && feed.length === 0 && knownOnMaple.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center py-20 gap-3">
              <div className="text-4xl mb-1">🌙</div>
              <p className="text-sm font-medium text-[#111]">no one new rn 😴</p>
              <p className="text-xs text-[#9b9590] max-w-[220px] leading-relaxed">
                tell your friends to get on here already
              </p>
            </div>
          )}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-[#111] text-white text-xs px-4 py-2.5 rounded-full shadow-lg animate-fade-in whitespace-nowrap">
          {toast}
        </div>
      )}
    </main>
  )
}

function KnownCard({ card, swipeLoading, onSwipe }: {
  card: ClassmateOnMaple
  swipeLoading: string | null
  onSwipe: (s: Sentiment) => void
}) {
  return (
    <div className="relative bg-white rounded-2xl border-2 border-[#111] p-4 shadow-sm">
      <button
        onClick={() => onSwipe('block')}
        disabled={swipeLoading !== null}
        title="block this person"
        className="absolute top-3 right-3 w-6 h-6 flex items-center justify-center rounded-full text-[#c5c0bb] hover:text-red-400 hover:bg-red-50 transition-all disabled:opacity-40 text-xs"
      >
        🚫
      </button>
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-11 h-11 rounded-full flex items-center justify-center text-base font-semibold shrink-0 ${nameColor(card.user.name)}`}>
          {card.user.name[0].toUpperCase()}
        </div>
        <div className="min-w-0 pr-6">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-[#111]">{card.user.name}</p>
            <span className="text-[10px] bg-[#111] text-white px-1.5 py-0.5 rounded-full">u know them 👀</span>
          </div>
          <p className="text-xs text-[#9b9590]">
            {card.user.gender}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 bg-[#f0ede8] rounded-xl px-3 py-2 mb-4">
        <span className="text-xs">👋</span>
        <span className="text-xs text-[#6b6760]">{card.hint}</span>
      </div>
      <div className="flex gap-2">
        <button onClick={() => onSwipe('pass')} disabled={swipeLoading !== null}
          className="flex-1 py-2.5 rounded-xl border border-[#e8e6e1] text-xs font-medium text-[#9b9590] disabled:opacity-40 active:scale-95 transition-all">
          {swipeLoading === card.user.id + 'pass' ? '···' : 'not for me'}
        </button>
        <button onClick={() => onSwipe('like')} disabled={swipeLoading !== null}
          className="flex-1 py-2.5 rounded-xl bg-[#111] text-white text-xs font-medium disabled:opacity-40 active:scale-95 transition-all">
          {swipeLoading === card.user.id + 'like' ? '···' : '🍁 shoot your shot'}
        </button>
      </div>
    </div>
  )
}

function AnonymousCard({ card, swipeLoading, onSwipe }: {
  card: FeedCard
  swipeLoading: string | null
  onSwipe: (s: Sentiment) => void
}) {
  return (
    <div className="relative bg-white rounded-2xl border border-[#e8e6e1] p-4 shadow-sm">
      <button
        onClick={() => onSwipe('block')}
        disabled={swipeLoading !== null}
        title="block this person"
        className="absolute top-3 right-3 w-6 h-6 flex items-center justify-center rounded-full text-[#c5c0bb] hover:text-red-400 hover:bg-red-50 transition-all disabled:opacity-40 text-xs"
      >
        🚫
      </button>
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-11 h-11 rounded-full flex items-center justify-center text-base font-semibold shrink-0 ${avatarColor(card.user.id)}`}>
          {card.user.name[0].toUpperCase()}
        </div>
        <div className="min-w-0 pr-6">
          <p className="text-sm font-medium text-[#111]">{card.user.name}</p>
          <p className="text-xs text-[#9b9590]">
            {card.user.gender}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 bg-[#f8f7f4] rounded-xl px-3 py-2 mb-4">
        <span className="text-xs">✦</span>
        <span className="text-xs text-[#6b6760]">{card.hint}</span>
      </div>
      <div className="flex gap-2">
        <button onClick={() => onSwipe('pass')} disabled={swipeLoading !== null}
          className="flex-1 py-2.5 rounded-xl border border-[#e8e6e1] text-xs font-medium text-[#9b9590] disabled:opacity-40 active:scale-95 transition-all">
          {swipeLoading === card.user.id + 'pass' ? '···' : 'not for me'}
        </button>
        <button onClick={() => onSwipe('like')} disabled={swipeLoading !== null}
          className="flex-1 py-2.5 rounded-xl bg-[#111] text-white text-xs font-medium disabled:opacity-40 active:scale-95 transition-all">
          {swipeLoading === card.user.id + 'like' ? '···' : '🍁 shoot your shot'}
        </button>
      </div>
    </div>
  )
}
