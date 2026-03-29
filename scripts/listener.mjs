/**
 * Maple — True AI Agent (MiniMax Function Calling)
 *
 * MiniMax drives the agentic loop — it decides which tools to call and when.
 * This is real tool use, not a scripted pipeline.
 *
 *   npm run listener
 */

import { createClient } from '@supabase/supabase-js'
import { IMessageSDK } from '@photon-ai/imessage-kit'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

// ─── Load .env.local ──────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '../.env.local')
const envLines = readFileSync(envPath, 'utf-8').split('\n')
for (const line of envLines) {
  const [key, ...rest] = line.split('=')
  if (key && rest.length) process.env[key.trim()] = rest.join('=').trim()
}

const SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_KEY       = process.env.SUPABASE_SERVICE_ROLE_KEY
const MINIMAX_API_KEY   = process.env.MINIMAX_API_KEY
const CANVAS_BASE_URL   = process.env.CANVAS_BASE_URL

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.error('❌  Missing Supabase env vars'); process.exit(1)
}
if (!MINIMAX_API_KEY) {
  console.error('❌  Missing MINIMAX_API_KEY in .env.local'); process.exit(1)
}

const supabaseRead  = createClient(SUPABASE_URL, SUPABASE_ANON)
const supabaseWrite = createClient(SUPABASE_URL, SERVICE_KEY || SUPABASE_ANON)

let sdk = null
let sdkFailed = false
async function getSdk() {
  if (sdkFailed) return null
  if (!sdk) {
    try {
      sdk = new IMessageSDK()
    } catch (e) {
      console.log('⚠️  iMessage unavailable (Photon init failed):', e.message.split('\n')[0])
      sdkFailed = true
      return null
    }
  }
  return sdk
}

// ─── Tool implementations ─────────────────────────────────────────────────────

async function toolGetUserProfile({ user_id }) {
  const { data, error } = await supabaseWrite.from('users').select('*').eq('id', user_id).single()
  if (error || !data) return { error: 'User not found' }
  return {
    id: data.id, name: data.name, dept: data.dept, year: data.year,
    campus: data.campus, phone: data.phone,
    canvas_token: data.canvas_token || null,
    prompt_answer: data.prompt_answer || null,
  }
}

async function toolGetCanvasSchedule({ canvas_token, base_url }) {
  const url = base_url || CANVAS_BASE_URL
  if (!canvas_token || !url) return { error: 'No Canvas token or URL. Use get_macos_calendar instead.' }
  try {
    const start = new Date().toISOString()
    const end   = new Date(Date.now() + 7 * 86400000).toISOString()
    const res = await fetch(
      `https://${url}/api/v1/calendar_events?type=event&start_date=${start}&end_date=${end}&per_page=50`,
      { headers: { Authorization: `Bearer ${canvas_token}` } }
    )
    if (!res.ok) return { error: `Canvas API ${res.status}. Use get_macos_calendar instead.` }
    const events = await res.json()
    if (!Array.isArray(events) || events.length === 0) return { events: [], note: 'No upcoming classes on Canvas' }
    return events.map(e => ({ title: e.title, start: e.start_at, end: e.end_at, location: e.location_name || 'TBD' }))
  } catch (e) {
    return { error: e.message + '. Use get_macos_calendar instead.' }
  }
}

function toolGetMacosCalendar({ days = 7 } = {}) {
  const script = `
tell application "Calendar"
  set startDate to current date
  set endDate to startDate + (${days} * days)
  set evList to {}
  repeat with cal in calendars
    try
      set evs to (every event of cal whose start date >= startDate and start date <= endDate)
      repeat with e in evs
        set evLine to (summary of e as string) & " | " & ((start date of e) as string) & " to " & ((end date of e) as string)
        set end of evList to evLine
      end repeat
    end try
  end repeat
  return evList
end tell`
  try {
    const out = execSync(`osascript << 'APPLESCRIPT'\n${script}\nAPPLESCRIPT`, { encoding: 'utf-8', timeout: 6000 })
    const trimmed = out.trim()
    if (!trimmed) return { events: [], note: 'No events found in macOS Calendar' }
    const events = trimmed.split(', ').filter(Boolean)
    return { events, count: events.length }
  } catch (e) {
    return { error: 'macOS Calendar read failed: ' + e.message.split('\n')[0] }
  }
}

