import { createClient } from 'npm:@supabase/supabase-js@2.110.2'
import webpush from 'npm:web-push@3.6.7'

type QueueItem = {
  id: string
  user_id: string
  item_type: 'class' | 'task' | 'event'
  item_id: string
  occurrence_at: string
  scheduled_for: string
  attempts: number
}

type PushSubscriptionRow = {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

const corsHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
const required = (name: string) => {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

function manilaTime(value: string) {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value))
}

function manilaDateKey(value: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value))
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function retryDelayMs(error: { headers?: Record<string, string> }, attempt: number) {
  const raw = error.headers?.['retry-after']
  const seconds = raw ? Number(raw) : Number.NaN
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 5 * 60_000)
  return Math.min(attempt, 3) * 60_000
}

Deno.serve(async request => {
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders })

  try {
    const cronSecret = required('CALI_CRON_SECRET')
    if (request.headers.get('x-cali-cron-secret') !== cronSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }

    webpush.setVapidDetails(required('VAPID_SUBJECT'), required('VAPID_PUBLIC_KEY'), required('VAPID_PRIVATE_KEY'))
    const admin = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await admin.rpc('cali_claim_due_reminders', { p_limit: 50 })
    if (error) throw error
    const reminders = (data ?? []) as QueueItem[]
    let sent = 0
    let missed = 0
    let retrying = 0

    for (const reminder of reminders) {
      const { data: subscriptions, error: subscriptionsError } = await admin.from('push_subscriptions')
        .select('id,endpoint,p256dh,auth').eq('user_id', reminder.user_id).eq('is_active', true)
      if (subscriptionsError) throw subscriptionsError

      const { data: deliveredRows, error: deliveredError } = await admin.from('reminder_deliveries')
        .select('subscription_id').eq('reminder_id', reminder.id)
      if (deliveredError) throw deliveredError
      const delivered = new Set((deliveredRows ?? []).map(row => row.subscription_id as string))

      let title = 'Cali reminder'
      let body = `Scheduled for ${manilaTime(reminder.occurrence_at)}`
      let url = '/calendar'
      let actionLabel = 'Open Cali'

      if (reminder.item_type === 'class') {
        const { data: meeting } = await admin.from('schedule_meetings')
          .select('room,schedule_subjects!inner(subject_code,title)').eq('id', reminder.item_id).maybeSingle()
        if (!meeting) {
          await admin.from('reminder_queue').update({ status: 'missed', last_error: 'Class no longer exists' }).eq('id', reminder.id)
          missed++
          continue
        }
        const subject = Array.isArray(meeting.schedule_subjects) ? meeting.schedule_subjects[0] : meeting.schedule_subjects
        title = `Class · ${subject.subject_code}`
        body = `${subject.title} • ${manilaTime(reminder.occurrence_at)}${meeting.room ? ` • ${meeting.room}` : ''}`
        url = `/schedules?meeting=${encodeURIComponent(reminder.item_id)}`
        actionLabel = 'View class'
      } else if (reminder.item_type === 'task') {
        const { data: task } = await admin.from('tasks')
          .select('title,status,schedule_subjects(subject_code,title)').eq('id', reminder.item_id).maybeSingle()
        if (!task || task.status === 'done') {
          await admin.from('reminder_queue').update({ status: 'missed', last_error: 'Task completed or deleted' }).eq('id', reminder.id)
          missed++
          continue
        }
        const subject = Array.isArray(task.schedule_subjects) ? task.schedule_subjects[0] : task.schedule_subjects
        title = `Task due · ${task.title}`
        body = `${subject ? `${subject.subject_code} • ${subject.title} • ` : ''}Due ${manilaTime(reminder.occurrence_at)}`
        url = `/tasks?task=${encodeURIComponent(reminder.item_id)}`
        actionLabel = 'View task'
      } else {
        const { data: event } = await admin.from('calendar_events').select('title,location').eq('id', reminder.item_id).maybeSingle()
        if (!event) {
          await admin.from('reminder_queue').update({ status: 'missed', last_error: 'Event no longer exists' }).eq('id', reminder.id)
          missed++
          continue
        }
        title = `Event · ${event.title}`
        body = `Starts ${manilaTime(reminder.occurrence_at)}${event.location ? ` • ${event.location}` : ''}`
        url = `/calendar?date=${manilaDateKey(reminder.occurrence_at)}&event=${encodeURIComponent(reminder.item_id)}`
        actionLabel = 'View event'
      }

      const pendingSubscriptions = (subscriptions as PushSubscriptionRow[]).filter(subscription => !delivered.has(subscription.id))
      let transientFailure = false
      let longestDelay = 60_000

      for (const subscription of pendingSubscriptions) {
        try {
          await webpush.sendNotification({
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          }, JSON.stringify({ title, body, tag: `cali-${reminder.item_type}-${reminder.item_id}`, url, actionLabel, itemType: reminder.item_type }), {
            TTL: 900,
            urgency: 'high',
          })
          const { error: deliveryError } = await admin.from('reminder_deliveries').upsert({
            reminder_id: reminder.id, subscription_id: subscription.id,
          }, { onConflict: 'reminder_id,subscription_id', ignoreDuplicates: true })
          if (deliveryError) throw deliveryError
          delivered.add(subscription.id)
        } catch (cause) {
          const pushError = cause as { statusCode?: number; headers?: Record<string, string>; message?: string }
          if (pushError.statusCode === 404 || pushError.statusCode === 410) {
            await admin.from('push_subscriptions').update({ is_active: false }).eq('id', subscription.id)
          } else {
            transientFailure = true
            longestDelay = Math.max(longestDelay, retryDelayMs(pushError, reminder.attempts))
          }
        }
      }

      const expiresAt = new Date(reminder.scheduled_for).getTime() + 15 * 60_000
      if (transientFailure && reminder.attempts < 3 && Date.now() + longestDelay <= expiresAt) {
        await admin.from('reminder_queue').update({
          status: 'pending', claim_token: null, claimed_at: null,
          next_attempt_at: new Date(Date.now() + longestDelay).toISOString(), last_error: 'Temporary push delivery failure',
        }).eq('id', reminder.id)
        retrying++
        continue
      }

      const terminalStatus = delivered.size > 0 ? 'sent' : 'missed'
      await admin.from('reminder_queue').update({
        status: terminalStatus,
        sent_at: terminalStatus === 'sent' ? new Date().toISOString() : null,
        claim_token: null,
        last_error: terminalStatus === 'missed' ? (subscriptions?.length ? 'Push delivery failed' : 'No active push subscriptions') : null,
      }).eq('id', reminder.id)
      if (terminalStatus === 'sent') sent++
      else missed++
      if (reminder.item_type === 'class') await admin.rpc('cali_queue_next_class_reminder', { p_meeting_id: reminder.item_id })
    }

    return new Response(JSON.stringify({ ok: true, claimed: reminders.length, sent, missed, retrying }), { headers: corsHeaders })
  } catch (cause) {
    console.error(cause)
    return new Response(JSON.stringify({ error: cause instanceof Error ? cause.message : 'Reminder dispatch failed' }), { status: 500, headers: corsHeaders })
  }
})
