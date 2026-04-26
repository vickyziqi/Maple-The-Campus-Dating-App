'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

// ─── Allowed Claremont Colleges domains ──────────────────────────────────────
const ALLOWED_DOMAINS = [
  'pitzer.edu',
  'students.pitzer.edu',
  'mymail.pomona.edu',
  'scrippscollege.edu',
  'claremontmckenna.edu',
  'cmc.edu',
]

function isAllowedEmail(email: string) {
  const domain = email.split('@')[1]?.toLowerCase()
  return ALLOWED_DOMAINS.includes(domain)
}

type Mode = 'signup' | 'login'

export default function HomePage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('signup')
  const [form, setForm] = useState<{
    name: string; email: string; gender: string; want_to_date: string[]
    phone: string; schedule_text: string; campus: string
  }>({
    name: '', email: '', gender: '', want_to_date: [],
    phone: '', schedule_text: '', campus: 'Main Campus',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // SMS OTP state
  const [pendingUserId, setPendingUserId] = useState('')
  const [pendingPhone, setPendingPhone] = useState('')
  const [pendingName, setPendingName] = useState('')
  const [otp, setOtp] = useState('')
  const [otpLoading, setOtpLoading] = useState(false)
  const [otpError, setOtpError] = useState('')

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function switchMode(m: Mode) {
    setMode(m)
    setError('')
    setPendingUserId('')
    setOtp('')
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.email) { setError('Please enter your email'); return }
    setLoading(true)
    try {
      const { data, error: dbError } = await supabase
        .from('users').select('id, name, email_verified').eq('email', form.email).single()
      if (dbError || !data) { setError("We couldn't find that email. Sign up first."); return }
      if (!data.email_verified) { setError('Please finish verifying your phone number first.'); return }
      localStorage.setItem('anlan_user_id', data.id)
      localStorage.setItem('anlan_user_name', data.name)
      router.push('/feed')
    } catch { setError('Network error. Check your connection.') }
    finally { setLoading(false) }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.name || !form.email || !form.gender || form.want_to_date.length === 0 || !form.phone) {
      setError('Please fill in all required fields')
      return
    }
    if (!isAllowedEmail(form.email)) {
      setError('Only 5C emails allowed: pitzer.edu, mymail.pomona.edu, scrippscollege.edu, claremontmckenna.edu / cmc.edu')
      return
    }
    const digits = form.phone.replace(/\D/g, '')
    if (digits.length !== 10) {
      setError('Please enter a valid 10-digit US phone number')
      return
    }
    setLoading(true)
    const fullPhone = '+1' + digits
    try {
      const { data, error: dbError } = await supabase
        .from('users')
        .insert({
          name: form.name, email: form.email, gender: form.gender,
          want_to_date: form.want_to_date, phone: fullPhone,
          schedule_text: form.schedule_text || null, campus: form.campus,
          email_verified: false,
        })
        .select('id').single()
      if (dbError) {
        if (dbError.code === '23505') setError('This email is already registered. Log in instead.')
        else setError('Sign up failed. Try again.')
        return
      }

      // Send SMS OTP
      const res = await fetch('/api/verify-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: data.id, phone: fullPhone }),
      })
      if (!res.ok) {
        setError('Failed to send SMS. Check your phone number.')
        return
      }
      setPendingUserId(data.id)
      setPendingPhone(fullPhone)
      setPendingName(form.name)
    } catch { setError('Network error. Check your connection.') }
    finally { setLoading(false) }
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault()
    setOtpError('')
    if (otp.length !== 6) { setOtpError('Enter the 6-digit code we texted you'); return }
    setOtpLoading(true)
    try {
      const res = await fetch('/api/verify-phone', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: pendingUserId, phone: pendingPhone, code: otp }),
      })
      const json = await res.json()
      if (!res.ok) { setOtpError('Wrong code — try again'); return }
      localStorage.setItem('anlan_user_id', pendingUserId)
      localStorage.setItem('anlan_user_name', json.name ?? pendingName)
      router.push('/feed')
    } catch { setOtpError('Network error. Try again.') }
    finally { setOtpLoading(false) }
  }

  async function resendSms() {
    setOtpError('')
    const res = await fetch('/api/verify-phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: pendingUserId, phone: pendingPhone }),
    })
    if (res.ok) setOtpError('New code sent ✓')
    else setOtpError('Failed to resend. Try again.')
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-5 py-16 bg-[#f8f7f4]">
      <div className="w-full max-w-[360px] animate-fade-up">

        {/* Logo */}
        <div className="mb-10 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 mb-4">
            <MapleIcon />
          </div>
          <h1 className="text-[26px] font-semibold tracking-tight text-[#111]">Maple</h1>
          <p className="text-sm text-[#9b9590] mt-1">your crush is probably already here 👀</p>
        </div>

        {/* SMS OTP screen */}
        {pendingUserId && (
          <div className="animate-fade-in">
            <div className="text-center mb-6">
              <div className="text-4xl mb-3">📱</div>
              <h2 className="text-lg font-semibold text-[#111] mb-1">check your texts</h2>
              <p className="text-sm text-[#9b9590] leading-relaxed">
                we texted a 6-digit code to<br />
                <span className="font-medium text-[#6b6760]">{pendingPhone}</span>
              </p>
            </div>
            <form onSubmit={handleOtpSubmit} className="space-y-3">
              <input
                type="text"
                inputMode="numeric"
                placeholder="_ _ _ _ _ _"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                autoFocus
                className="w-full bg-white border border-[#e8e6e1] rounded-xl px-4 py-4 text-2xl text-center font-semibold tracking-[0.4em] text-[#111] placeholder:text-[#ddd] focus:outline-none focus:border-[#111] transition-colors"
              />
              {otpError && (
                <p className={`text-sm text-center py-1 ${otpError.includes('✓') ? 'text-emerald-500' : 'text-red-500'}`}>
                  {otpError}
                </p>
              )}
              <button
                type="submit"
                disabled={otpLoading || otp.length !== 6}
                className="w-full bg-[#111] text-white rounded-xl py-3.5 text-sm font-medium disabled:opacity-40 active:scale-[0.98] transition-transform"
              >
                {otpLoading ? 'Verifying...' : 'verify →'}
              </button>
            </form>
            <p className="text-center text-xs text-[#c5c0bb] mt-4">
              didn&apos;t get it?{' '}
              <button onClick={resendSms} className="underline hover:text-[#9b9590]">resend</button>
            </p>
          </div>
        )}

        {/* Tab switcher + forms */}
        {!pendingUserId && (
          <>
            <div className="flex bg-[#eeeae4] rounded-xl p-1 mb-6">
              {(['signup', 'login'] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => switchMode(m)}
                  className={`flex-1 py-2 text-sm rounded-lg font-medium transition-all duration-200 ${
                    mode === m ? 'bg-white text-[#111] shadow-sm' : 'text-[#9b9590]'
                  }`}
                >
                  {m === 'signup' ? 'I\'m new here' : 'Welcome back'}
                </button>
              ))}
            </div>

            {/* Login */}
            {mode === 'login' && (
              <form onSubmit={handleLogin} className="space-y-3 animate-fade-in">
                <Field label="Email">
                  <input
                    type="email" placeholder="your@email.com" value={form.email}
                    onChange={(e) => set('email', e.target.value)} autoFocus
                    className={inputCls}
                  />
                </Field>
                {error && <ErrorMsg>{error}</ErrorMsg>}
                <Btn loading={loading} label="let me in →" />
              </form>
            )}

            {/* Signup */}
            {mode === 'signup' && (
              <form onSubmit={handleSignup} className="space-y-3 animate-fade-in">
                <Field label="what do people call you" required>
                  <input
                    type="text" placeholder="your name" value={form.name}
                    onChange={(e) => set('name', e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="5C email" required hint="pitzer · pomona · scripps · cmc">
                  <input
                    type="email" placeholder="you@mymail.pomona.edu" value={form.email}
                    onChange={(e) => set('email', e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="i am" required>
                  <div className="flex gap-2">
                    {['Man', 'Woman', 'Non-binary'].map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => set('gender', g)}
                        className={`flex-1 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                          form.gender === g
                            ? 'bg-[#111] text-white border-[#111]'
                            : 'bg-white text-[#6b6760] border-[#e8e6e1] hover:border-[#111]'
                        }`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="i'm into" required>
                  <div className="flex gap-2">
                    {['Men', 'Women', 'Non-binary'].map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setForm(f => ({
                          ...f,
                          want_to_date: f.want_to_date.includes(g)
                            ? f.want_to_date.filter(x => x !== g)
                            : [...f.want_to_date, g]
                        }))}
                        className={`flex-1 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                          form.want_to_date.includes(g)
                            ? 'bg-[#111] text-white border-[#111]'
                            : 'bg-white text-[#6b6760] border-[#e8e6e1] hover:border-[#111]'
                        }`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="phone" required hint="verification code goes here 📱">
                  <div className="flex items-center bg-white border border-[#e8e6e1] rounded-xl overflow-hidden focus-within:border-[#111] transition-colors">
                    <div className="flex items-center gap-1.5 px-3 py-3 border-r border-[#e8e6e1] shrink-0 select-none">
                      <span className="text-base leading-none">🇺🇸</span>
                      <span className="text-sm text-[#6b6760] font-medium">+1</span>
                    </div>
                    <input
                      type="tel"
                      placeholder="(555) 000-0000"
                      value={form.phone}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, '').slice(0, 10)
                        let formatted = digits
                        if (digits.length >= 7) formatted = `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`
                        else if (digits.length >= 4) formatted = `(${digits.slice(0,3)}) ${digits.slice(3)}`
                        else if (digits.length >= 1) formatted = `(${digits}`
                        set('phone', formatted)
                      }}
                      className="flex-1 px-3 py-3 text-sm text-[#111] placeholder:text-[#c5c0bb] focus:outline-none bg-transparent"
                    />
                  </div>
                </Field>
                {error && <ErrorMsg>{error}</ErrorMsg>}
                <Btn loading={loading} label="shoot your shot →" />
              </form>
            )}

            <p className="text-center text-xs text-[#c5c0bb] mt-6 leading-relaxed">
              5Cs only · no pics · mutual matches only 🤝
            </p>
          </>
        )}
      </div>
    </main>
  )
}

