import { useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router'
import { supabase } from '../lib/supabase'
import { StatusIcon } from './StatusIcon'
import './dashboard-schedules.css'
import './skeleton.css'

type DayCode = 'M' | 'T' | 'W' | 'H' | 'F' | 'S' | 'U'
type Subject = { id: string; subject_code: string; title: string; block_section: string }
type Meeting = { id: string; subject_id: string; day_code: DayCode; starts_at: string; ends_at: string; room: string | null }

const weekdayIndex: Record<DayCode, number> = { U: 0, M: 1, T: 2, W: 3, H: 4, F: 5, S: 6 }

function nextStart(meeting: Meeting, now: Date) {
  const [hour, minute] = meeting.starts_at.split(':').map(Number)
  const date = new Date(now)
  date.setDate(now.getDate() + (weekdayIndex[meeting.day_code] - now.getDay() + 7) % 7)
  date.setHours(hour, minute, 0, 0)
  if (date.getTime() < now.getTime()) date.setDate(date.getDate() + 7)
  return date
}

function isHappeningNow(meeting: Meeting, now: Date) {
  if (weekdayIndex[meeting.day_code] !== now.getDay()) return false
  const [startHour, startMinute] = meeting.starts_at.split(':').map(Number)
  const [endHour, endMinute] = meeting.ends_at.split(':').map(Number)
  const currentMinute = now.getHours() * 60 + now.getMinutes()
  return currentMinute >= startHour * 60 + startMinute && currentMinute < endHour * 60 + endMinute
}

function clock(time: string) {
  const [hour, minute] = time.split(':').map(Number)
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`
}

function dayLabel(date: Date, now: Date) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  if (day.getTime() === today.getTime()) return 'Today'
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  if (day.getTime() === tomorrow.getTime()) return 'Tomorrow'
  return new Intl.DateTimeFormat('en-PH', { weekday: 'long' }).format(date)
}

function timeRemaining(meeting: Meeting, now: Date) {
  const [endHour, endMinute] = meeting.ends_at.split(':').map(Number)
  const end = endHour * 60 + endMinute
  const current = now.getHours() * 60 + now.getMinutes()
  const remaining = end - current
  const hours = Math.floor(remaining / 60)
  const minutes = remaining % 60
  return [hours && `${hours} hr`, minutes && `${minutes} min`].filter(Boolean).join(' ')
}

export function DashboardSchedules({ studentId, now }: { studentId: string; now: Date }) {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    async function load() {
      if (!supabase) throw new Error('Supabase is not configured.')
      const { data: subjectRows, error: subjectError } = await supabase.from('schedule_subjects')
        .select('id,subject_code,title,block_section').eq('user_id', studentId)
      if (subjectError) throw subjectError
      const nextSubjects = (subjectRows ?? []) as Subject[]
      let nextMeetings: Meeting[] = []
      if (nextSubjects.length) {
        const { data: meetingRows, error: meetingError } = await supabase.from('schedule_meetings')
          .select('id,subject_id,day_code,starts_at,ends_at,room').in('subject_id', nextSubjects.map(subject => subject.id))
        if (meetingError) throw meetingError
        nextMeetings = (meetingRows ?? []) as Meeting[]
      }
      if (!active) return
      setSubjects(nextSubjects)
      setMeetings(nextMeetings)
      setError('')
      setLoading(false)
    }
    const timer = window.setTimeout(() => {
      void load().catch(() => {
        if (!active) return
        setError('Could not load your upcoming classes.')
        setLoading(false)
      })
    }, 0)
    return () => { active = false; window.clearTimeout(timer) }
  }, [studentId, retry])

  const { happeningNow, upcoming } = useMemo(() => {
    const byId = new Map(subjects.map(subject => [subject.id, subject]))
    const entries = meetings.flatMap(meeting => {
      const subject = byId.get(meeting.subject_id)
      return subject ? [{ meeting, subject, starts: nextStart(meeting, now) }] : []
    })
    return {
      happeningNow: entries.filter(({ meeting }) => isHappeningNow(meeting, now))
        .sort((a, b) => a.meeting.starts_at.localeCompare(b.meeting.starts_at)),
      upcoming: entries.filter(({ meeting }) => !isHappeningNow(meeting, now))
        .sort((a, b) => a.starts.getTime() - b.starts.getTime() || a.subject.subject_code.localeCompare(b.subject.subject_code)).slice(0, 3),
    }
  }, [subjects, meetings, now])

  const todayMeetings = meetings.filter(meeting => weekdayIndex[meeting.day_code] === now.getDay())
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const hasLaterToday = todayMeetings.some(meeting => {
    const [hour, minute] = meeting.starts_at.split(':').map(Number)
    return hour * 60 + minute > currentMinutes
  })
  const dayMessage = !todayMeetings.length
    ? { title: 'No classes today', detail: 'Enjoy the break.', icon: 'sun' as const }
    : !happeningNow.length && !hasLaterToday
      ? { title: 'All classes finished', detail: "You're done for today.", icon: 'check' as const }
      : null

  return <section className="dashboard-schedules" aria-labelledby="dashboard-schedules-title">
    <div className="dashboard-schedules-head"><h2 id="dashboard-schedules-title">Your classes</h2><NavLink to="/schedules" className="dashboard-schedules-all">View schedule</NavLink></div>
    {loading ? <div className="dashboard-schedules-skeleton" role="status" aria-label="Loading your classes"><div aria-hidden="true">{[0, 1, 2].map(index => <div className="dashboard-skeleton-row" key={index}><span className="cali-skeleton cali-skeleton-line cali-skeleton-line--short" /><span className="dashboard-skeleton-main"><span className="cali-skeleton cali-skeleton-line cali-skeleton-line--medium" /><span className="cali-skeleton cali-skeleton-line cali-skeleton-line--long" /></span><span className="cali-skeleton cali-skeleton-line cali-skeleton-line--full" /></div>)}</div></div>
      : error ? <div className="dashboard-schedules-state"><p>{error}</p><button type="button" onClick={() => { setLoading(true); setRetry(value => value + 1) }}>Try again</button></div>
        : meetings.length ? <div className={`dashboard-schedules-layout${upcoming.length ? '' : ' dashboard-schedules-layout--single'}`}>
          {dayMessage && <div className="dashboard-day-message"><StatusIcon name={dayMessage.icon} /><strong>{dayMessage.title}</strong><p>{dayMessage.detail}</p></div>}
          {happeningNow.length > 0 && <div className="dashboard-current-list">{happeningNow.map(({ meeting, subject }) => {
            return <div className="dashboard-current" key={meeting.id}>
              <div className="dashboard-current-head"><h3><span aria-hidden="true" /> Happening now</h3><span>{timeRemaining(meeting, now)} left</span></div>
              <div className="dashboard-current-subject"><strong>{subject.subject_code}</strong><p>{subject.title}</p></div>
              <div className="dashboard-current-details"><div><small>CLASS TIME</small><strong>{clock(meeting.starts_at)} – {clock(meeting.ends_at)}</strong></div><div><small>{meeting.room ? 'ROOM' : 'SECTION'}</small><strong>{meeting.room || subject.block_section}</strong></div></div>
            </div>
          })}</div>}
          {upcoming.length > 0 && <div className="dashboard-upcoming">{(happeningNow.length > 0 || dayMessage) && <h3 className="dashboard-upcoming-title">Next classes</h3>}<div className="dashboard-schedules-list">{upcoming.map(({ meeting, subject, starts }) => <div className="dashboard-class" key={meeting.id}>
            <span className="dashboard-class-day"><strong>{dayLabel(starts, now)}</strong><small>{new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' }).format(starts)}</small></span>
            <span className="dashboard-class-main"><strong>{subject.subject_code}</strong><span>{subject.title}</span></span>
            <span className="dashboard-class-details"><strong>{clock(meeting.starts_at)} – {clock(meeting.ends_at)}</strong><small>{meeting.room ? `Room ${meeting.room}` : subject.block_section}</small></span>
          </div>)}</div></div>}
        </div>
          : <div className="dashboard-schedules-state dashboard-schedules-empty"><StatusIcon name="calendar" /><div><strong>Your schedule is empty</strong><p>Add a class meeting to start planning your week.</p></div><NavLink to="/schedules">Add a schedule</NavLink></div>}
  </section>
}
