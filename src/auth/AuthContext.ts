import { createContext, useContext } from 'react'
import type { User } from '@supabase/supabase-js'

export type Student = {
  user_id: string
  username: string
  program: string
  year_level: number
  full_name: string | null
  avatar_url: string | null
}

export type AuthState =
  | { status: 'loading'; user: null; student: null; message: null }
  | { status: 'signedOut'; user: null; student: null; message: null }
  | { status: 'ineligible'; user: User; student: null; message: null }
  | { status: 'needsOnboarding'; user: User; student: null; message: null }
  | { status: 'ready'; user: User; student: Student; message: null }
  | { status: 'error'; user: null; student: null; message: string }

export type AuthContextValue = {
  state: AuthState
  reload: () => Promise<void>
  signOut: () => Promise<void>
  completeOnboarding: (username: string, program: string, yearLevel: number) => Promise<void>
  updateAcademicDetails: (program: string, yearLevel: number) => Promise<void>
  deleteAccount: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