function toolGetScreenTimeInterests() {
  const dbPath = `${process.env.HOME}/Library/Application Support/Knowledge/knowledgeC.db`
  const query = `SELECT ZVALUESTRING as bundle_id, ROUND(SUM(ZENDDATE - ZSTARTDATE) / 60) as minutes FROM ZOBJECT WHERE ZSTREAMNAME = '/app/usage' AND ZENDDATE IS NOT NULL AND ZSTARTDATE > (strftime('%s','now') - 978307200 - 7*86400) GROUP BY ZVALUESTRING ORDER BY minutes DESC LIMIT 20;`
  try {
    const out = execSync(`sqlite3 -readonly "${dbPath}" "${query}"`, { encoding: 'utf-8', timeout: 5000 })
    const apps = out.trim().split('\n').filter(Boolean).map(line => {
      const [bundleId, minutes] = line.split('|')
      return { bundleId: bundleId?.trim(), minutes: parseInt(minutes) || 0 }
    }).filter(a => a.bundleId && a.minutes > 0)

    // Map bundle IDs → interest categories
    const MAP = {
      music:       ['spotify', 'music', 'tidal', 'soundcloud', 'pandora', 'deezer'],
      gaming:      ['steam', 'epicgames', 'blizzard', 'roblox', 'minecraft', 'leagueoflegends', 'valorant'],
      social:      ['twitter', 'instagram', 'reddit', 'tiktok', 'snapchat', 'discord', 'telegram'],
      learning:    ['duolingo', 'khan', 'anki', 'quizlet', 'coursera', 'udemy'],
      fitness:     ['strava', 'nike', 'whoop', 'peloton', 'myfitnesspal', 'health'],
      creative:    ['figma', 'sketch', 'photoshop', 'illustrator', 'procreate', 'canva', 'blender'],
      productivity:['notion', 'obsidian', 'linear', 'airtable', 'todoist', 'slack'],
      coding:      ['xcode', 'vscode', 'cursor', 'github', 'terminal', 'iterm'],
      reading:     ['kindle', 'books', 'readwise', 'instapaper', 'pocket'],
    }
    const bundleIds = apps.map(a => a.bundleId.toLowerCase())
    const interests = Object.entries(MAP)
      .filter(([, ids]) => ids.some(id => bundleIds.some(b => b.includes(id))))
      .map(([cat]) => cat)

    return { top_apps: apps.slice(0, 10), interests, note: 'From last 7 days of Screen Time' }
  } catch (e) {
    return { error: 'Screen Time read failed — need Full Disk Access: System Settings → Privacy → Full Disk Access → Terminal ✓' }
  }
}

async function toolGetSpotifyInterests({ user_id }) {
  const { data, error } = await supabaseWrite.from('users').select('spotify_interests').eq('id', user_id).single()
  if (error || !data?.spotify_interests) return { note: 'No Spotify data for this user' }
  return data.spotify_interests
}

function toolGetCampusVenues({ vibe } = {}) {
  const venues = [
    { name: 'Main Library Lounge',         type: 'study_lounge', vibe: 'quiet',   walk_minutes: 4 },
    { name: 'East Cafeteria, 2nd Floor',   type: 'cafeteria',    vibe: 'casual',  walk_minutes: 5 },
    { name: 'Engineering Building Atrium', type: 'common_area',  vibe: 'casual',  walk_minutes: 3 },
    { name: 'Student Center Coffee Bar',   type: 'cafe',         vibe: 'cozy',    walk_minutes: 6 },
    { name: 'Science Quad Benches',        type: 'outdoor',      vibe: 'outdoor', walk_minutes: 5 },
  ]
  return vibe ? venues.filter(v => v.vibe === vibe || v.type.includes(vibe)) : venues
}

