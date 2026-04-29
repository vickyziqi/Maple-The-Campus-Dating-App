import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const MAPS_KEY = process.env.GOOGLE_MAPS_KEY!

// Haversine distance in meters
function distanceM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function midpoint(lat1: number, lng1: number, lat2: number, lng2: number) {
  return { lat: (lat1 + lat2) / 2, lng: (lng1 + lng2) / 2 }
}

function walkMinutes(meters: number) {
  return Math.round(meters / 80) // ~80m/min walking pace
}

export async function POST(req: NextRequest) {
  const { matchId } = await req.json()
  if (!matchId) return NextResponse.json({ error: 'Missing matchId' }, { status: 400 })

  // Fetch match + both user IDs
  const { data: match, error: matchErr } = await supabaseAdmin
    .from('matches')
    .select('user_a, user_b')
    .eq('id', matchId)
    .single()

  if (matchErr || !match) return NextResponse.json({ error: 'Match not found' }, { status: 404 })

  // Get both users' last known GPS locations
  const { data: presences } = await supabaseAdmin
    .from('user_presence')
    .select('user_id, lat, lng')
    .in('user_id', [match.user_a, match.user_b])

  if (!presences || presences.length < 2) {
    // Fallback: use Claremont Colleges center
    return NextResponse.json({
      venue: 'Student Center Coffee Bar',
      address: '150 E 10th St, Claremont, CA 91711',
      lat: 34.0967,
      lng: -117.7077,
      walk_minutes: 5,
      maps_url: 'https://maps.google.com/?q=Claremont+Student+Center',
      static_map: staticMapUrl(34.0967, -117.7077, 'Student+Center'),
      fallback: true,
    })
  }

  const a = presences.find(p => p.user_id === match.user_a)!
  const b = presences.find(p => p.user_id === match.user_b)!
  const mid = midpoint(a.lat, a.lng, b.lat, b.lng)

  // Search nearby places (café, library, park)
  const types = ['cafe', 'library', 'park']
  let bestPlace = null

  for (const type of types) {
    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${mid.lat},${mid.lng}&radius=800&type=${type}&key=${MAPS_KEY}`
    const res = await fetch(url)
    const data = await res.json()
    if (data.results?.length > 0) {
      bestPlace = data.results[0]
      break
    }
  }

  if (!bestPlace) {
    // Fallback to text search for "coffee" near midpoint
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=coffee+campus&location=${mid.lat},${mid.lng}&radius=1000&key=${MAPS_KEY}`
    const res = await fetch(url)
    const data = await res.json()
    bestPlace = data.results?.[0]
  }

  if (!bestPlace) {
    return NextResponse.json({ error: 'No venues found' }, { status: 404 })
  }

  const placeLat = bestPlace.geometry.location.lat
  const placeLng = bestPlace.geometry.location.lng
  const distFromA = distanceM(a.lat, a.lng, placeLat, placeLng)
  const distFromB = distanceM(b.lat, b.lng, placeLat, placeLng)
  const avgWalk = walkMinutes((distFromA + distFromB) / 2)

  const result = {
    venue: bestPlace.name,
    address: bestPlace.vicinity || bestPlace.formatted_address || '',
    lat: placeLat,
    lng: placeLng,
    walk_minutes: avgWalk,
    maps_url: `https://maps.google.com/?q=${encodeURIComponent(bestPlace.name + ' ' + (bestPlace.vicinity || ''))}`,
    static_map: staticMapUrl(placeLat, placeLng, encodeURIComponent(bestPlace.name)),
    fallback: false,
  }

  // Save to match record for the date card
  await supabaseAdmin
    .from('matches')
    .update({
      date_card_json: {
        time: nextFridayEvening(),
        venue: result.venue,
        address: result.address,
        walk_minutes: result.walk_minutes,
        maps_url: result.maps_url,
        static_map: result.static_map,
        lat: result.lat,
        lng: result.lng,
        shared_context: "Maple picked the midpoint between where you both are 🍁",
        reasoning: `${result.venue} is roughly equidistant from both of you — ~${result.walk_minutes} min walk each.`,
        icebreaker: "What's something you've been meaning to try but haven't gotten around to yet?",
      }
    })
    .eq('id', matchId)

  return NextResponse.json(result)
}

function staticMapUrl(lat: number, lng: number, label: string) {
  return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=16&size=400x200&markers=color:red%7C${lat},${lng}&key=${MAPS_KEY}`
}

function nextFridayEvening() {
  const now = new Date()
  const day = now.getDay() // 0=Sun, 5=Fri
  const daysUntilFriday = (5 - day + 7) % 7 || 7
  const friday = new Date(now)
  friday.setDate(now.getDate() + daysUntilFriday)
  return friday.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) + ' · 7:00 PM'
}
