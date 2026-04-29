import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(req: NextRequest) {
  const { matchId } = await req.json()
  if (!matchId) return NextResponse.json({ error: 'Missing matchId' }, { status: 400 })

  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_PHONE_NUMBER
  if (!sid || !token || !from) {
    return NextResponse.json({ error: 'SMS not configured' }, { status: 500 })
  }

  // Fetch match + both users' names and phones
  const { data: match, error } = await supabaseAdmin
    .from('matches')
    .select('*, user_a_profile:users!matches_user_a_fkey(name, phone), user_b_profile:users!matches_user_b_fkey(name, phone)')
    .eq('id', matchId)
    .single()

  if (error || !match) {
    return NextResponse.json({ error: 'Match not found' }, { status: 404 })
  }

  const userA = match.user_a_profile as { name: string; phone: string }
  const userB = match.user_b_profile as { name: string; phone: string }

  const client = twilio(sid, token)

  const send = async (to: string, otherName: string) => {
    if (!to) return
    await client.messages.create({
      to,
      from,
      body: `🍁 it's mutual! you and ${otherName} both shot your shot.\n\nopen maple to see your date → https://maplemeet.ai`,
    })
  }

  try {
    await Promise.all([
      send(userA.phone, userB.name),
      send(userB.phone, userA.name),
    ])
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[notify-match] Twilio error:', err)
    return NextResponse.json({ error: 'Failed to send SMS' }, { status: 500 })
  }
}
