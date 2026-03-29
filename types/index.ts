export interface User {
  id: string
  email: string
  name: string
  gender: string
  want_to_date: string[]
  phone: string
  schedule_text: string | null
  campus: string | null
  created_at: string
}

export interface Swipe {
  id: string
  from_user: string
  to_user: string
  sentiment: 'like' | 'dislike' | 'neutral' | 'pass' | 'block'
  created_at: string
}

export interface Notification {
  id: string
  to_user: string
  type: 'bell'
  message: string
  created_at: string
  read_at: string | null
}

export interface AgentStep {
  label: string
  status: 'pending' | 'running' | 'done' | 'error'
  ts: string
}

export interface Match {
  id: string
  user_a: string
  user_b: string
  status: string
  date_card_json: DateCard | null
  agent_steps: AgentStep[] | null
  created_at: string
  // joined fields
  user_a_profile?: User
  user_b_profile?: User
}

export interface DateCard {
  time: string
  venue: string
  walk_minutes: number
  shared_context: string
  reasoning: string
  icebreaker: string
}

export interface FeedCard {
  user: User
  score: number
  hint: string
}
