'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
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
  'g.hmc.edu',
]

// Google Workspace schools (use Google OAuth)
const GOOGLE_DOMAINS = ['pitzer.edu', 'students.pitzer.edu', 'g.hmc.edu']
// Microsoft/Outlook schools
const MICROSOFT_DOMAINS = ['mymail.pomona.edu', 'scrippscollege.edu', 'claremontmckenna.edu', 'cmc.edu']

function isAllowedEmail(email: string) {
  const domain = email.split('@')[1]?.toLowerCase()
  return ALLOWED_DOMAINS.includes(domain)
}

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

type Mode = 'signup' | 'login'

export default function HomePage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('signup')
  const [verifiedEmail, setVerifiedEmail] = useState('')
  const [emailVerifying, setEmailVerifying] = useState(false)
  const [form, setForm] = useState<{
    name: string; gender: string; want_to_date: string[]
    phone: string; schedule_text: string; campus: string
  }>({
    name: '', gender: '', want_to_date: [],
    phone: '', schedule_text: '', campus: 'Main Campus',
  })
  const [loginEmail, setLoginEmail] = useState('')
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
    setVerifiedEmail('')
  }

  // Load Google Identity Services
  useEffect(() => {
    if (document.getElementById('gis-script')) return
    const script = document.createElement('script')
    script.id = 'gis-script'
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    document.head.appendChild(script)
  }, [])

  // Handle Microsoft OAuth callback (?code=...&state=microsoft)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')
    if (!code || state !== 'microsoft') return
    window.history.replaceState(null, '', window.location.pathname)

    const verifier = localStorage.getItem('ms_verifier')
    if (!verifier) return
    localStorage.removeItem('ms_verifier')

    async function exchangeMicrosoft() {
      setEmailVerifying(true)
      try {
        const clientId = process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID!
        const redirectUri = window.location.origin + '/'
        const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: code!,
            redirect_uri: redirectUri,
            client_id: clientId,
            code_verifier: verifier!,
            scope: 'openid profile email User.Read',
          }),
        })
        const tokenData = await tokenRes.json()
        const token = tokenData.access_token
        if (!token) { setError('Microsoft sign-in failed. Try again.'); return }

        const meRes = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const meData = await meRes.json()
        const email = (meData.mail || meData.userPrincipalName || '').toLowerCase()
        if (!isAllowedEmail(email)) {
          setError('Only 5C emails allowed: pitzer · pomona · scripps · cmc · hmc')
          return
        }
        setVerifiedEmail(email)
        setMode('signup')
      } catch {
        setError('Microsoft sign-in failed. Try again.')
      } finally {
        setEmailVerifying(false)
      }
    }
    exchangeMicrosoft()
  }, [])

  async function signInWithGoogle() {
    setError('')
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    if (!clientId) { setError('Google not configured'); return }
    if (!window.google) { setError('Loading... try again in a moment'); return }

    setEmailVerifying(true)
    window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'email profile',
      callback: async (resp) => {
        if (!resp.access_token) {
          setError('Google sign-in cancelled')
          setEmailVerifying(false)
          return
        }
        try {
          const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${resp.access_token}` },
          })
          const data = await res.json()
          const email = (data.email ?? '').toLowerCase()
          if (!isAllowedEmail(email)) {
            setError('Only 5C emails allowed: pitzer · pomona · scripps · cmc · hmc')
            setEmailVerifying(false)
            return
          }
          setVerifiedEmail(email)
        } catch {
          setError('Google sign-in failed. Try again.')
        } finally {
          setEmailVerifying(false)
        }
      },
    }).requestAccessToken()
  }

  async function signInWithMicrosoft() {
    setError('')
    const clientId = process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID
    if (!clientId) { setError('Microsoft not configured'); return }

    // PKCE
    const verifier = Array.from(crypto.getRandomValues(new Uint8Array(64)))
      .map(b => b.toString(16).padStart(2, '0')).join('')
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    localStorage.setItem('ms_verifier', verifier)

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: window.location.origin + '/',
      scope: 'openid profile email User.Read',
      state: 'microsoft',
      code_challenge_method: 'S256',
      code_challenge: challenge,
      response_mode: 'query',
    })
    window.location.href = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!loginEmail) { setError('Please enter your email'); return }
    setLoading(true)
    try {
      const { data, error: dbError } = await supabase
        .from('users').select('id, name, email_verified').eq('email', loginEmail.toLowerCase()).single()
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
    if (!verifiedEmail) { setError('Verify your school email first'); return }
    if (!form.name || !form.gender || form.want_to_date.length === 0 || !form.phone) {
      setError('Please fill in all required fields')
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
          name: form.name, email: verifiedEmail, gender: form.gender,
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
      const res = await fetch('/api/verify-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: data.id, phone: fullPhone }),
      })
      if (!res.ok) { setError('Failed to send SMS. Check your phone number.'); return }
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
                    type="email" placeholder="your@email.com" value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)} autoFocus
                    className={inputCls}
                  />
                </Field>
                {error && <ErrorMsg>{error}</ErrorMsg>}
                <Btn loading={loading} label="let me in →" />
              </form>
            )}

            {/* Signup */}
            {mode === 'signup' && (
              <div className="space-y-3 animate-fade-in">

                {/* Step 1: Verify school email */}
                {!verifiedEmail ? (
                  <div className="space-y-3">
                    <p className="text-xs font-medium text-[#6b6760] mb-1">verify your school email</p>

                    {/* Google schools */}
                    <button
                      type="button"
                      onClick={signInWithGoogle}
                      disabled={emailVerifying}
                      className="w-full flex items-center gap-3 bg-white border border-[#e8e6e1] rounded-xl px-4 py-3.5 hover:border-[#111] transition-colors disabled:opacity-50"
                    >
                      <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                      </svg>
                      <div className="text-left min-w-0">
                        <p className="text-sm font-medium text-[#111]">Continue with Google</p>
                        <p className="text-xs text-[#9b9590]">Pitzer · HMC</p>
                      </div>
                      {emailVerifying && <div className="ml-auto w-4 h-4 rounded-full border border-[#9b9590] border-t-transparent animate-spin shrink-0" />}
                    </button>

                    {/* Microsoft schools */}
                    <button
                      type="button"
                      onClick={signInWithMicrosoft}
                      disabled={emailVerifying}
                      className="w-full flex items-center gap-3 bg-white border border-[#e8e6e1] rounded-xl px-4 py-3.5 hover:border-[#111] transition-colors disabled:opacity-50"
                    >
                      <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                        <path fill="#F25022" d="M1 1h10v10H1z"/>
                        <path fill="#00A4EF" d="M13 1h10v10H13z"/>
                        <path fill="#7FBA00" d="M1 13h10v10H1z"/>
                        <path fill="#FFB900" d="M13 13h10v10H13z"/>
                      </svg>
                      <div className="text-left min-w-0">
                        <p className="text-sm font-medium text-[#111]">Continue with Microsoft</p>
                        <p className="text-xs text-[#9b9590]">Pomona · Scripps · CMC (Outlook)</p>
                      </div>
                    </button>

                    {error && <ErrorMsg>{error}</ErrorMsg>}
                    <p className="text-center text-xs text-[#c5c0bb] pt-1">
                      we only let in real 5C students 🔒
                    </p>
                  </div>
                ) : (
                  /* Step 2: Fill in profile */
                  <form onSubmit={handleSignup} className="space-y-3">
                    {/* Verified email badge */}
                    <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                      <span className="text-emerald-500 text-base">✓</span>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-emerald-700">school email verified</p>
                        <p className="text-xs text-emerald-600 truncate">{verifiedEmail}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setVerifiedEmail('')}
                        className="ml-auto text-xs text-emerald-400 hover:text-emerald-600 shrink-0"
                      >
                        change
                      </button>
                    </div>

                    <Field label="what do people call you" required>
                      <input
                        type="text" placeholder="your name" value={form.name}
                        onChange={(e) => set('name', e.target.value)} autoFocus
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
              </div>
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
