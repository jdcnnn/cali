import type { JSONContent } from '@tiptap/react'
import { supabase } from './supabase'

export type ReviewerVisibility = 'private' | 'preview' | 'public'
export type AccessType = 'read' | 'copy'
export type VoteValue = -1 | 0 | 1

export type CommunityVoteResult = {
  userVote: VoteValue
  netVotes: number
  upvotes: number
  downvotes: number
}

export type CommunityCreator = {
  userId: string
  username: string
  avatarUrl: string | null
  program: string
  yearLevel: number
}

export type CommunitySubject = {
  id: string
  code: string
  title: string
  colorKey: string
}

export type CommunityReviewerCard = {
  id: string
  title: string
  description: string
  category: string
  subject?: CommunitySubject | null
  visibility: Exclude<ReviewerVisibility, 'private'>
  updatedAt: string
  publishedAt: string | null
  parentReviewerId: string | null
  rootReviewerId: string | null
  isVersion: boolean
  isOwner: boolean
  creator: CommunityCreator
  netVotes: number
  upvotes: number
  downvotes: number
  userVote: VoteValue
  usage7d: number
  usage30d: number
  studentUseCount: number
  excerpt: string
  isSaved?: boolean
}

export type CommunityContributor = {
  userId: string | null
  username: string
  avatarUrl: string | null
}

export type CommunityReviewer = CommunityReviewerCard & {
  content: JSONContent
  isFullContent: boolean
  visibleItemCount: number
  totalItemCount: number
  isOwner: boolean
  canCopy: boolean
  requestState: { id: string; type: AccessType; status: string } | null
  contributors: CommunityContributor[]
}

export type CommunityProfile = {
  userId: string
  username: string
  avatarUrl: string | null
  bio: string
  program: string
  yearLevel: number
  joinedAt: string
  isOwnProfile: boolean
}

export type CommunityRequest = {
  id: string
  type: AccessType
  status: 'pending' | 'approved' | 'denied' | 'cancelled'
  createdAt: string
  grantId: string | null
  reviewer: { id: string; title: string; visibility: ReviewerVisibility }
  student: { userId: string; username: string; avatarUrl: string | null }
}

export type CommunityReviewerAccess = {
  id: string
  type: AccessType
  createdAt: string
  reviewer: { id: string; title: string; visibility: ReviewerVisibility }
  student: { userId: string; username: string; avatarUrl: string | null }
}

export type CommunityNotification = {
  id: string
  kind: string
  title: string
  body: string
  url: string
  readAt: string | null
  archivedAt: string | null
  createdAt: string
}

export type CommunityNotificationPage = {
  items: CommunityNotification[]
  totalCount: number
  unreadCount: number
  page: number
  pageSize: number
}

export type CommunityInbox = {
  incoming: CommunityRequest[]
  access: CommunityReviewerAccess[]
  outgoing: CommunityRequest[]
  notifications: CommunityNotification[]
  unreadCount: number
}

export type CommunityReport = {
  id: string
  targetType: 'reviewer' | 'profile'
  targetId: string
  targetLabel: string
  reporter: string
  reason: string
  details: string | null
  status: string
  createdAt: string
}

export type CommunitySearchFilters = {
  query?: string
  category?: string
  program?: string
  yearLevel?: number | null
  visibility?: '' | 'public' | 'preview'
  ownerUsername?: string
  sort?: 'relevance' | 'trending' | 'top' | 'newest' | 'most_used'
  limit?: number
}

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Cali is not connected to the database.')
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data as T
}

async function rpcSingle<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Cali is not connected to the database.')
  const { data, error } = await supabase.rpc(name, args).single()
  if (error) throw error
  return data as T
}

export function searchCommunityReviewers(filters: CommunitySearchFilters = {}) {
  return rpc<CommunityReviewerCard[]>('cali_search_community_reviewers', {
    p_query: filters.query ?? '',
    p_category: filters.category || null,
    p_program: filters.program || null,
    p_year_level: filters.yearLevel ?? null,
    p_visibility: filters.visibility || null,
    p_owner_username: filters.ownerUsername || null,
    p_sort: filters.sort ?? 'relevance',
    p_limit: filters.limit ?? 36,
  })
}

export function getCommunityReviewer(reviewerId: string) {
  return rpc<CommunityReviewer>('cali_get_community_reviewer', { p_reviewer_id: reviewerId })
}

export function listSavedCommunityReviewers(limit = 48) {
  return rpc<CommunityReviewerCard[]>('cali_list_saved_reviewers', { p_limit: limit })
}

export function setCommunityReviewerSaved(reviewerId: string, saved: boolean) {
  return rpc<boolean>('cali_set_reviewer_saved', { p_reviewer_id: reviewerId, p_saved: saved })
}

export function getCommunityProfile(username: string) {
  return rpc<CommunityProfile>('cali_get_community_profile', { p_username: username })
}

export function setReviewerVisibility(reviewerId: string, visibility: ReviewerVisibility, description: string, category: string, subjectId: string | null) {
  return rpcSingle('cali_set_reviewer_visibility', { p_reviewer_id: reviewerId, p_visibility: visibility, p_description: description, p_category: category, p_subject_id: subjectId })
}

export function requestReviewerAccess(reviewerId: string, accessType: AccessType) {
  return rpc('cali_request_reviewer_access', { p_reviewer_id: reviewerId, p_access_type: accessType })
}

export function resolveReviewerAccess(requestId: string, approve: boolean) {
  return rpc('cali_resolve_reviewer_access', { p_request_id: requestId, p_approve: approve })
}

export function changeReviewerAccess(grantId: string, accessType: AccessType) {
  return rpc('cali_change_reviewer_access', { p_grant_id: grantId, p_access_type: accessType })
}