async function toolSaveDatePlan({ match_id, date_plan }) {
  const { error } = await supabaseWrite
    .from('matches').update({ date_card_json: date_plan, status: 'ready' }).eq('id', match_id)
  return error ? { error: error.message } : { success: true }
}

function normalizePhone(phone) {
  // Remove spaces, dashes, parens → "+19095068468"
  let p = phone.replace(/[\s\-().]/g, '')
  // Add +1 if no country code
  if (/^\d{10}$/.test(p)) p = '+1' + p
  // Add + if starts with 1XXXXXXXXXX
  if (/^1\d{10}$/.test(p)) p = '+' + p
  return p
}

async function toolSendIMessage({ phone, message }) {
  const imsg = await getSdk()
  if (!imsg) return { skipped: true, reason: 'iMessage not available on this machine' }
  try {
    const cleanPhone = normalizePhone(phone)
    await imsg.send(cleanPhone, message)
    return { success: true, phone: cleanPhone }
  } catch (e) {
    return { error: e.message, phone }
  }
}

// ─── Tool registry ────────────────────────────────────────────────────────────

const TOOLS = {
  get_user_profile:       toolGetUserProfile,
  get_canvas_schedule:    toolGetCanvasSchedule,
  get_macos_calendar:     toolGetMacosCalendar,
  get_screen_time:        toolGetScreenTimeInterests,
  get_spotify_interests:  toolGetSpotifyInterests,
  get_campus_venues:      toolGetCampusVenues,
  save_date_plan:         toolSaveDatePlan,
  send_imessage:          toolSendIMessage,
}

