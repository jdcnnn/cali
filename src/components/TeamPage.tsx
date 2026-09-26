import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { CaliWordmark } from './CaliWordmark'
import { SiteFooter } from './SiteFooter'
import { ThemePicker } from '../theme/ThemePicker'
import { startGoogleSignIn } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import jadePhoto from '../assets/jade-cunanan-temp.png'
import ramPhoto from '../assets/ram.jpg'
import carlPhoto from '../assets/carl.jpg'
import carloPhoto from '../assets/carlo.jpg'
import './entry.css'

type TeamMember = {
  id: string
  name: string
  role: string
  bio: string
  photo?: string
}

const teamMembers: TeamMember[] = [
  {
    id: '01',
    name: 'Jade Cunanan',
    role: 'Lead Developer',
    bio: 'Develops Cali’s core systems and technical architecture across the backend, database, and frontend.',
    photo: jadePhoto,
  },
  {
    id: '02',
    name: 'Ram Joshua Acorio',
    role: 'System Analyst',
    bio: 'Analyzes Cali’s system requirements and processes, helping translate user needs into practical system specifications.',
    photo: ramPhoto,
  },
  {
    id: '03',
    name: 'Carl Danelle David',
    role: 'Quality Assurance Engineer',
    bio: 'Tests Cali’s features and workflows to ensure functionality, reliability, and a consistent user experience.',
    photo: carlPhoto,
  },
  {
    id: '04',
    name: 'Markcarlo Saligan',
    role: 'Project Manager',
    bio: 'Coordinates Cali’s development efforts, project planning, and team collaboration to keep the project on track.',
    photo: carloPhoto,
  },
]

export function TeamPage() {
  const { state } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { window.scrollTo(0, 0) }, [])
  const workspacePath = state.status === 'ready' ? '/dashboard' : state.status === 'needsOnboarding' ? '/onboarding' : null

  async function signIn() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await startGoogleSignIn()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not connect to Google. Please try again.')
      setBusy(false)
    }
  }

  return <div className="entry-page team-page">
    <a className="entry-skip" href="#team-main">Skip to content</a>
    <header className="team-header">
      <div className="entry-container team-header-inner">
        <Link to="/" aria-label="Cali home"><CaliWordmark /></Link>
        <div className="team-header-actions"><ThemePicker /><Link className="team-back" to={workspacePath ?? '/'}>{workspacePath ? state.status === 'ready' ? 'Dashboard' : 'Continue setup' : 'Back to Cali'}</Link></div>
      </div>
    </header>

    <main className="entry-container team-main" id="team-main">
      <div className="team-intro">
        <p className="entry-kicker">THE PEOPLE BEHIND CALI</p>
        <h1>Meet the <em>Cali team.</em></h1>
        <p>Four people bringing Cali together for RTU students.</p>
      </div>

      <div className="team-grid" aria-label="Cali team members">
        {teamMembers.map((member) => <article className="team-card" key={member.id}>
          <div className="team-photo">
            {member.photo ? <img src={member.photo} alt={member.name} /> : <span>Photo {member.id}</span>}
          </div>
          <div className="team-card-copy">
            <h2>{member.name}</h2>
            <p className="team-role">{member.role}</p>
            <p className="team-bio">{member.bio}</p>
          </div>
        </article>)}
      </div>

      <section className="team-cta" aria-labelledby="team-cta-title">
        <div>
          <p className="entry-kicker">{workspacePath ? 'YOUR WORKSPACE' : 'GET STARTED'}</p>
          <h2 id="team-cta-title">{workspacePath ? 'Continue where you left off.' : 'Make Cali your academic space.'}</h2>
          <p>{workspacePath ? 'Your Cali session is active on this device.' : 'Sign in with your institutional email.'}</p>
          {error && <p className="team-cta-error" role="alert">{error}</p>}
        </div>
        {workspacePath
          ? <Link className="team-cta-link" to={workspacePath}>{state.status === 'ready' ? 'Open workspace' : 'Continue setup'} <span aria-hidden="true">→</span></Link>
          : <button className="team-cta-link" type="button" onClick={() => { void signIn() }} disabled={busy || state.status === 'loading'}>{state.status === 'loading' ? 'Checking session...' : busy ? 'Connecting to Google...' : 'Start with Cali now'} <span aria-hidden="true">→</span></button>}
      </section>
    </main>

    <SiteFooter />
  </div>
}
