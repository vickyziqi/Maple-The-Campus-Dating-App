// Supabase Edge Function: fires when a new row is inserted into matches
// Triggered via Supabase Database Webhook (configure in dashboard)
//
// Flow:
//   matches INSERT
//     → fetch both user profiles
//     → call MiniMax to generate date card JSON
//     → store date_card_json in matches row
//     → send iMessage to both users via Photon

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MINIMAX_API_URL = 'https://api.minimax.chat/v1/text/chatcompletion_v2'
const MINIMAX_API_KEY = Deno.env.get('MINIMAX_API_KEY')!
const PHOTON_API_KEY  = Deno.env.get('PHOTON_API_KEY')!
const PHOTON_API_URL  = 'https://api.usephoton.com/v1/messages' // update if different
const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const VENUES = [
  { name: "A3楼下咖啡厅",      building: "A3",      type: "cafe" },
  { name: "图书馆一楼休息区",  building: "图书馆",  type: "study_lounge" },
  { name: "东门食堂二楼",      building: "东食堂",  type: "cafeteria" },
  { name: "理工楼中庭",        building: "理工楼",  type: "outdoor" },
  { name: "学生活动中心一楼",  building: "活动中心", type: "common_area" },
]

const FALLBACK_CARD = {
  time: "周四 12:15-13:00",
  venue: "图书馆一楼休息区",
  walk_minutes: 5,
  shared_context: "你们都在同一个校区",
  reasoning: "这是双方课间最近的共同空窗期，图书馆一楼安静、自然，不会有压力。",
  icebreaker: "你最近在读什么书，或者在忙什么课？",
}

// Strip markdown code fences from LLM output before JSON.parse
function extractJson(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  return match ? match[1] : text
}

function validateDateCard(obj: unknown): obj is typeof FALLBACK_CARD {
  if (!obj || typeof obj !== 'object') return false
  const card = obj as Record<string, unknown>
  return (
    typeof card.time === 'string' &&
    typeof card.venue === 'string' &&
    typeof card.walk_minutes === 'number' &&
    typeof card.shared_context === 'string' &&
    typeof card.reasoning === 'string' &&
    typeof card.icebreaker === 'string'
  )
}

async function callMiniMax(userA: Record<string, unknown>, userB: Record<string, unknown>) {
  const prompt = `你是一个约会安排助手。给定两个大学生的信息，安排一次自然、低压力的第一次见面。

用户A：${userA.dept}系，大${userA.year}，课表：${userA.schedule_text || '未填写'}
用户B：${userB.dept}系，大${userB.year}，课表：${userB.schedule_text || '未填写'}
校园场地：${JSON.stringify(VENUES)}

要求：
1. 找到双方最近的30-60分钟共同空窗期（如果课表未填写，推荐午休时间12:00-13:00）
2. 选择场地列表中的一个，距离两人都近、安静、有座位、不尴尬
3. 找到一个共同话题作为开场白（基于院系、年级）
4. 用中文输出，语气轻松不压迫
5. 只返回JSON，不要任何其他文字

输出格式（严格JSON，无markdown）：
{
  "time": "具体时间，例如：周四 12:15-13:00",
  "venue": "场地名称",
  "walk_minutes": 步行分钟数（整数）,
  "shared_context": "一句话共同点",
  "reasoning": "简短解释为什么选这个时间和地点",
  "icebreaker": "一句推荐的开场话题"
}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  try {
    const res = await fetch(MINIMAX_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MINIMAX_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'MiniMax-Text-01',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      }),
    })
    clearTimeout(timeout)

    if (!res.ok) throw new Error(`MiniMax error: ${res.status}`)

    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content ?? ''
    const parsed = JSON.parse(extractJson(content))

    if (!validateDateCard(parsed)) throw new Error('Invalid date card shape')
    return parsed
  } catch (e) {
    clearTimeout(timeout)
    console.error('MiniMax failed, using fallback:', e)
    return FALLBACK_CARD
  }
}

async function sendIMessage(phone: string, message: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8_000)

  try {
    const res = await fetch(PHOTON_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PHOTON_API_KEY}`,
      },
      body: JSON.stringify({ to: phone, body: message }),
    })
    clearTimeout(timeout)
    if (!res.ok) console.error(`Photon failed for ${phone}: ${res.status}`)
  } catch (e) {
    clearTimeout(timeout)
    console.error(`Photon timeout/error for ${phone}:`, e)
  }
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json()
    // Supabase webhook sends { type: 'INSERT', table: 'matches', record: {...} }
    const match = payload.record

    if (!match?.id) {
      return new Response('No match record', { status: 400 })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

    // Fetch both user profiles
    const [{ data: userA }, { data: userB }] = await Promise.all([
      supabase.from('users').select('*').eq('id', match.user_a).single(),
      supabase.from('users').select('*').eq('id', match.user_b).single(),
    ])

    if (!userA || !userB) {
      return new Response('Users not found', { status: 404 })
    }

    // Generate date card via MiniMax
    const dateCard = await callMiniMax(userA, userB)

    // Store date card in matches row
    await supabase
      .from('matches')
      .update({ date_card_json: dateCard, status: 'ready' })
      .eq('id', match.id)

    // Format iMessage text
    const message = `💌 你们互相喜欢了！\n\nAI 为你们安排了第一次见面：\n\n📅 ${dateCard.time}\n📍 ${dateCard.venue}（步行约${dateCard.walk_minutes}分钟）\n✨ ${dateCard.shared_context}\n💬 ${dateCard.icebreaker}\n\n打开 App 查看详情并确认约会 →`

    // Send iMessage to both users (fire and forget)
    await Promise.all([
      sendIMessage(userA.phone, message),
      sendIMessage(userB.phone, message),
    ])

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('Edge function error:', e)
    return new Response('Internal error', { status: 500 })
  }
})