export function revokeReviewerAccess(grantId: string) {
  return rpc('cali_revoke_reviewer_access', { p_grant_id: grantId })
}

export function copyCommunityReviewer(reviewerId: string) {
  return rpcSingle<{ id: string }>('cali_copy_community_reviewer', { p_reviewer_id: reviewerId })
}

async function broadcastCommunityVoteUpdate(reviewerId: string) {
  const client = supabase
  if (!client) return
  const channel = client.channel('community-reviewer-votes')
  try {
    await channel.httpSend('vote-updated', { reviewerId })
  } finally {
    await client.removeChannel(channel)
  }
}

export async function voteCommunityReviewer(reviewerId: string, value: VoteValue) {
  const result = await rpc<CommunityVoteResult>('cali_vote_community_reviewer', { p_reviewer_id: reviewerId, p_value: value })
  // The vote is already durable. Realtime delivery is best-effort and must not
  // turn a successful reaction into an error for the student.
  void broadcastCommunityVoteUpdate(reviewerId).catch(() => undefined)
  return result
}

export function recordCommunityReviewerUse(reviewerId: string) {
  return rpc<void>('cali_record_community_reviewer_use', { p_reviewer_id: reviewerId })
}

export function reportCommunityTarget(targetType: 'reviewer' | 'profile', targetId: string, reason: string, details: string) {
  return rpc<string>('cali_report_community_target', { p_target_type: targetType, p_target_id: targetId, p_reason: reason, p_details: details || null })
}

export function getCommunityInbox() {
  return rpc<CommunityInbox>('cali_get_community_inbox')
}

export async function getCommunityNotificationPage(page = 1, pageSize = 10, archived = false): Promise<CommunityNotificationPage> {
  if (!supabase) throw new Error('Cali is not connected to the database.')
  const safePage = Math.max(1, Math.floor(page))
  const safePageSize = Math.min(25, Math.max(1, Math.floor(pageSize)))
  const from = (safePage - 1) * safePageSize
  const itemsQuery = supabase.from('community_notifications')
      .select('id, kind, title, body, url, read_at, archived_at, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + safePageSize - 1)
  const [itemsResult, unreadResult] = await Promise.all([
    archived ? itemsQuery.not('archived_at', 'is', null) : itemsQuery.is('archived_at', null),
    supabase.from('community_notifications')
      .select('id', { count: 'exact', head: true })
      .is('archived_at', null)
      .is('read_at', null),
  ])
  if (itemsResult.error) throw itemsResult.error
  if (unreadResult.error) throw unreadResult.error
  return {
    items: (itemsResult.data ?? []).map(row => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      url: row.url,
      readAt: row.read_at,
      archivedAt: row.archived_at,
      createdAt: row.created_at,
    })),
    totalCount: itemsResult.count ?? 0,
    unreadCount: unreadResult.count ?? 0,
    page: safePage,
    pageSize: safePageSize,
  }
}

export async function archiveCommunityNotification(notificationId: string) {
  if (!supabase) throw new Error('Cali is not connected to the database.')
  const { error } = await supabase.from('community_notifications')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', notificationId)
  if (error) throw error
}

export async function restoreCommunityNotification(notificationId: string) {
  if (!supabase) throw new Error('Cali is not connected to the database.')
  const { error } = await supabase.from('community_notifications')
    .update({ archived_at: null })
    .eq('id', notificationId)
  if (error) throw error
}

export function subscribeToCommunityNotifications(userId: string, onNotification: (notification: CommunityNotification) => void) {
  const client = supabase
  if (!client) return () => undefined
  const channel = client
    .channel(`community-notifications:${userId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'community_notifications',
      filter: `user_id=eq.${userId}`,
    }, payload => {
      const row = payload.new as Record<string, unknown>
      if (typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.body !== 'string') return
      onNotification({
        id: row.id,
        kind: typeof row.kind === 'string' ? row.kind : 'notice',
        title: row.title,
        body: row.body,
        url: typeof row.url === 'string' ? row.url : '/community?view=inbox',
        readAt: typeof row.read_at === 'string' ? row.read_at : null,
        archivedAt: typeof row.archived_at === 'string' ? row.archived_at : null,
        createdAt: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
      })
    })
    .subscribe()
  return () => { void client.removeChannel(channel) }
}

export function subscribeToCommunityAccessChanges(userId: string, onChange: () => void) {
  const client = supabase
  if (!client) return () => undefined
  const channel = client
    .channel(`community-access:${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reviewer_access_requests' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reviewer_access_grants' }, onChange)
    .subscribe()
  return () => { void client.removeChannel(channel) }
}

export function subscribeToCommunityVoteUpdates(onChange: (reviewerId: string) => void) {
  const client = supabase
  if (!client) return () => undefined
  const channel = client
    .channel('community-reviewer-votes')
    .on('broadcast', { event: 'vote-updated' }, message => {
      const reviewerId = (message.payload as { reviewerId?: unknown } | undefined)?.reviewerId
      if (typeof reviewerId === 'string') onChange(reviewerId)
    })
    .subscribe()
  return () => { void client.removeChannel(channel) }
}

export function markCommunityNotificationsRead() {
  return rpc<void>('cali_mark_community_notifications_read')
}

export function getCommunityAdminStatus() {
  return rpc<boolean>('cali_community_admin_status')
}

export function listCommunityReports() {
  return rpc<CommunityReport[]>('cali_list_community_reports')
}

export function moderateCommunityReport(reportId: string, action: 'dismiss' | 'hide', note = '') {
  return rpc<void>('cali_moderate_community_report', { p_report_id: reportId, p_action: action, p_note: note || null })
}
