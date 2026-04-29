'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Match, DateCard, User, AgentStep } from '@/types'

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


const DEMO_STEPS = [
  'Match detected',
  'Fetching profiles',
  'Reading calendars & parsing schedules',
  'Finding best venue',
  'Generating date plan',
  'Sending confirmation',
]

type Screen = 'reveal' | 'loading' | 'datecard' | 'confirmed'

export default function MatchPage() {
  const router = useRouter()
  const [screen, setScreen] = useState<Screen>('reveal')
  const [match, setMatch] = useState<Match | null>(null)
  const [me, setMe] = useState<User | null>(null)
  const [them, setThem] = useState<User | null>(null)
  const [dateCard, setDateCard] = useState<DateCard | null>(null)
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([])
  const [simulatedStep, setSimulatedStep] = useState(0)

  useEffect(() => {
    const matchId = localStorage.getItem('anlan_match_id')
    const userId = localStorage.getItem('anlan_user_id')
    if (!matchId || !userId) { router.push('/feed'); return }

    async function load() {
      const { data } = await supabase
        .from('matches')
        .select('*, user_a_profile:users!matches_user_a_fkey(*), user_b_profile:users!matches_user_b_fkey(*)')
        .eq('id', matchId)
        .single()
      if (!data) { router.push('/feed'); return }
      setMatch(data)
      const isA = data.user_a === userId
      setMe(isA ? data.user_a_profile : data.user_b_profile)
      setThem(isA ? data.user_b_profile : data.user_a_profile)
      if (data.date_card_json) setDateCard(data.date_card_json)
    }
    load()
  }, [router])

  // Subscribe to agent step updates via Realtime
  useEffect(() => {
    const matchId = localStorage.getItem('anlan_match_id')
    if (!matchId) return

    const channel = supabase
      .channel('match-steps-' + matchId)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
        (payload) => {
          const updated = payload.new as Match
          if (updated.agent_steps) setAgentSteps(updated.agent_steps)
          if (updated.date_card_json) {
            setDateCard(updated.date_card_json)
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  // Auto-advance to datecard when agent finishes
  useEffect(() => {
    if (screen === 'loading' && dateCard) {
      setTimeout(() => setScreen('datecard'), 600)
    }
  }, [screen, dateCard])

  // Animate through demo steps when on loading screen
  useEffect(() => {
    if (screen !== 'loading') return
    setSimulatedStep(1)
    const delays = [1400, 2000, 2200, 1800, 1600]
    const timers: ReturnType<typeof setTimeout>[] = []
    let elapsed = 0
    delays.forEach((d, i) => {
      elapsed += d
      timers.push(setTimeout(() => setSimulatedStep(i + 2), elapsed))
    })
    // After all steps finish, inject the date card (if AI backend didn't respond)
    timers.push(setTimeout(() => {
      setDateCard(dc => dc ?? {
        time: 'Tomorrow 12:15 – 1:00 PM',
        venue: 'Student Center Coffee Bar',
        walk_minutes: 6,
        shared_context: 'You\'re both on the same campus — easiest first step.',
        reasoning: 'Lunch break is the overlap both schedules share. Coffee bar is low-key, no pressure.',
        icebreaker: 'What\'s the most unexpectedly good thing you\'ve found on campus?',
      })
    }, elapsed + 600))
    return () => timers.forEach(clearTimeout)
  }, [screen])

  function handleArrange() {
    setScreen('loading')
  }

  function markMatchHandled(matchId: string) {
    const handled: string[] = JSON.parse(localStorage.getItem('anlan_matches_handled') ?? '[]')
    if (!handled.includes(matchId)) {
      localStorage.setItem('anlan_matches_handled', JSON.stringify([...handled, matchId]))
    }
    localStorage.removeItem('anlan_match_id')
  }

  async function handleConfirm() {
    const matchId = localStorage.getItem('anlan_match_id')
    if (matchId) {
      await supabase.from('matches').update({ status: 'confirmed' }).eq('id', matchId)
      markMatchHandled(matchId)
    }
    setScreen('confirmed')
  }

  async function handleCancel() {
    const matchId = localStorage.getItem('anlan_match_id')
    if (!matchId) return
    const { data } = await supabase.from('matches').select('cancel_count').eq('id', matchId).single()
    const newCount = (data?.cancel_count ?? 0) + 1
    await supabase.from('matches').update({ cancel_count: newCount, status: 'cancelled' }).eq('id', matchId)
    markMatchHandled(matchId)
    if (newCount >= 3) {
      alert('You\'ve cancelled 3 dates. Your account is paused for 1 week.')
    }
    router.push('/feed')
  }

  if (!me || !them) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#f8f7f4]">
        <div className="w-7 h-7 rounded-full border-2 border-[#111] border-t-transparent animate-spin" />
      </main>
    )
  }

  // ── Screen 3: Match reveal ────────────────────────────────────────────────
  if (screen === 'reveal') {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-6 bg-[#f8f7f4]">
        <div className="w-full max-w-[360px] text-center animate-scale-in">

          <div className="mb-8">
            <div className="text-5xl mb-4">🎉</div>
            <h1 className="text-2xl font-semibold text-[#111] mb-1">it&apos;s giving mutual 🍁</h1>
            <p className="text-sm text-[#9b9590]">you both shot your shot. respect.</p>
          </div>

          {/* Avatar pair */}
          <div className="flex items-center justify-center gap-5 mb-8">
            <div className="flex flex-col items-center gap-2">
              <div className={`w-[60px] h-[60px] rounded-full flex items-center justify-center text-xl font-semibold ${avatarColor(me.id)}`}>
                {me.name[0].toUpperCase()}
              </div>
              <span className="text-xs text-[#9b9590]">{me.gender}</span>
            </div>
            <div className="text-red-400 text-xl">❤</div>
            <div className="flex flex-col items-center gap-2">
              <div className={`w-[60px] h-[60px] rounded-full flex items-center justify-center text-xl font-semibold ${avatarColor(them.id)}`}>
                {them.name[0].toUpperCase()}
              </div>
              <span className="text-xs text-[#9b9590]">{them.gender}</span>
            </div>
          </div>

          {/* Identity reveal card */}
          <div className="bg-white rounded-2xl border border-[#e8e6e1] px-5 py-4 mb-6 text-left">
            <p className="text-xs text-[#9b9590] mb-1">your person 🫶</p>
            <p className="text-base font-semibold text-[#111]">{them.name}</p>
            <p className="text-sm text-[#9b9590]">{them.gender}</p>
          </div>

          <button
            onClick={handleArrange}
            className="w-full bg-[#111] text-white rounded-xl py-3.5 text-sm font-medium active:scale-[0.98] transition-transform"
          >
            let AI cook the date →
          </button>
          <p className="text-xs text-[#c5c0bb] mt-4">they found out at the exact same time 👀</p>
        </div>
      </main>
    )
  }

  // ── Loading: Agent steps ──────────────────────────────────────────────────
  if (screen === 'loading') {
    const displaySteps: AgentStep[] = agentSteps.length > 0 ? agentSteps : DEMO_STEPS.map((label, i) => ({
      label,
      status: i < simulatedStep ? 'done' : i === simulatedStep ? 'running' : 'pending',
      ts: i < simulatedStep ? new Date().toISOString() : '',
    }))

    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-6 bg-[#f8f7f4]">
        <div className="w-full max-w-[340px] animate-fade-up">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-black mb-4">
              <span className="text-xl">🤖</span>
            </div>
            <h2 className="text-base font-semibold text-[#111]">AI is literally cooking rn</h2>
            <p className="text-xs text-[#9b9590] mt-1">planning something just for you two ✨</p>
          </div>

          <div className="space-y-2">
            {displaySteps.map((step, i) => (
              <div
                key={i}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all duration-300 ${
                  step.status === 'done'    ? 'bg-white border-[#e8e6e1]' :
                  step.status === 'running' ? 'bg-white border-[#111] shadow-sm' :
                  step.status === 'error'   ? 'bg-red-50 border-red-200' :
                  'bg-[#fafaf8] border-[#f0ede8]'
                }`}
                style={{ animationDelay: `${i * 80}ms` }}
              >
                {/* Icon */}
                <div className="w-5 h-5 shrink-0 flex items-center justify-center">
                  {step.status === 'done'    && <span className="text-emerald-500 text-sm">✓</span>}
                  {step.status === 'running' && (
                    <div className="w-3.5 h-3.5 rounded-full border-2 border-[#111] border-t-transparent animate-spin" />
                  )}
                  {step.status === 'error'   && <span className="text-red-400 text-sm">✕</span>}
                  {step.status === 'pending' && <div className="w-1.5 h-1.5 rounded-full bg-[#ddd]" />}
                </div>

                {/* Label */}
                <span className={`text-xs font-medium ${
                  step.status === 'done'    ? 'text-[#6b6760]' :
                  step.status === 'running' ? 'text-[#111]' :
                  step.status === 'error'   ? 'text-red-500' :
                  'text-[#c5c0bb]'
                }`}>
                  {step.label}
                </span>

                {/* Timestamp */}
                {step.status === 'done' && step.ts && (
                  <span className="ml-auto text-[10px] text-[#c5c0bb]">
                    {new Date(step.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                )}
                {step.status === 'running' && (
                  <span className="ml-auto text-[10px] text-[#9b9590] animate-pulse">now</span>
                )}
              </div>
            ))}
          </div>

          <p className="text-center text-xs text-[#c5c0bb] mt-6">
            give it ~10 seconds, we&apos;re not doing this mid 💅
          </p>
        </div>
      </main>
    )
  }

  // ── Screen 4: Date card ───────────────────────────────────────────────────
  if (screen === 'datecard' && dateCard) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-6 bg-[#f8f7f4]">
        <div className="w-full max-w-[360px] animate-scale-in">

          <div className="text-center mb-6">
            <div className="text-3xl mb-3">📅</div>
            <h1 className="text-xl font-semibold text-[#111]">the date is cooked. 🍁</h1>
            <p className="text-sm text-[#9b9590] mt-1">personalized to both your schedules, no cap.</p>
          </div>

          {/* Date card */}
          <div className="bg-white rounded-2xl border border-[#e8e6e1] overflow-hidden mb-5 shadow-sm">
            <div className="px-5 py-4 border-b border-[#f0ede8]">
              <div className="flex items-center gap-3">
                <span className="text-xl">📅</span>
                <div>
                  <p className="text-xs text-[#9b9590] mb-0.5">When</p>
                  <p className="text-sm font-semibold text-[#111]">{dateCard.time}</p>
                </div>
              </div>
            </div>
            <div className="border-b border-[#f0ede8]">
              <div className="flex items-center gap-3 px-5 py-4">
                <span className="text-xl">📍</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-[#9b9590] mb-0.5">Where</p>
                  <p className="text-sm font-semibold text-[#111]">{dateCard.venue}</p>
                  <p className="text-xs text-[#9b9590]">~{dateCard.walk_minutes} min walk each</p>
                  {'maps_url' in dateCard && dateCard.maps_url && (
                    <a
                      href={dateCard.maps_url as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-500 underline mt-0.5 inline-block"
                    >
                      open in maps →
                    </a>
                  )}
                </div>
              </div>
              {'static_map' in dateCard && dateCard.static_map && (
                <img
                  src={dateCard.static_map as string}
                  alt="venue map"
                  className="w-full h-32 object-cover"
                />
              )}
            </div>
            <div className="px-5 py-4 border-b border-[#f0ede8]">
              <div className="flex items-center gap-3">
                <span className="text-xl">✦</span>
                <div>
                  <p className="text-xs text-[#9b9590] mb-0.5">What you have in common</p>
                  <p className="text-sm text-[#111]">{dateCard.shared_context}</p>
                </div>
              </div>
            </div>
            <div className="px-5 py-4 border-b border-[#f0ede8]">
              <div className="flex items-center gap-3">
                <span className="text-xl">💬</span>
                <div>
                  <p className="text-xs text-[#9b9590] mb-0.5">Conversation starter</p>
                  <p className="text-sm italic text-[#6b6760]">&ldquo;{dateCard.icebreaker}&rdquo;</p>
                </div>
              </div>
            </div>
            <div className="px-5 py-3 bg-[#fafaf8]">
              <p className="text-xs text-[#9b9590] leading-relaxed">{dateCard.reasoning}</p>
            </div>
          </div>

          <div className="space-y-2.5">
            <button
              onClick={handleConfirm}
              className="w-full bg-[#111] text-white rounded-xl py-3.5 text-sm font-medium active:scale-[0.98] transition-transform"
            >
              i&apos;m in, let&apos;s go ✓
            </button>
            <button
              onClick={handleCancel}
              className="w-full border border-[#e8e6e1] rounded-xl py-3 text-sm text-[#9b9590] active:scale-[0.98] transition-transform"
            >
              nah not feeling it
            </button>
            <p className="text-center text-[10px] text-[#c5c0bb]">ghost 3x and you&apos;re benched for a week 💀</p>
          </div>
        </div>
      </main>
    )
  }

  // ── Confirmed ─────────────────────────────────────────────────────────────
  if (screen === 'confirmed') {
    const mapsUrl = dateCard && 'maps_url' in dateCard && dateCard.maps_url
      ? dateCard.maps_url as string
      : dateCard
        ? `https://maps.google.com/?q=${encodeURIComponent(dateCard.venue + ' Claremont CA')}`
        : null

    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-6 bg-[#f8f7f4]">
        <div className="w-full max-w-[360px] text-center animate-scale-in">
          <div className="text-5xl mb-4">🌟</div>
          <h1 className="text-xl font-semibold text-[#111] mb-2">it&apos;s happening bestie 🎉</h1>
          {dateCard && (
            <p className="text-sm text-[#9b9590] mb-1">{dateCard.time} · {dateCard.venue}</p>
          )}
          <p className="text-xs text-[#c5c0bb] mb-8">both of you confirmed. don&apos;t be late 😤</p>

          {/* Navigation prompt */}
          {mapsUrl && dateCard && (
            <div className="bg-white border border-[#e8e6e1] rounded-2xl p-4 mb-4 text-left">
              <p className="text-sm font-medium text-[#111] mb-1">want directions? 🗺️</p>
              <p className="text-xs text-[#9b9590] mb-3">navigate straight to {dateCard.venue}</p>
              <div className="flex gap-2">
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 bg-[#111] text-white rounded-xl py-3 text-xs font-medium active:scale-[0.98] transition-transform"
                >
                  <span>🗺️</span> Google Maps
                </a>
                <a
                  href={`maps://maps.apple.com/?q=${encodeURIComponent(dateCard.venue + ' Claremont CA')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 bg-white border border-[#e8e6e1] text-[#111] rounded-xl py-3 text-xs font-medium active:scale-[0.98] transition-transform"
                >
                  <span>🍎</span> Apple Maps
                </a>
              </div>
            </div>
          )}

          <button
            onClick={() => router.push('/feed')}
            className="w-full border border-[#e8e6e1] rounded-xl py-3 text-sm text-[#6b6760] active:scale-[0.98] transition-transform"
          >
            back to the feed
          </button>
        </div>
      </main>
    )
  }

  // ── Date card not ready yet ───────────────────────────────────────────────
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 bg-[#f8f7f4]">
      <div className="w-full max-w-[360px] text-center">
        <div className="text-4xl mb-4">⏳</div>
        <p className="text-sm text-[#9b9590] mb-6">AI is still cooking... give it a sec 🍳</p>
        <button
          onClick={() => setScreen('loading')}
          className="w-full bg-[#111] text-white rounded-xl py-3 text-sm"
        >
          Check again
        </button>
      </div>
    </main>
  )
}
