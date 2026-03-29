import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { canvas_token, canvas_base_url } = await req.json()

  if (!canvas_token || !canvas_base_url) {
    return NextResponse.json({ error: 'Missing Canvas credentials' }, { status: 400 })
  }

  const base = `https://${canvas_base_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}`
  const headers = { Authorization: `Bearer ${canvas_token}` }

  try {
    const coursesRes = await fetch(
      `${base}/api/v1/courses?enrollment_state=active&per_page=20`,
      { headers }
    )
    if (!coursesRes.ok) {
      return NextResponse.json({ error: 'Invalid Canvas token or URL' }, { status: 400 })
    }
    const courses = await coursesRes.json()
    if (!Array.isArray(courses)) {
      return NextResponse.json({ error: 'Unexpected Canvas response' }, { status: 400 })
    }

    const classmateMap = new Map<string, { name: string; email: string; courses: string[] }>()

    for (const course of courses.slice(0, 6)) {
      if (!course.id || !course.name) continue
      try {
        const studentsRes = await fetch(
          `${base}/api/v1/courses/${course.id}/users?enrollment_type[]=student&per_page=50&include[]=email`,
          { headers }
        )
        if (!studentsRes.ok) continue
        const students = await studentsRes.json()
        if (!Array.isArray(students)) continue

        for (const s of students) {
          const email = s.email || s.login_id || ''
          if (!email || !s.name) continue
          const key = email.toLowerCase()
          if (classmateMap.has(key)) {
            classmateMap.get(key)!.courses.push(course.name)
          } else {
            classmateMap.set(key, { name: s.name, email: key, courses: [course.name] })
          }
        }
      } catch {
        // skip courses that fail
      }
    }

    return NextResponse.json({ classmates: Array.from(classmateMap.values()) })
  } catch {
    return NextResponse.json({ error: 'Failed to reach Canvas' }, { status: 500 })
  }
}
