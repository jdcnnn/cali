import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { configurationError, supabase } from '../lib/supabase'
import { AuthContext } from './AuthContext'
import type { AuthState, Student } from './AuthContext'

function isCompleteStudent(value: unknown, userId: string): value is Student {
  if (!value || typeof value !== 'object') return false
  const student = value as Partial<Student>
  return student.user_id === userId
    && typeof student.username === 'string'
    && /^[a-z0-9_]{3,30}$/.test(student.username)
    && typeof student.program === 'string'
    && student.program.trim().length > 0
    && Number.isInteger(student.year_level)
    && Number(student.year_level) >= 1
    && Number(student.year_level) <= 5
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null, student: null, message: null })
  const requestId = useRef(0)
  const validatedUserId = useRef<string | null>(null)

  const reload = useCallback(async () => {
    const id = ++requestId.current
    if (!supabase) {
      setState({ status: 'error', user: null, student: null, message: configurationError ?? 'Supabase is unavailable.' })
      return
    }
    setState({ status: 'loading', user: null, student: null, message: null })

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      if (id !== requestId.current) return
      if (!sessionData.session) {
        validatedUserId.current = null
        setState({ status: 'signedOut', user: null, student: null, message: null })
        return
      }

      // getUser validates the restored token with Auth; getSession alone reads local storage.
      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError?.status === 401 || userError?.status === 403) {
        await supabase.auth.signOut({ scope: 'local' })
        validatedUserId.current = null
        if (id === requestId.current) setState({ status: 'signedOut', user: null, student: null, message: null })
        return
      }
      if (userError || !userData.user) throw userError ?? new Error('Could not load your account.')
      if (id !== requestId.current) return

      const { data: eligible, error: eligibilityError } = await supabase.rpc('cali_is_eligible_user')
      if (eligibilityError) throw eligibilityError
      if (id !== requestId.current) return
      if (!eligible) {
        validatedUserId.current = userData.user.id
        setState({ status: 'ineligible', user: userData.user, student: null, message: null })
        return
      }

      const { data: student, error: profileError } = await supabase.rpc('cali_refresh_google_profile')
      if (profileError) throw profileError
      if (id !== requestId.current) return
      validatedUserId.current = userData.user.id
      setState(isCompleteStudent(student, userData.user.id)
        ? { status: 'ready', user: userData.user, student, message: null }
        : { status: 'needsOnboarding', user: userData.user, student: null, message: null })
    } catch (error) {
      if (id !== requestId.current) return
      validatedUserId.current = null
      setState({
        status: 'error', user: null, student: null,
        message: error instanceof Error ? error.message : 'We could not check your account. Please try again.',
      })
    }
  }, [])

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void reload() }, 0)
    if (!supabase) return () => { window.clearTimeout(initialLoad) }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') return
      if (event === 'SIGNED_OUT') {
        ++requestId.current
        validatedUserId.current = null
        setState({ status: 'signedOut', user: null, student: null, message: null })
        return
      }
      if (event === 'TOKEN_REFRESHED') return
      if (event === 'SIGNED_IN' && session?.user.id === validatedUserId.current) return
      // Supabase warns against awaiting another Auth call inside this callback.
      window.setTimeout(() => { void reload() }, 0)
    })
    return () => { window.clearTimeout(initialLoad); subscription.unsubscribe() }
  }, [reload])

  async function signOut() {
    if (!supabase) return
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    ++requestId.current
    validatedUserId.current = null
    setState({ status: 'signedOut', user: null, student: null, message: null })
  }

  async function completeOnboarding(username: string, program: string, yearLevel: number) {
    if (!supabase || state.status !== 'needsOnboarding') throw new Error('Your session is not ready for onboarding.')
    const { data, error } = await supabase.rpc('cali_complete_onboarding', {
      p_username: username,
      p_program: program,
      p_year_level: yearLevel,
    })
    if (error) throw error
    if (!isCompleteStudent(data, state.user.id)) throw new Error('Your profile could not be saved. Please try again.')
    setState({ status: 'ready', user: state.user, student: data, message: null })
  }

  async function updateProfileDetails(username: string, program: string, yearLevel: number) {
    if (!supabase || state.status !== 'ready') throw new Error('Your session is not ready. Please try again.')
    const normalizedUsername = username.trim().toLowerCase()
    const normalizedProgram = program.trim()
    if (!/^[a-z0-9_]{3,30}$/.test(normalizedUsername) || !normalizedProgram || normalizedProgram.length > 120 || !Number.isInteger(yearLevel) || yearLevel < 1 || yearLevel > 5) {
      throw new Error('Check your username, program, and year level.')
    }
    const userId = state.user.id
    const { data, error } = await supabase.from('students')
      .update({ username: normalizedUsername, program: normalizedProgram, year_level: yearLevel })
      .eq('user_id', userId)
      .select('user_id, username, program, year_level, full_name, avatar_url')
      .single()
    if (error) throw error
    if (!isCompleteStudent(data, userId)) throw new Error('Your profile details could not be saved. Please try again.')
    setState(previous => previous.status === 'ready' && previous.user.id === userId
      ? { ...previous, student: data }
      : previous)
  }

  async function deleteAccount() {
    if (!supabase || state.status !== 'ready') throw new Error('Your session is not ready. Please try again.')
    const { error } = await supabase.rpc('cali_delete_own_account')
    if (error?.code === 'PGRST202') throw new Error('Account deletion has not been enabled for this Cali project yet.')
    if (error) throw error
    await supabase.auth.signOut({ scope: 'local' })
    ++requestId.current
    validatedUserId.current = null
    setState({ status: 'signedOut', user: null, student: null, message: null })
  }

  return <AuthContext.Provider value={{ state, reload, signOut, completeOnboarding, updateProfileDetails, deleteAccount }}>{children}</AuthContext.Provider>
}
