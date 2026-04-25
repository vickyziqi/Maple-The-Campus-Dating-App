'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'


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
  const [emailSent, setEmailSent] = useState(false)

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function switchMode(m: Mode) {
    setMode(m)
    setError('')
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
      if (!data.email_verified) { setError('Please verify your email first — check your inbox.'); return }
      localStorage.setItem('anlan_user_id', data.id)
      localStorage.setItem('anlan_user_name', data.name)
      router.push('/feed')
    } catch { setError('Network error. Check your connection.') }
    finally { setLoading(false) }
  }

  function isStudentEmail(email: string) {
    return /\.(edu|ac\.uk|ac\.cn|edu\.cn|edu\.au|edu\.sg|ac\.jp|uni\..*|university\..*)$/i.test(email)
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.name || !form.email || !form.gender || form.want_to_date.length === 0 || !form.phone) {
      setError('Please fill in all required fields')
      return
    }
    if (!isStudentEmail(form.email)) {
      setError('Please use your university email (e.g. .edu, .ac.uk)')
      return
    }
    const digits = form.phone.replace(/\D/g, '')
    if (digits.length !== 10) {
      setError('Please enter a valid 10-digit US phone number')
      return
    }
    setLoading(true)
    try {
      const { data, error: dbError } = await supabase
        .from('users')
        .insert({
          name: form.name, email: form.email, gender: form.gender,
          want_to_date: form.want_to_date, phone: '+1' + form.phone.replace(/\D/g, ''),
          schedule_text: form.schedule_text || null, campus: form.campus,
          email_verified: false,
        })
        .select('id').single()
      if (dbError) {
        if (dbError.code === '23505') setError('This email is already registered. Log in instead.')
        else setError('Sign up failed. Try again.')
        return
      }
      await fetch('/api/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: data.id, email: form.email, name: form.name }),
      })
      setEmailSent(true)
    } catch { setError('Network error. Check your connection.') }
    finally { setLoading(false) }
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

        {/* Email sent state */}
        {emailSent && (
          <div className="text-center animate-fade-in">
            <div className="text-5xl mb-4">📬</div>
            <h2 className="text-lg font-semibold text-[#111] mb-2">check your inbox</h2>
            <p className="text-sm text-[#9b9590] leading-relaxed mb-6">
              we sent a verification link to<br />
              <span className="font-medium text-[#6b6760]">{form.email}</span>
            </p>
            <p className="text-xs text-[#c5c0bb]">click the link to activate your account</p>
          </div>
        )}

        {/* Tab switcher + forms */}
        {!emailSent && (
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
                <Field label="uni email" required>
                  <input
                    type="email" placeholder="you@university.edu" value={form.email}
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
                <Field label="phone" required hint="we'll text you when it's mutual 🍁">
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
                <div className="flex items-center gap-2 bg-[#f0ede8] rounded-xl px-4 py-3">
                  <span className="text-sm">✉️</span>
                  <span className="text-xs text-[#6b6760]">connect your email later to find people you already vibe with</span>
                </div>
                {error && <ErrorMsg>{error}</ErrorMsg>}
                <Btn loading={loading} label="shoot your shot →" />
              </form>
            )}

            <p className="text-center text-xs text-[#c5c0bb] mt-6 leading-relaxed">
              no pics. no followers. just vibes.<br />only matches if it&apos;s mutual 🤝
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

function _OldMapleIconUnused() {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-16 h-16">
      <path
        d="M32,3 L31,10 L22,8 L26,14 L6,22 L19,26 L16,33 L24,32 L27,44 L29,44 L29,54 L35,54 L35,44 L37,44 L40,32 L48,33 L45,26 L58,22 L38,14 L42,8 L33,10 Z"
        fill="#D52B1E"
      />
      <circle cx="25" cy="27" r="2.2" fill="white" />
      <circle cx="39" cy="27" r="2.2" fill="white" />
      <circle cx="25.8" cy="27.8" r="1" fill="#1a1a1a" />
      <circle cx="39.8" cy="27.8" r="1" fill="#1a1a1a" />
      <path
        d="M23,35 Q32,43 41,35"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}