// ─── Shared components ────────────────────────────────────────────────────────

const inputCls = "w-full bg-white border border-[#e8e6e1] rounded-xl px-4 py-3 text-sm text-[#111] placeholder:text-[#c5c0bb] focus:outline-none focus:border-[#111] transition-colors"

function Field({ label, hint, required, children, className = '' }: {
  label: string; hint?: string; required?: boolean; children: React.ReactNode; className?: string
}) {
  return (
    <div className={className}>
      <div className="flex items-baseline gap-2 mb-1.5">
        <label className="text-xs font-medium text-[#6b6760]">
          {label}
          {required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
        {hint && <span className="text-xs text-[#c5c0bb]">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function Btn({ loading, label }: { loading: boolean; label: string }) {
  return (
    <button
      type="submit" disabled={loading}
      className="w-full bg-[#111] text-white rounded-xl py-3.5 text-sm font-medium mt-1 disabled:opacity-40 active:scale-[0.98] transition-transform"
    >
      {loading ? 'Please wait...' : label}
    </button>
  )
}

function ErrorMsg({ children }: { children: React.ReactNode }) {
  return <p className="text-red-500 text-sm text-center py-1">{children}</p>
}

function MapleIcon() {
  return (
    <img
      src="/maple-leaf.png"
      alt="Maple"
      className="w-16 h-16 object-contain"
      style={{ mixBlendMode: 'multiply' }}
    />
  )
}
