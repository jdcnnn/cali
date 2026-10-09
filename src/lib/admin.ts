import type { JSONContent } from '@tiptap/react'
import { supabase } from './supabase'

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Cali is not connected to the database.')
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data as T
}

export type AdminOverview = { totalUsers: number; activeUsers: number; suspendedUsers: number; institutionalUsers: number; personalUsers: number; sharedReviewers: number; openReports: number; allowPersonalGoogleLogin: boolean }
export type AdminUser = { userId: string; username: string; fullName: string | null; email: string; program: string; yearLevel: number; isAdmin: boolean; suspendedAt: string | null; suspensionReason: string | null; createdAt: string; accountType: 'institutional' | 'personal' }
export type UserPage = { items: AdminUser[]; total: number; page: number; pageSize: number }
export type AdminReport = { id: string; targetType: 'reviewer' | 'profile'; targetId: string; targetLabel: string; reporter: string; reason: string; details: string | null; status: string; createdAt: string }
export type CommunitySearch = { reviewers: { id: string; title: string; username: string; visibility: string; hidden: boolean; reason: string | null }[]; profiles: { userId: string; username: string; fullName: string | null; hidden: boolean; suspended: boolean }[] }
export type AdminCommunityItem =
  | { type: 'reviewer'; id: string; title: string; description: string; category: string; visibility: 'public' | 'preview'; content: JSONContent; plainText: string; hidden: boolean; moderationReason: string | null; updatedAt: string; creator: { userId: string; username: string; fullName: string | null; avatarUrl: string | null; program: string; yearLevel: number; suspended: boolean } }
  | { type: 'profile'; id: string; username: string; fullName: string | null; avatarUrl: string | null; bio: string; program: string; yearLevel: number; joinedAt: string; hidden: boolean; suspended: boolean }
export type SystemSettings = { allowPersonalGoogleLogin: boolean; updatedAt: string; updatedBy: string | null }
export type AuditRow = { id: number; actor: string; action: string; targetType: string | null; targetId: string | null; details: Record<string, unknown>; createdAt: string }

export const getAdminOverview = () => rpc<AdminOverview>('cali_admin_overview')
export const searchAdminUsers = (query = '', status = 'all', accountType = 'all', page = 1) => rpc<UserPage>('cali_admin_search_users', { p_query: query, p_status: status, p_account_type: accountType, p_page: page, p_page_size: 25 })
export const setUserSuspension = (userId: string, suspended: boolean, reason: string) => rpc<void>('cali_admin_set_user_suspension', { p_user_id: userId, p_suspended: suspended, p_reason: reason })
export const listAdminReports = () => rpc<AdminReport[]>('cali_admin_list_reports', { p_status: 'open' })
export const resolveAdminReport = (reportId: string, action: 'dismiss' | 'hide', reason: string) => rpc<void>('cali_admin_resolve_report', { p_report_id: reportId, p_action: action, p_reason: reason })
export const searchAdminCommunity = (query = '') => rpc<CommunitySearch>('cali_admin_search_community', { p_query: query, p_target_type: 'all' })
export const getAdminCommunityItem = (targetType: 'reviewer' | 'profile', targetId: string) => rpc<AdminCommunityItem>('cali_admin_get_community_item', { p_target_type: targetType, p_target_id: targetId })
export const setCommunityVisibility = (targetType: 'reviewer' | 'profile', targetId: string, hidden: boolean, reason: string) => rpc<void>('cali_admin_set_community_visibility', { p_target_type: targetType, p_target_id: targetId, p_hidden: hidden, p_reason: reason })
export const getAdminSystemSettings = () => rpc<SystemSettings>('cali_admin_get_system_settings')
export const setPersonalLogin = (allowed: boolean) => rpc<SystemSettings>('cali_admin_set_personal_login', { p_allowed: allowed })
export const getAuditHistory = () => rpc<AuditRow[]>('cali_admin_audit_history', { p_limit: 80 })
