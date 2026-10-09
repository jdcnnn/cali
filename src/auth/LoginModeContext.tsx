/* oxlint-disable react/only-export-components -- provider and its paired hook intentionally share this module. */
import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { getPublicLoginMode } from '../lib/supabase'

type LoginMode = { allowPersonalGoogleLogin: boolean; loaded: boolean }
const LoginModeContext = createContext<LoginMode>({ allowPersonalGoogleLogin: false, loaded: false })

export function LoginModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<LoginMode>({ allowPersonalGoogleLogin: false, loaded: false })
  useEffect(() => {
    let active = true
    void getPublicLoginMode().then(value => { if (active) setMode({ ...value, loaded: true }) })
    return () => { active = false }
  }, [])
  return <LoginModeContext.Provider value={mode}>{children}</LoginModeContext.Provider>
}

export function useLoginMode() { return useContext(LoginModeContext) }
