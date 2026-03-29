import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'

export async function POST(req: NextRequest) {
  const { to_email, to_name, from_name } = await req.json()

  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    console.log(`[Invite] ${from_name} → ${to_email} (no Resend key)`)
    return NextResponse.json({ success: true, fallback: true })
  }

  const resend = new Resend(resendKey)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  // In test mode, Resend only allows sending to the account owner's email.
  // Route all invites through the owner email for demo purposes.
  const RESEND_OWNER_EMAIL = '1991769690@qq.com'
  const sendTo = RESEND_OWNER_EMAIL

  const { error } = await resend.emails.send({
    from: 'onboarding@resend.dev',
    to: [sendTo],
    subject: `${from_name} thinks you should be on Maple 🍁`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:400px;margin:0 auto;padding:40px 24px;background:#f8f7f4;">
        <div style="text-align:center;margin-bottom:28px;">
          <div style="font-size:44px;margin-bottom:8px;">🍁</div>
          <h1 style="font-size:22px;font-weight:700;color:#111;margin:0;">You're invited to Maple</h1>
        </div>
        <div style="background:white;border-radius:16px;padding:24px;border:1px solid #e8e6e1;">
          <p style="color:#6b6760;line-height:1.7;margin:0 0 16px;">
            <strong style="color:#111;">${from_name}</strong> thinks you should be on Maple.
          </p>
          <p style="color:#6b6760;line-height:1.7;margin:0 0 24px;">
            Campus dating app for people you almost know — no photos, no strangers.
            You only match if both of you want to. When you do, AI plans your first date. 🤖
          </p>
          <div style="text-align:center;">
            <a href="${appUrl}" style="display:inline-block;background:#111;color:white;padding:14px 36px;border-radius:12px;text-decoration:none;font-size:14px;font-weight:600;">
              shoot your shot →
            </a>
          </div>
        </div>
        <p style="text-align:center;color:#c5c0bb;font-size:11px;margin-top:20px;">
          No photos · Mutual matches only · AI-planned dates
        </p>
      </div>
    `,
  })

  if (error) {
    console.error('[Invite] Resend error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