// MiniMax function definitions (OpenAI-compatible format)
const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'get_user_profile',
      description: "Get a user's profile: name, dept, year, phone, canvas_token, prompt_answer.",
      parameters: {
        type: 'object',
        properties: { user_id: { type: 'string', description: 'User UUID' } },
        required: ['user_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_canvas_schedule',
      description: "Read a student's upcoming classes from Canvas LMS (next 7 days). Use if user has canvas_token.",
      parameters: {
        type: 'object',
        properties: {
          canvas_token: { type: 'string' },
          base_url: { type: 'string', description: 'e.g. canvas.ubc.ca' },
        },
        required: ['canvas_token'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_macos_calendar',
      description: 'Read events from macOS Calendar app. Use as fallback if Canvas unavailable.',
      parameters: {
        type: 'object',
        properties: { days: { type: 'number', description: 'Days to look ahead, default 7' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_screen_time',
      description: "Read the user's macOS Screen Time data to infer their interests and hobbies (music, gaming, fitness, etc.). Call this for BOTH users to personalize the date plan and icebreaker.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_spotify_interests',
      description: "Get a user's Spotify top artists, top tracks, and music genres. Use this for both users to find shared music taste and write a better icebreaker.",
      parameters: {
        type: 'object',
        properties: { user_id: { type: 'string', description: 'User UUID' } },
        required: ['user_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_campus_venues',
      description: 'Browse available campus venues for a first date. Returns name, vibe, walk_minutes.',
      parameters: {
        type: 'object',
        properties: { vibe: { type: 'string', description: 'Filter: quiet, casual, cozy, outdoor' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_date_plan',
      description: 'Save the finalized date plan to the database so the app shows it.',
      parameters: {
        type: 'object',
        properties: {
          match_id: { type: 'string' },
          date_plan: {
            type: 'object',
            properties: {
              time:           { type: 'string', description: 'e.g. Thursday 12:15–1:00pm' },
              venue:          { type: 'string' },
              walk_minutes:   { type: 'number' },
              shared_context: { type: 'string' },
              reasoning:      { type: 'string' },
              icebreaker:     { type: 'string' },
            },
            required: ['time', 'venue', 'walk_minutes', 'shared_context', 'reasoning', 'icebreaker'],
          },
        },
        required: ['match_id', 'date_plan'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_imessage',
      description: "Send an iMessage to a user's phone via Photon SDK.",
      parameters: {
        type: 'object',
        properties: {
          phone:   { type: 'string', description: 'Phone with country code, e.g. +16045551234' },
          message: { type: 'string' },
        },
        required: ['phone', 'message'],
      },
    },
  },
]

const TOOL_LABELS = {
  get_user_profile:    'Fetching user profiles',
  get_canvas_schedule: 'Reading Canvas schedule',
  get_macos_calendar:  'Reading macOS Calendar',
  get_screen_time:        'Reading Screen Time to detect interests',
  get_spotify_interests:  'Reading Spotify music taste',
  get_campus_venues:   'Scouting campus venues',
  save_date_plan:      'Saving date plan',
  send_imessage:       'Sending iMessage',
}

// ─── MiniMax API call ─────────────────────────────────────────────────────────

async function callMiniMax(messages) {
  const res = await fetch('https://api.minimax.chat/v1/text/chatcompletion_v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MINIMAX_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'MiniMax-Text-01',
      messages,
      tools: TOOL_DEFS,
      tool_choice: 'auto',
      temperature: 0.7,
    }),
  })
  if (!res.ok) throw new Error(`MiniMax HTTP ${res.status}: ${await res.text()}`)
  return res.json()
}

// ─── Agent step tracking ──────────────────────────────────────────────────────

async function pushSteps(matchId, steps) {
  await supabaseWrite.from('matches').update({ agent_steps: steps }).eq('id', matchId)
}

// ─── Main agent handler ───────────────────────────────────────────────────────

const processing = new Set()

async function handleMatch(match) {
  if (processing.has(match.id)) return
  processing.add(match.id)
  console.log(`\n🎉 New match: ${match.id}`)

  const steps = [{ label: 'Match detected', status: 'done', ts: new Date().toISOString() }]
  await pushSteps(match.id, steps)

  const messages = [
    {
      role: 'system',
      content: `You are Maple, an AI dating coordinator for a campus dating app. You have tools to fetch user profiles, read class schedules, read Screen Time data (to detect interests like music/gaming/fitness), browse campus venues, save a date plan, and send iMessages. Use these tools step by step to coordinate a date. Always read Screen Time for both users to understand their hobbies — use this to pick the best venue vibe and write a highly personalized icebreaker.`,
    },
    {
      role: 'user',
      content: `A mutual match just happened!
Match ID: ${match.id}
User A ID: ${match.user_a}
User B ID: ${match.user_b}
Today: ${new Date().toDateString()}

Steps:
1. Fetch both profiles
2. Read Screen Time for both users to detect their interests
3. Get their schedules (use macOS Calendar)
4. Browse campus venues — pick one that matches their shared interests
5. Find a real free slot in the next 5 days (avoid class times)
6. Save the date plan
7. Send each person a personal iMessage with their name, the time, place, and a highly specific icebreaker based on their shared interests`,
    },
  ]

  let timedOut = false
  const agentTimer = setTimeout(() => { timedOut = true }, 5 * 60 * 1000)
  try {
    // True agentic loop — MiniMax decides what to do next
    let iterations = 0
    while (iterations < 20 && !timedOut) {
      iterations++
      const data = await callMiniMax(messages)
      const msg = data?.choices?.[0]?.message

      if (!msg) throw new Error('Empty response from MiniMax')

      // Log any text content
      if (msg.content && typeof msg.content === 'string' && msg.content.trim()) {
        console.log(`  💭 ${msg.content.slice(0, 120)}`)
      }

      // Check for tool calls
      const toolCalls = msg.tool_calls
      if (!toolCalls || toolCalls.length === 0) {
        console.log('  ✅ Agent done')
        break
      }

      // Add assistant message to history
      messages.push({ role: 'assistant', content: msg.content || '', tool_calls: toolCalls })

      // Execute each tool call
      for (const tc of toolCalls) {
        const fnName = tc.function?.name
        const label  = TOOL_LABELS[fnName] || fnName
        console.log(`  🔧 ${label}`)

        steps.push({ label, status: 'running', ts: new Date().toISOString() })
        await pushSteps(match.id, steps)

        let input = {}
        try { input = JSON.parse(tc.function?.arguments || '{}') } catch {}

        const fn = TOOLS[fnName]
        const result = fn ? await fn(input) : { error: `Unknown tool: ${fnName}` }

        steps[steps.length - 1] = { label, status: 'done', ts: new Date().toISOString() }
        await pushSteps(match.id, steps)

        console.log(`     ↳ ${JSON.stringify(result).slice(0, 100)}`)

        // Feed result back to MiniMax
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: fnName,
          content: JSON.stringify(result),
        })
      }
    }
    if (timedOut) throw new Error('Agent timed out after 5 minutes')
  } catch (e) {
    console.error('  ↳ Agent error:', e.message)
    steps.push({ label: 'Error: ' + e.message, status: 'error', ts: new Date().toISOString() })
    await pushSteps(match.id, steps)
  } finally {
    clearTimeout(agentTimer)
    processing.delete(match.id)
  }
}

// ─── Realtime subscription ────────────────────────────────────────────────────

function subscribe() {
  // Demo mode: matches are created with status='released' immediately (no Friday wait)
  // Listen for INSERT (new mutual match) and UPDATE (legacy pending→released)
  supabaseRead
    .channel('matches-listener')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matches' }, (payload) => {
      if (payload.new.status === 'released') {
        handleMatch(payload.new)
      }
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches' }, (payload) => {
      if (payload.new.status === 'released' && payload.old.status === 'pending') {
        handleMatch(payload.new)
      }
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') console.log('✅  Listening for matches (instant release mode)...\n')
      else if (status === 'CHANNEL_ERROR') {
        console.error('❌  Realtime error — reconnecting in 3s')
        setTimeout(subscribe, 3000)
      }
    })
}

// ─── Bell: proximity detection ────────────────────────────────────────────────

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Debounce: don't notify same liker→liked pair more than once per hour
const bellDebounce = new Map() // key: `${liker_id}:${liked_id}` → timestamp

function watchPresence() {
  supabaseRead
    .channel('presence-watcher')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'user_presence' }, async (payload) => {
      const mover = payload.new
      if (!mover.lat || !mover.lng || !mover.user_id) return

      // Who already liked this person?
      const { data: likers } = await supabaseWrite
        .from('swipes')
        .select('from_user')
        .eq('to_user', mover.user_id)
        .eq('sentiment', 'like')

      if (!likers?.length) return

      // Which likers are online right now (updated in last 5 min)?
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
      const likerIds = likers.map(l => l.from_user)
      const { data: onlineLikers } = await supabaseWrite
        .from('user_presence')
        .select('user_id,lat,lng')
        .in('user_id', likerIds)
        .gt('updated_at', fiveMinAgo)

      for (const liker of (onlineLikers ?? [])) {
        if (!liker.lat || !liker.lng) continue

        const dist = haversineKm(mover.lat, mover.lng, liker.lat, liker.lng)
        if (dist > 0.1) continue // > 100m, skip

        // 1-hour debounce per pair
        const key = `${liker.user_id}:${mover.user_id}`
        const lastNotified = bellDebounce.get(key)
        if (lastNotified && Date.now() - lastNotified < 60 * 60 * 1000) continue

        bellDebounce.set(key, Date.now())

        // Notify the liker via the notifications table
        await supabaseWrite.from('notifications').insert({
          to_user: liker.user_id,
          type: 'bell',
          message: 'Someone nearby likes you 🍁',
        })
        console.log(`🔔 Bell: liker ${liker.user_id.slice(0, 8)} notified (${(dist * 1000).toFixed(0)}m away)`)
      }
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') console.log('🔔  Watching presence for proximity bells...')
      else if (status === 'CHANNEL_ERROR') {
        console.error('❌  Bell channel error — reconnecting in 3s')
        setTimeout(watchPresence, 3000)
      }
    })
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
console.log('🍁  Maple Agent — True Agentic Mode (MiniMax Function Calling)')
console.log(`    Model:    MiniMax-Text-01`)
console.log(`    Supabase: ${SUPABASE_URL}`)
console.log(`    Canvas:   ${CANVAS_BASE_URL || 'per-user tokens'}`)
console.log()

subscribe()
watchPresence()

// ─── 30-day like cleanup (runs every 6 hours) ────────────────────────────────
async function cleanupExpiredLikes() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data: matches } = await supabaseWrite.from('matches').select('user_a,user_b')
  const matchedPairs = new Set((matches ?? []).map(m => `${m.user_a}:${m.user_b}`))

  const { data: oldLikes } = await supabaseWrite
    .from('swipes')
    .select('id,from_user,to_user')
    .eq('sentiment', 'like')
    .lt('created_at', cutoff)

  const toDelete = (oldLikes ?? []).filter(s =>
    !matchedPairs.has(`${s.from_user}:${s.to_user}`) &&
    !matchedPairs.has(`${s.to_user}:${s.from_user}`)
  )
  if (toDelete.length) {
    await supabaseWrite.from('swipes').delete().in('id', toDelete.map(s => s.id))
    console.log(`🧹 Cleaned up ${toDelete.length} expired likes (>30 days, no match)`)
  }
}

// ─── 14-day match reminder (runs every hour) ─────────────────────────────────
async function checkUnconfirmedMatches() {
  const cutoff14 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
  const { data: stale } = await supabaseWrite
    .from('matches')
    .select('id,user_a,user_b,date_plan,reminded_at')
    .not('date_plan', 'is', null)
    .is('confirmed_at', null)
    .lt('created_at', cutoff14)
    .is('reminded_at', null) // only remind once

  if (!stale?.length) return

  const photon = await getSdk()
  for (const match of stale) {
    const [{ data: userA }, { data: userB }] = await Promise.all([
      supabaseWrite.from('users').select('name,phone').eq('id', match.user_a).single(),
      supabaseWrite.from('users').select('name,phone').eq('id', match.user_b).single(),
    ])
    const msg = (name, other) =>
      `Hey ${name}! 🍁 Your Maple date with ${other} hasn't been confirmed yet. Want to reschedule? Just reply and we'll find a new time.`

    if (userA?.phone) await photon.send(normalizePhone(userA.phone), msg(userA.name, userB?.name ?? 'your match'))
    if (userB?.phone) await photon.send(normalizePhone(userB.phone), msg(userB.name, userA?.name ?? 'your match'))

    await supabaseWrite.from('matches').update({ reminded_at: new Date().toISOString() }).eq('id', match.id)
    console.log(`📬 Sent 14-day reminder for match ${match.id}`)
  }
}

// ─── Friday weekly release ───────────────────────────────────────────────────
let lastReleaseDate = null

async function sundayRelease() {
  const now = new Date()
  const today = now.toDateString()
  if (now.getDay() !== 5) return           // 5 = Friday
  if (lastReleaseDate === today) return     // already ran today

  console.log('\n🍁 Friday release — revealing this week\'s matches...')
  const { data: pending } = await supabaseWrite
    .from('matches')
    .select('*')
    .eq('status', 'pending')

  if (!pending?.length) {
    console.log('  No pending matches this week.')
    lastReleaseDate = today
    return
  }

  console.log(`  Found ${pending.length} pending match(es)`)
  for (const match of pending) {
    await supabaseWrite
      .from('matches')
      .update({ status: 'released', released_at: now.toISOString() })
      .eq('id', match.id)
    // Run the agent for each released match
    handleMatch({ ...match, status: 'released' })
  }
  lastReleaseDate = today
}

setInterval(cleanupExpiredLikes, 6 * 60 * 60 * 1000)
setInterval(checkUnconfirmedMatches, 60 * 60 * 1000)
setInterval(sundayRelease, 60 * 1000)   // check every minute
// Run once on startup
cleanupExpiredLikes()
checkUnconfirmedMatches()
sundayRelease()

process.on('SIGINT', async () => {
  console.log('\n👋  Shutting down...')
  if (sdk) await sdk.close()
  process.exit(0)
})
