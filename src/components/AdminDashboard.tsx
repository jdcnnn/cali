/* oxlint-disable react/set-state-in-effect -- async route data and modal state intentionally synchronize through effects. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Link,
  NavLink,
  Navigate,
  useParams,
  useSearchParams,
} from "react-router";
import { useAuth } from "../auth/AuthContext";
import { supabase } from "../lib/supabase";
import {
  getAdminCommunityItem,
  getAdminEnforcementCase,
  getAdminOverview,
  getAdminSystemSettings,
  getAuditHistory,
  listAdminReports,
  resolveAdminReport,
  searchAdminCommunity,
  searchAdminUsers,
  setCommunityVisibility,
  setPersonalLogin,
  setUserSuspension,
} from "../lib/admin";
import type {
  AdminCommunityItem,
  AdminEnforcementCase,
  AdminOverview,
  AdminReport,
  AdminReportedUser,
  AdminUser,
  AuditPage,
  AuditRow,
  CommunitySearch,
  SystemSettings,
} from "../lib/admin";
import { formatYearLevel } from "../lib/academic";
import { ThemePicker } from "../theme/ThemePicker";
import { CaliWordmark, ProfileAvatar } from "./CaliWordmark";
import { ConfirmationIcon } from "./ConfirmationIcon";
import type { ConfirmationIconKind } from "./ConfirmationIcon";
import { AdminModerationPanel } from "./AdminModerationPanel";
import { AdminHandbook } from "./GuidePages";
import "./admin-dashboard.css";
import "./admin-dashboard-identity.css";
import "./admin-readability.css";
import "./admin-overview.css";
import "./admin-users.css";

type Section = "overview" | "moderation" | "users" | "system" | "handbook";
type IconName =
  | Section
  | "workspace"
  | "signout"
  | "search"
  | "menu"
  | "close"
  | "shield"
  | "activity"
  | "chevron"
  | "eye";
type ActionRequest = {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "default" | "danger";
  icon?: ConfirmationIconKind;
  cancelLabel?: string;
  busyLabel?: string;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  onConfirm: (reason: string) => Promise<void>;
};

const sections: { key: Section; label: string; hint: string }[] = [
  { key: "overview", label: "Overview", hint: "Operations at a glance" },
  {
    key: "moderation",
    label: "Moderation",
    hint: "Reports and shared content",
  },
  { key: "users", label: "Users", hint: "Access and suspensions" },
  { key: "system", label: "System", hint: "Login policy and audit" },
  { key: "handbook", label: "Handbook", hint: "Features and admin logic" },
];
const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : "The action could not be completed.";

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    overview: (
      <>
        <rect x="3" y="3" width="8" height="8" rx="1.5" />
        <rect x="13" y="3" width="8" height="8" rx="1.5" />
        <rect x="3" y="13" width="8" height="8" rx="1.5" />
        <rect x="13" y="13" width="8" height="8" rx="1.5" />
      </>
    ),
    moderation: (
      <>
        <path d="M12 3 4.5 6v5.4c0 4.7 3.1 8.1 7.5 9.6 4.4-1.5 7.5-4.9 7.5-9.6V6L12 3Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5" />
      </>
    ),
    system: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    ),
    handbook: (
      <>
        <path d="M4 4.5h11a3 3 0 0 1 3 3V20H7a3 3 0 0 1-3-3V4.5Z" />
        <path d="M7 16.5h11M8 8h6m-6 4h7" />
      </>
    ),
    workspace: (
      <>
        <path d="M4 5h16v14H4z" />
        <path d="M4 9h16M9 9v10" />
      </>
    ),
    signout: (
      <>
        <path d="M10 17l5-5-5-5M15 12H3" />
        <path d="M12 3h6a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-6" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m15.5 15.5 5 5" />
      </>
    ),
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    close: <path d="m5 5 14 14M19 5 5 19" />,
    shield: (
      <>
        <path d="M12 3 4.5 6v5.4c0 4.7 3.1 8.1 7.5 9.6 4.4-1.5 7.5-4.9 7.5-9.6V6L12 3Z" />
        <path d="M12 8v4m0 4h.01" />
      </>
    ),
    eye: (
      <>
        <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
        <circle cx="12" cy="12" r="2.7" />
      </>
    ),
    activity: <path d="M3 12h4l2.3-6 4.2 12 2.3-6H21" />,
    chevron: <path d="m9 5 7 7-7 7" />,
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function useDebouncedValue(value: string, delay = 280) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}
function PageHeader({
  eyebrow,
  title,
  description,
  meta,
}: {
  eyebrow: string;
  title: string;
  description: string;
  meta?: ReactNode;
}) {
  return (
    <header className="admin-page-header">
      <div>
        <p className="admin-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {meta && <div className="admin-page-meta">{meta}</div>}
    </header>
  );
}
function Panel({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`admin-panel ${className}`}>
      <header className="admin-panel-head">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
function EmptyState({
  icon = "activity",
  title,
  detail,
}: {
  icon?: IconName;
  title: string;
  detail: string;
}) {
  return (
    <div className="admin-empty">
      <span>
        <Icon name={icon} />
      </span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}
function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="admin-skeleton" role="status" aria-label={label}>
      <span />
      <span />
      <span />
    </div>
  );
}
function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="admin-notice" role="alert">
      <Icon name="shield" />
      <span>{children}</span>
    </div>
  );
}

function ActionDialog({
  action,
  onClose,
}: {
  action: ActionRequest | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    setReason("");
    setError("");
    setBusy(false);
    if (action?.reasonLabel)
      window.setTimeout(() => reasonRef.current?.focus(), 0);
  }, [action]);
  if (!action) return null;
  const reasonRequired = Boolean(action.reasonLabel);
  async function confirm() {
    if (busy || (reasonRequired && reason.trim().length < 3)) return;
    setBusy(true);
    setError("");
    try {
      await action!.onConfirm(reason.trim());
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  }
  const icon = busy
    ? "loading"
    : (action.icon ?? (action.tone === "danger" ? "warning" : "confirmation"));
  return (
    <div
      className="admin-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className={`admin-dialog${action.icon === "signout" ? " admin-dialog--signout" : ""}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="admin-dialog-title"
        aria-describedby="admin-dialog-description"
      >
        <ConfirmationIcon kind={icon} />
        <h2 id="admin-dialog-title">{action.title}</h2>
        <p id="admin-dialog-description" className="admin-dialog-description">
          {action.description}
        </p>
        {action.reasonLabel && (
          <label className="admin-dialog-field">
            <span>{action.reasonLabel}</span>
            <textarea
              ref={reasonRef}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              placeholder={action.reasonPlaceholder}
              disabled={busy}
            />
            <small>
              {reason.trim().length < 3
                ? "Enter at least 3 characters."
                : `${reason.length}/500`}
            </small>
          </label>
        )}
        {error && (
          <p className="admin-dialog-error" role="alert">
            {error}
          </p>
        )}
        <div className="admin-dialog-actions">
          <button
            className="admin-button admin-dialog-cancel"
            onClick={onClose}
            disabled={busy}
          >
            {action.cancelLabel ?? "Cancel"}
          </button>
          <button
            className={`admin-button ${action.tone === "danger" ? "admin-button--danger" : "admin-button--primary"}`}
            onClick={() => void confirm()}
            disabled={busy || (reasonRequired && reason.trim().length < 3)}
          >
            {busy ? (action.busyLabel ?? "Updating…") : action.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function describeAudit(row: AuditRow) {
  const reason =
    typeof row.details.reason === "string" && row.details.reason.trim()
      ? row.details.reason.trim()
      : null;
  const target =
    row.targetLabel ||
    (row.targetType ? `Unknown ${row.targetType}` : "System");
  switch (row.action) {
    case "user.suspended":
      return {
        title: "Account suspended",
        detail: `${target} lost access to Cali.${reason ? ` Reason: ${reason}` : ""}`,
      };
    case "user.restored":
      return {
        title: "Account restored",
        detail: `${target} regained access to Cali.${reason ? ` Note: ${reason}` : ""}`,
      };
    case "community.hidden":
      return {
        title: `${row.targetType === "profile" ? "Profile" : "Reviewer"} hidden from Community`,
        detail: `${target} is no longer visible in Community.${reason ? ` Reason: ${reason}` : ""}`,
      };
    case "community.restored":
      return {
        title: `${row.targetType === "profile" ? "Profile" : "Reviewer"} restored to Community`,
        detail: `${target} is visible in Community again.${reason ? ` Note: ${reason}` : ""}`,
      };
    case "report.dismiss":
      return {
        title: "Report dismissed",
        detail: `${target} remained visible and the report was closed.${reason ? ` Resolution: ${reason}` : ""}`,
      };
    case "report.hide":
      return {
        title: `Reported ${row.targetType === "profile" ? "profile" : "reviewer"} hidden`,
        detail: `${target} was hidden and the report was resolved.${reason ? ` Resolution: ${reason}` : ""}`,
      };
    case "system.personal_login_changed":
      return row.details.allowed === true
        ? {
            title: "Personal Google accounts allowed",
            detail:
              "Google sign-in was opened to verified personal and Google Workspace accounts.",
          }
        : {
            title: "Sign-in limited to RTU accounts",
            detail:
              "New access was restricted to verified @rtu.edu.ph accounts and administrators.",
          };
    default:
      return {
        title: row.action
          .replaceAll(".", " ")
          .replace(/\b\w/g, (value) => value.toUpperCase()),
        detail: target,
      };
  }
}

function AuditList({
  audit,
  page,
  onPageChange,
}: {
  audit: AuditPage;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(audit.total / audit.pageSize));
  return (
    <Panel
      title="Recent admin activity"
      description="A plain-language record of who changed what, when, and why."
      className="admin-audit-panel"
    >
      {audit.items.length === 0 ? (
        <EmptyState
          title="No admin activity yet"
          detail="Confirmed changes will appear here with their actor and timestamp."
        />
      ) : (
        <>
          <div className="admin-timeline">
            {audit.items.map((row) => {
              const copy = describeAudit(row);
              return (
                <article key={row.id}>
                  <span className="admin-timeline-dot">
                    <Icon name="activity" />
                  </span>
                  <div>
                    <strong>{copy.title}</strong>
                    <p>{copy.detail}</p>
                  </div>
                  <div>
                    <span>Changed by @{row.actor}</span>
                    <time dateTime={row.createdAt}>
                      {new Intl.DateTimeFormat("en-PH", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(row.createdAt))}
                    </time>
                  </div>
                </article>
              );
            })}
          </div>
          {audit.total > audit.pageSize && (
            <footer className="admin-pagination admin-audit-pagination">
              <button
                className="admin-button admin-button--quiet"
                disabled={page <= 1}
                onClick={() => onPageChange(page - 1)}
              >
                Previous
              </button>
              <span>
                Page {page} of {pageCount} · {audit.total} activities
              </span>
              <button
                className="admin-button admin-button--quiet"
                disabled={page >= pageCount}
                onClick={() => onPageChange(page + 1)}
              >
                Next
              </button>
            </footer>
          )}
        </>
      )}
    </Panel>
  );
}

function OverviewActivity({ audit }: { audit: AuditPage }) {
  return (
    <section
      className="admin-overview-section admin-overview-activity"
      aria-labelledby="overview-activity-title"
    >
      <header>
        <div>
          <p className="admin-overview-label">RECENT CHANGES</p>
          <h2 id="overview-activity-title">What changed</h2>
        </div>
        <Link to="/admin/system">
          View audit log <Icon name="chevron" />
        </Link>
      </header>
      {audit.items.length === 0 ? (
        <div className="admin-overview-empty">
          <strong>No admin activity yet</strong>
          <p>Confirmed changes will appear here.</p>
        </div>
      ) : (
        <div className="admin-overview-activity-list">
          {audit.items.map((row) => {
            const copy = describeAudit(row);
            return (
              <article key={row.id}>
                <span className="admin-overview-activity-mark" />
                <div>
                  <strong>{copy.title}</strong>
                  <p>{copy.detail}</p>
                  <small>
                    @{row.actor} ·{" "}
                    <time dateTime={row.createdAt}>
                      {new Intl.DateTimeFormat("en-PH", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      }).format(new Date(row.createdAt))}
                    </time>
                  </small>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function OverviewReportSignals({ users }: { users: AdminReportedUser[] }) {
  return (
    <section
      className="admin-overview-section admin-overview-report-signals"
      aria-labelledby="overview-report-signals-title"
    >
      <header>
        <div>
          <p className="admin-overview-label">REVIEWER REPORT SIGNALS</p>
          <h2 id="overview-report-signals-title">Accounts to watch</h2>
          <p>
            Pending reports need review. Confirmed reports show prior moderation
            decisions and support manual enforcement.
          </p>
        </div>
        <Link to="/admin/users">
          View users <Icon name="chevron" />
        </Link>
      </header>
      {users.length === 0 ? (
        <div className="admin-overview-empty">
          <strong>No reported accounts</strong>
          <p>
            Accounts with reports awaiting review or confirmed violations will
            appear here.
          </p>
        </div>
      ) : (
        <div className="admin-overview-report-list">
          {users.map((user) => (
            <Link
              key={user.userId}
              to={`/admin/users?focus=${encodeURIComponent(user.username)}&view=enforcement`}
            >
              <ProfileAvatar
                name={user.fullName || user.username}
                className="admin-overview-report-avatar"
              />
              <div>
                <strong>{user.fullName || `@${user.username}`}</strong>
                <span>
                  @{user.username}
                  {user.suspended ? " · Access suspended" : ""}
                </span>
              </div>
              <dl>
                {user.pendingReportCount > 0 && (
                  <div className="has-pending">
                    <dt>Awaiting review</dt>
                    <dd>{user.pendingReportCount}</dd>
                  </div>
                )}
                {user.confirmedReportCount > 0 && (
                  <div>
                    <dt>Violations</dt>
                    <dd>{user.confirmedReportCount}</dd>
                  </div>
                )}
              </dl>
              <Icon name="chevron" />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function Overview({ liveVersion }: { liveVersion: number }) {
  const [data, setData] = useState<AdminOverview | null>(null),
    [audit, setAudit] = useState<AuditPage | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    void Promise.all([getAdminOverview(), getAuditHistory(1, 4)])
      .then(([overview, nextAudit]) => {
        setData(overview);
        setAudit(nextAudit);
        setError("");
      })
      .catch((cause) => setError(errorMessage(cause)));
  }, [liveVersion]);
  return (
    <>
      <PageHeader
        eyebrow="CALI ADMINISTRATION"
        title="Overview"
        description="A focused view of what needs attention and where to act."
        meta={
          data && (
            <span
              className={`admin-policy-pill ${data.allowPersonalGoogleLogin ? "is-open" : ""}`}
            >
              <i />
              {data.allowPersonalGoogleLogin
                ? "All Google accounts"
                : "RTU accounts only"}
            </span>
          )
        }
      />
      {error && <Notice>{error}</Notice>}
      {!data || !audit ? (
        <LoadingState label="Loading overview" />
      ) : (
        <div className="admin-overview">
          <section
            className={`admin-overview-priority ${data.openReports ? "has-attention" : ""}`}
            aria-labelledby="overview-priority-title"
          >
            <div className="admin-overview-priority-icon">
              <Icon name={data.openReports ? "moderation" : "shield"} />
            </div>
            <div>
              <p className="admin-overview-label">
                {data.openReports ? "NEEDS ATTENTION" : "CURRENT PRIORITY"}
              </p>
              <h2 id="overview-priority-title">
                {data.openReports
                  ? `${data.openReports} community report${data.openReports === 1 ? "" : "s"} waiting`
                  : "Community queue is clear"}
              </h2>
              <p>
                {data.openReports
                  ? "Review the report details and decide whether the reviewer should remain visible."
                  : "There are no open reports. No moderation action is required right now."}
              </p>
            </div>
            <Link to="/admin/moderation">
              {data.openReports ? "Review reports" : "Open moderation"}
              <Icon name="chevron" />
            </Link>
          </section>
          <section
            className="admin-overview-status"
            aria-labelledby="overview-status-title"
          >
            <header>
              <p className="admin-overview-label">OPERATING STATUS</p>
              <h2 id="overview-status-title">Cali at a glance</h2>
            </header>
            <div>
              <Link to="/admin/users">
                <span className="admin-overview-status-label">User access</span>
                <div className="admin-overview-status-copy">
                  <strong>
                    {data.activeUsers} active{" "}
                    {data.activeUsers === 1 ? "account" : "accounts"}
                  </strong>
                  <div className="admin-overview-status-details">
                    <span>
                      {data.institutionalUsers} RTU{" "}
                      {data.institutionalUsers === 1 ? "account" : "accounts"}
                    </span>
                    <span>
                      {data.personalUsers} personal{" "}
                      {data.personalUsers === 1 ? "account" : "accounts"}
                    </span>
                    {data.suspendedUsers > 0 && (
                      <span className="is-warning">
                        {data.suspendedUsers} suspended
                      </span>
                    )}
                  </div>
                </div>
                <Icon name="chevron" />
              </Link>
              <Link to="/admin/moderation">
                <span className="admin-overview-status-label">Community</span>
                <div className="admin-overview-status-copy">
                  <strong>
                    {data.sharedReviewers} shared{" "}
                    {data.sharedReviewers === 1 ? "reviewer" : "reviewers"}
                  </strong>
                  <small>Review public study materials and reports</small>
                </div>
                <Icon name="chevron" />
              </Link>
              <Link to="/admin/system">
                <span className="admin-overview-status-label">
                  Sign-in access
                </span>
                <div className="admin-overview-status-copy">
                  <strong>
                    {data.allowPersonalGoogleLogin
                      ? "All Google accounts"
                      : "RTU accounts only"}
                  </strong>
                  <small>
                    {data.allowPersonalGoogleLogin
                      ? "RTU and personal Google accounts are allowed"
                      : "Only verified RTU school accounts are allowed"}
                  </small>
                </div>
                <Icon name="chevron" />
              </Link>
            </div>
          </section>
          <OverviewReportSignals users={data.reportedUsers ?? []} />
          <div className="admin-overview-lower">
            <section
              className="admin-overview-section admin-overview-workspace"
              aria-labelledby="overview-workspace-title"
            >
              <header>
                <div>
                  <p className="admin-overview-label">ADMIN WORKSPACE</p>
                  <h2 id="overview-workspace-title">Choose what to work on</h2>
                </div>
              </header>
              <nav aria-label="Admin workspace shortcuts">
                <Link to="/admin/users">
                  <span>
                    <Icon name="users" />
                  </span>
                  <div>
                    <strong>Users</strong>
                    <p>Profiles, access, and suspensions</p>
                  </div>
                  <Icon name="chevron" />
                </Link>
                <Link to="/admin/moderation">
                  <span>
                    <Icon name="moderation" />
                  </span>
                  <div>
                    <strong>Moderation</strong>
                    <p>Reports and reviewer visibility</p>
                  </div>
                  {data.openReports > 0 && <b>{data.openReports}</b>}
                  <Icon name="chevron" />
                </Link>
                <Link to="/admin/system">
                  <span>
                    <Icon name="system" />
                  </span>
                  <div>
                    <strong>System</strong>
                    <p>Sign-in policy and audit history</p>
                  </div>
                  <Icon name="chevron" />
                </Link>
              </nav>
            </section>
            <OverviewActivity audit={audit} />
          </div>
        </div>
      )}
    </>
  );
}

function AdminPublicProfilePreview({
  user,
  profile,
  loading,
  error,
  onClose,
}: {
  user: AdminUser | null;
  profile: AdminCommunityItem | null;
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
  if (!user) return null;
  const publicProfile = profile?.type === "profile" ? profile : null;
  const sharedReviewerCount =
    publicProfile?.sharedReviewerCount ?? user.sharedReviewerCount;
  const hasSharedReviewerCount = Number.isFinite(sharedReviewerCount);
  return (
    <div
      className="admin-user-profile-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="admin-user-profile-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-user-profile-title"
      >
        <header>
          <div>
            <span>PUBLIC PROFILE</span>
            <h2 id="admin-user-profile-title">@{user.username}</h2>
          </div>
          <button aria-label="Close public profile" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        {loading ? (
          <LoadingState label="Loading public profile" />
        ) : error ? (
          <Notice>{error}</Notice>
        ) : (
          publicProfile && (
            <>
              <div className="admin-user-profile-hero">
                <ProfileAvatar
                  name={publicProfile.fullName || publicProfile.username}
                  src={publicProfile.avatarUrl}
                  className="admin-user-profile-avatar"
                />
                <div>
                  <span>Visible in Community</span>
                  <h3>
                    {publicProfile.fullName || `@${publicProfile.username}`}
                  </h3>
                  <p>@{publicProfile.username}</p>
                </div>
              </div>
              <dl className="admin-user-profile-facts">
                <div>
                  <dt>Program</dt>
                  <dd>{publicProfile.program || "Not provided"}</dd>
                </div>
                <div>
                  <dt>Year level</dt>
                  <dd>{formatYearLevel(publicProfile.yearLevel)}</dd>
                </div>
                <div>
                  <dt>Joined</dt>
                  <dd>
                    {new Intl.DateTimeFormat("en-PH", {
                      month: "long",
                      year: "numeric",
                    }).format(new Date(publicProfile.joinedAt))}
                  </dd>
                </div>
                <div>
                  <dt>Shared reviewers</dt>
                  <dd>
                    {hasSharedReviewerCount
                      ? sharedReviewerCount
                      : "Unavailable"}
                  </dd>
                </div>
              </dl>
              <section className="admin-user-profile-bio">
                <span>Public bio</span>
                <p>{publicProfile.bio || "No public bio provided."}</p>
              </section>
              <footer>
                <p>
                  <Icon name="shield" />
                  Only information already visible on the user’s Community
                  profile is shown here.
                </p>
                <Link
                  className="admin-button admin-button--quiet admin-button--small"
                  to="/admin/moderation"
                  onClick={onClose}
                >
                  Review shared content
                </Link>
              </footer>
            </>
          )
        )}
      </section>
    </div>
  );
}

function EnforcementCasePreview({
  user,
  enforcement,
  loading,
  error,
  onClose,
  onSuspend,
}: {
  user: AdminUser | null;
  enforcement: AdminEnforcementCase | null;
  loading: boolean;
  error: string;
  onClose: () => void;
  onSuspend: (user: AdminUser) => void;
}) {
  if (!user) return null;
  const statusCopy =
    enforcement?.status === "monitoring"
      ? "Monitoring"
      : enforcement?.status === "warning"
        ? "Formal warning"
        : enforcement?.status === "suspension_review"
          ? "Suspension review"
          : enforcement?.status === "suspended"
            ? "Suspended"
            : enforcement?.status === "closed"
              ? "Closed"
              : "No confirmed case";
  return (
    <div
      className="admin-user-profile-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="admin-enforcement-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-enforcement-title"
      >
        <header>
          <div>
            <span>ACCOUNT ENFORCEMENT</span>
            <h2 id="admin-enforcement-title">@{user.username}</h2>
          </div>
          <button aria-label="Close enforcement record" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        {loading ? (
          <LoadingState label="Loading enforcement record" />
        ) : error ? (
          <Notice>{error}</Notice>
        ) : (
          <>
            <div className="admin-enforcement-summary">
              <div>
                <span>Current stage</span>
                <strong>{statusCopy}</strong>
              </div>
              <div>
                <span>Confirmed incidents</span>
                <strong>{enforcement?.confirmedIncidentCount ?? 0}</strong>
              </div>
              <p>
                <Icon name="shield" />
                Only administrator-confirmed reviewer violations become
                suspension evidence. Reports awaiting review do not affect
                access.
              </p>
            </div>
            {enforcement && enforcement.pendingReports.length > 0 && (
              <section className="admin-enforcement-pending">
                <header>
                  <div>
                    <span>REPORT QUEUE</span>
                    <h3>Awaiting admin review</h3>
                  </div>
                  <strong>
                    {enforcement.pendingReports.length}{" "}
                    {enforcement.pendingReports.length === 1
                      ? "report"
                      : "reports"}
                  </strong>
                </header>
                {enforcement.pendingReports.map((report) => (
                  <article key={report.id}>
                    <div>
                      <strong>{report.reviewerTitle}</strong>
                      <span>
                        {report.reason} · Reported by @{report.reporter}
                      </span>
                    </div>
                    <Link
                      className="admin-button admin-button--quiet admin-button--small"
                      to={`/admin/moderation?reviewer=${report.reviewerId}&report=${report.id}`}
                      onClick={onClose}
                    >
                      Review report
                    </Link>
                  </article>
                ))}
              </section>
            )}
            {(!enforcement ||
              (enforcement.pendingReports.length === 0 &&
                enforcement.reports.length === 0)) && (
              <div className="admin-enforcement-empty">
                <span>
                  <Icon name="shield" />
                </span>
                <div>
                  <strong>No actionable reports</strong>
                  <p>
                    This account has no reports awaiting review and no confirmed
                    enforcement evidence.
                  </p>
                </div>
              </div>
            )}
            {enforcement && enforcement.reports.length > 0 && (
              <section className="admin-enforcement-evidence">
                <header>
                  <div>
                    <span>ENFORCEMENT EVIDENCE</span>
                    <h3>Confirmed violations</h3>
                  </div>
                  <strong>
                    {enforcement.reports.length}{" "}
                    {enforcement.reports.length === 1 ? "report" : "reports"}
                  </strong>
                </header>
                {enforcement.reports.map((report) => (
                  <article key={report.id}>
                    <header>
                      <div>
                        <span>CONFIRMED REVIEWER</span>
                        <h3>{report.reviewerTitle}</h3>
                      </div>
                      <time dateTime={report.confirmedAt}>
                        {new Intl.DateTimeFormat("en-PH", {
                          dateStyle: "medium",
                        }).format(new Date(report.confirmedAt))}
                      </time>
                    </header>
                    <dl>
                      <div>
                        <dt>Report reason</dt>
                        <dd>{report.reason}</dd>
                      </div>
                      {report.details && (
                        <div>
                          <dt>Reporter details</dt>
                          <dd>{report.details}</dd>
                        </div>
                      )}
                      <div>
                        <dt>Admin resolution</dt>
                        <dd>{report.resolutionNote}</dd>
                      </div>
                    </dl>
                    <footer>
                      <span>
                        Reported by @{report.reporter} · Confirmed by{" "}
                        {report.confirmedBy
                          ? `@${report.confirmedBy}`
                          : "an administrator"}
                      </span>
                      <Link
                        to={`/admin/moderation?reviewer=${report.reviewerId}`}
                        onClick={onClose}
                      >
                        Inspect reviewer <Icon name="chevron" />
                      </Link>
                    </footer>
                  </article>
                ))}
              </section>
            )}
            {enforcement?.status === "suspension_review" &&
              !user.suspendedAt &&
              !user.isAdmin && (
                <footer>
                  <button
                    className="admin-button admin-button--danger admin-button--small"
                    onClick={() => {
                      onClose();
                      onSuspend(user);
                    }}
                  >
                    Suspend with this evidence
                  </button>
                </footer>
              )}
          </>
        )}
      </section>
    </div>
  );
}

function UserDirectoryCard({
  user,
  onChange,
  onViewProfile,
  onReviewReports,
}: {
  user: AdminUser;
  onChange: (user: AdminUser, suspended: boolean) => void;
  onViewProfile: (user: AdminUser) => void;
  onReviewReports: (user: AdminUser) => void;
}) {
  const reportSignalCount =
    user.pendingReviewerReportCount + user.confirmedReviewerReportCount;
  const reportSummary = [
    user.pendingReviewerReportCount > 0
      ? `${user.pendingReviewerReportCount} awaiting review`
      : "",
    user.confirmedReviewerReportCount > 0
      ? `${user.confirmedReviewerReportCount} confirmed ${user.confirmedReviewerReportCount === 1 ? "violation" : "violations"}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <article
      className={`admin-user-card ${user.suspendedAt ? "is-suspended" : ""}`}
    >
      <header className="admin-user-identity">
        <ProfileAvatar
          name={user.fullName || user.username}
          src={user.avatarUrl}
          className="admin-user-card-avatar"
        />
        <div>
          <h3>{user.fullName || `@${user.username}`}</h3>
          <span>@{user.username}</span>
          <a href={`mailto:${user.email}`}>{user.email}</a>
        </div>
      </header>
      <dl className="admin-user-details">
        <div>
          <dt>Program</dt>
          <dd>{user.program || "Not provided"}</dd>
        </div>
        <div>
          <dt>Year level</dt>
          <dd>{formatYearLevel(user.yearLevel)}</dd>
        </div>
        <div>
          <dt>Joined</dt>
          <dd>
            {new Intl.DateTimeFormat("en-PH", {
              month: "short",
              year: "numeric",
            }).format(new Date(user.createdAt))}
          </dd>
        </div>
      </dl>
      <div className="admin-user-access">
        <div className="admin-account-tags">
          <span>
            {user.accountType === "institutional"
              ? "RTU school account"
              : "Personal Google account"}
          </span>
          {user.isAdmin && <span className="is-admin">Administrator</span>}
          <span className={user.suspendedAt ? "is-suspended" : "is-active"}>
            {user.suspendedAt ? "Access suspended" : "Active account"}
          </span>
        </div>
        {reportSignalCount > 0 && (
          <button
            className="admin-user-report-count"
            aria-label={`Reviewer reports: ${reportSummary}; open enforcement record`}
            onClick={() => onReviewReports(user)}
          >
            <Icon name="moderation" />
            <span>Reviewer reports</span>
            <strong
              className={
                user.pendingReviewerReportCount > 0
                  ? "is-pending"
                  : "is-confirmed"
              }
            >
              {reportSummary}
            </strong>
            <Icon name="chevron" />
          </button>
        )}
        <div className="admin-user-card-actions">
          <button
            className="admin-button admin-button--quiet admin-button--small"
            onClick={() => onViewProfile(user)}
          >
            <Icon name="eye" />
            View public profile
          </button>
          {!user.isAdmin && (
            <button
              className={`admin-button admin-button--small ${user.suspendedAt ? "admin-button--quiet" : "admin-button--danger-quiet"}`}
              onClick={() => onChange(user, !user.suspendedAt)}
            >
              {user.suspendedAt ? "Restore access" : "Suspend access"}
            </button>
          )}
        </div>
      </div>
      {user.suspendedAt && (
        <p className="admin-user-suspension">
          <strong>Suspension reason</strong>
          {user.suspensionReason || "No reason was recorded."}
        </p>
      )}
    </article>
  );
}

function Users({
  requestAction,
  liveVersion,
}: {
  requestAction: (action: ActionRequest) => void;
  liveVersion: number;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const focusedUsername = searchParams.get("focus")?.trim() ?? "";
  const [users, setUsers] = useState<AdminUser[]>([]),
    [query, setQuery] = useState(focusedUsername),
    [status, setStatus] = useState("all"),
    [account, setAccount] = useState("all"),
    [reportStatus, setReportStatus] = useState("all"),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [profileTarget, setProfileTarget] = useState<AdminUser | null>(null),
    [profilePreview, setProfilePreview] = useState<AdminCommunityItem | null>(
      null,
    ),
    [profileLoading, setProfileLoading] = useState(false),
    [profileError, setProfileError] = useState("");
  const [enforcementTarget, setEnforcementTarget] = useState<AdminUser | null>(
      null,
    ),
    [enforcementCase, setEnforcementCase] =
      useState<AdminEnforcementCase | null>(null),
    [enforcementLoading, setEnforcementLoading] = useState(false),
    [enforcementError, setEnforcementError] = useState("");
  const debouncedQuery = useDebouncedValue(query);
  const load = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoading(true);
      setError("");
      try {
        const data = await searchAdminUsers(
          debouncedQuery,
          status,
          account,
          reportStatus,
          page,
        );
        setUsers(data.items);
        setTotal(data.total);
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [account, debouncedQuery, page, reportStatus, status],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (liveVersion > 0) void load(false);
  }, [liveVersion, load]);
  useEffect(() => {
    if (!profileTarget) {
      setProfilePreview(null);
      setProfileError("");
      return;
    }
    setProfileLoading(true);
    setProfilePreview(null);
    setProfileError("");
    void getAdminCommunityItem("profile", profileTarget.userId)
      .then(setProfilePreview)
      .catch((cause) => setProfileError(errorMessage(cause)))
      .finally(() => setProfileLoading(false));
  }, [profileTarget]);
  useEffect(() => {
    if (!enforcementTarget) {
      setEnforcementCase(null);
      setEnforcementError("");
      return;
    }
    setEnforcementLoading(true);
    setEnforcementCase(null);
    setEnforcementError("");
    void getAdminEnforcementCase(enforcementTarget.userId)
      .then(setEnforcementCase)
      .catch((cause) => setEnforcementError(errorMessage(cause)))
      .finally(() => setEnforcementLoading(false));
  }, [enforcementTarget]);
  useEffect(() => {
    if (
      loading ||
      searchParams.get("view") !== "enforcement" ||
      !focusedUsername
    )
      return;
    const focusedUser = users.find(
      (user) => user.username.toLowerCase() === focusedUsername.toLowerCase(),
    );
    if (focusedUser)
      setEnforcementTarget((current) =>
        current?.userId === focusedUser.userId ? current : focusedUser,
      );
  }, [focusedUsername, loading, searchParams, users]);
  useEffect(() => {
    if (loading || searchParams.get("view") !== "profile" || !focusedUsername)
      return;
    const focusedUser = users.find(
      (user) => user.username.toLowerCase() === focusedUsername.toLowerCase(),
    );
    if (focusedUser)
      setProfileTarget((current) =>
        current?.userId === focusedUser.userId ? current : focusedUser,
      );
  }, [focusedUsername, loading, searchParams, users]);
  function change(user: AdminUser, suspended: boolean) {
    requestAction({
      title: `${suspended ? "Suspend" : "Restore"} @${user.username}?`,
      description: suspended
        ? "They will immediately lose access to Cali. Their private data is preserved, and their Community content will be hidden until restoration."
        : "Their Cali access and eligible Community content will be restored.",
      confirmLabel: suspended ? "Suspend account" : "Restore account",
      tone: suspended ? "danger" : "default",
      reasonLabel: suspended ? "Suspension reason" : "Restoration note",
      reasonPlaceholder: suspended
        ? "Explain why this account is being suspended…"
        : "Record why this account is being restored…",
      onConfirm: async (reason) => {
        await setUserSuspension(user.userId, suspended, reason);
        await load();
      },
    });
  }
  function closeEnforcement() {
    setEnforcementTarget(null);
    if (searchParams.has("focus") || searchParams.has("view")) {
      const next = new URLSearchParams(searchParams);
      next.delete("focus");
      next.delete("view");
      setSearchParams(next, { replace: true });
    }
  }
  function closeProfile() {
    setProfileTarget(null);
    if (
      searchParams.has("focus") ||
      searchParams.has("view") ||
      searchParams.has("report")
    ) {
      const next = new URLSearchParams(searchParams);
      next.delete("focus");
      next.delete("view");
      next.delete("report");
      setSearchParams(next, { replace: true });
    }
  }
  const filtersActive =
    status !== "all" || account !== "all" || reportStatus !== "all";
  const firstResult = total === 0 ? 0 : (page - 1) * 25 + 1;
  const lastResult = Math.min(page * 25, total);
  return (
    <>
      <PageHeader
        eyebrow="PEOPLE & ACCESS"
        title="Users"
        description="Review profiles and manage who can access Cali."
        meta={
          <span className="admin-count">
            {total} {total === 1 ? "account" : "accounts"}
          </span>
        }
      />
      <Panel
        title="User directory"
        description="Search account details, review student information, and manage access."
        className="admin-directory"
        action={
          <div className="admin-search admin-user-search">
            <Icon name="search" />
            <input
              aria-label="Search users"
              placeholder="Search people or email"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
            {query && (
              <button aria-label="Clear search" onClick={() => setQuery("")}>
                <Icon name="close" />
              </button>
            )}
          </div>
        }
      >
        <div className="admin-user-toolbar">
          <div className="admin-user-filters">
            <label>
              <span>Account status</span>
              <div>
                <select
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">Any status</option>
                  <option value="active">Active accounts</option>
                  <option value="suspended">Suspended accounts</option>
                  <option value="admin">Administrators</option>
                </select>
                <Icon name="chevron" />
              </div>
            </label>
            <label>
              <span>Sign-in account</span>
              <div>
                <select
                  value={account}
                  onChange={(event) => {
                    setAccount(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">Any account type</option>
                  <option value="institutional">RTU school accounts</option>
                  <option value="personal">Personal Google accounts</option>
                </select>
                <Icon name="chevron" />
              </div>
            </label>
            <label>
              <span>Reviewer reports</span>
              <div>
                <select
                  value={reportStatus}
                  onChange={(event) => {
                    setReportStatus(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">Any report status</option>
                  <option value="pending">Awaiting admin review</option>
                  <option value="confirmed">Confirmed violations</option>
                  <option value="reported">Any actionable report</option>
                  <option value="none">No actionable reports</option>
                </select>
                <Icon name="chevron" />
              </div>
            </label>
            {filtersActive && (
              <button
                className="admin-user-clear-filters"
                onClick={() => {
                  setStatus("all");
                  setAccount("all");
                  setReportStatus("all");
                  setPage(1);
                }}
              >
                Clear filters
              </button>
            )}
          </div>
          <p aria-live="polite">
            {loading
              ? "Updating results…"
              : total === 0
                ? "No matching accounts"
                : `Showing ${firstResult}–${lastResult} of ${total} accounts`}
          </p>
        </div>
        {error && <Notice>{error}</Notice>}
        {loading ? (
          <LoadingState label="Loading users" />
        ) : users.length === 0 ? (
          <EmptyState
            icon="users"
            title="No accounts found"
            detail="Try changing your search or clearing the filters."
          />
        ) : (
          <div className="admin-user-directory-list">
            {users.map((user) => (
              <UserDirectoryCard
                key={user.userId}
                user={user}
                onChange={change}
                onViewProfile={setProfileTarget}
                onReviewReports={setEnforcementTarget}
              />
            ))}
          </div>
        )}
        {total > 25 && (
          <footer className="admin-pagination admin-user-pagination">
            <button
              className="admin-button admin-button--quiet admin-button--small"
              disabled={page === 1 || loading}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous
            </button>
            <span>
              Page {page} of {Math.max(1, Math.ceil(total / 25))}
            </span>
            <button
              className="admin-button admin-button--quiet admin-button--small"
              disabled={page * 25 >= total || loading}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </button>
          </footer>
        )}
      </Panel>
      <AdminPublicProfilePreview
        user={profileTarget}
        profile={profilePreview}
        loading={profileLoading}
        error={profileError}
        onClose={closeProfile}
      />
      <EnforcementCasePreview
        user={enforcementTarget}
        enforcement={enforcementCase}
        loading={enforcementLoading}
        error={enforcementError}
        onClose={closeEnforcement}
        onSuspend={(user) => change(user, true)}
      />
    </>
  );
}

export function LegacyModeration({
  requestAction,
}: {
  requestAction: (action: ActionRequest) => void;
}) {
  const [reports, setReports] = useState<AdminReport[]>([]),
    [content, setContent] = useState<CommunitySearch>({
      reviewers: [],
      profiles: [],
    }),
    [query, setQuery] = useState(""),
    [tab, setTab] = useState<"reviewers" | "profiles">("reviewers"),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const debouncedQuery = useDebouncedValue(query);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextReports, nextContent] = await Promise.all([
        listAdminReports(),
        searchAdminCommunity(debouncedQuery),
      ]);
      setReports(nextReports);
      setContent(nextContent);
      setError("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery]);
  useEffect(() => {
    void load();
  }, [load]);
  function resolve(report: AdminReport, action: "dismiss" | "hide") {
    requestAction({
      title:
        action === "hide"
          ? `Hide ${report.targetLabel || "reported content"}?`
          : "Dismiss this report?",
      description:
        action === "hide"
          ? "The content will no longer be visible in Community. You can restore it later from the content review list."
          : "The report will be closed without changing the content’s visibility.",
      confirmLabel: action === "hide" ? "Hide and resolve" : "Dismiss report",
      tone: action === "hide" ? "danger" : "default",
      reasonLabel: "Resolution note",
      reasonPlaceholder: "Record the reason for this decision…",
      onConfirm: async (reason) => {
        await resolveAdminReport(report.id, action, reason);
        await load();
      },
    });
  }
  function visibility(
    type: "reviewer" | "profile",
    id: string,
    hidden: boolean,
    label: string,
  ) {
    requestAction({
      title: `${hidden ? "Hide" : "Restore"} ${label}?`,
      description: hidden
        ? "This item will disappear from Community but remain intact for its owner."
        : "This item will return to Community unless its creator is suspended.",
      confirmLabel: hidden ? "Hide content" : "Restore content",
      tone: hidden ? "danger" : "default",
      reasonLabel: "Moderation reason",
      reasonPlaceholder: "Explain this visibility change…",
      onConfirm: async (reason) => {
        await setCommunityVisibility(type, id, hidden, reason);
        await load();
      },
    });
  }
  const visibleItems =
    tab === "reviewers" ? content.reviewers : content.profiles;
  return (
    <>
      <PageHeader
        eyebrow="COMMUNITY SAFETY"
        title="Moderation"
        description="Review reports and manage the visibility of shared Community content."
        meta={
          <span className={`admin-count ${reports.length ? "has-alert" : ""}`}>
            {reports.length} open report{reports.length === 1 ? "" : "s"}
          </span>
        }
      />
      {error && <Notice>{error}</Notice>}
      <Panel
        title="Report queue"
        description="Reports are private and shown newest first."
      >
        {loading ? (
          <LoadingState label="Loading reports" />
        ) : reports.length === 0 ? (
          <EmptyState
            icon="moderation"
            title="No open reports"
            detail="New Community reports will appear here for review."
          />
        ) : (
          <div className="admin-report-list">
            {reports.map((report) => (
              <article key={report.id}>
                <span className="admin-report-icon">
                  <Icon name="shield" />
                </span>
                <div>
                  <strong>{report.targetLabel || "Unavailable target"}</strong>
                  <p>
                    <span>{report.targetType}</span> · reported by @
                    {report.reporter}
                  </p>
                  <small>
                    <b>{report.reason}</b>
                    {report.details ? ` — ${report.details}` : ""}
                  </small>
                </div>
                <div>
                  <button
                    className="admin-button admin-button--quiet admin-button--small"
                    onClick={() => resolve(report, "dismiss")}
                  >
                    Dismiss
                  </button>
                  <button
                    className="admin-button admin-button--danger-quiet admin-button--small"
                    onClick={() => resolve(report, "hide")}
                  >
                    Hide
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </Panel>
      <Panel
        title="Community content"
        description="Search shared reviewers and public profiles proactively."
        className="admin-content-review"
        action={
          <div className="admin-search">
            <Icon name="search" />
            <input
              aria-label="Search Community content"
              placeholder="Search Community"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button aria-label="Clear search" onClick={() => setQuery("")}>
                <Icon name="close" />
              </button>
            )}
          </div>
        }
      >
        <div className="admin-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === "reviewers"}
            onClick={() => setTab("reviewers")}
          >
            Reviewers <span>{content.reviewers.length}</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === "profiles"}
            onClick={() => setTab("profiles")}
          >
            Profiles <span>{content.profiles.length}</span>
          </button>
        </div>
        {loading ? (
          <LoadingState label="Loading Community content" />
        ) : visibleItems.length === 0 ? (
          <EmptyState
            icon="search"
            title="Nothing found"
            detail={
              query
                ? "Try a broader search."
                : `No ${tab} are available to review.`
            }
          />
        ) : (
          <div className="admin-content-list">
            {tab === "reviewers"
              ? content.reviewers.map((item) => (
                  <article key={item.id}>
                    <span className="admin-content-icon">
                      <Icon name="workspace" />
                    </span>
                    <div>
                      <strong>{item.title}</strong>
                      <p>
                        by @{item.username} · {item.visibility}
                      </p>
                      {item.hidden && (
                        <small>
                          Hidden{item.reason ? ` · ${item.reason}` : ""}
                        </small>
                      )}
                    </div>
                    <span
                      className={`admin-visibility ${item.hidden ? "is-hidden" : ""}`}
                    >
                      {item.hidden ? "Hidden" : "Visible"}
                    </span>
                    <button
                      className={`admin-button admin-button--small ${item.hidden ? "admin-button--quiet" : "admin-button--danger-quiet"}`}
                      onClick={() =>
                        visibility(
                          "reviewer",
                          item.id,
                          !item.hidden,
                          item.title,
                        )
                      }
                    >
                      {item.hidden ? "Restore" : "Hide"}
                    </button>
                  </article>
                ))
              : content.profiles.map((item) => (
                  <article key={item.userId}>
                    <ProfileAvatar
                      name={item.fullName || item.username}
                      className="admin-content-avatar"
                    />
                    <div>
                      <strong>@{item.username}</strong>
                      <p>
                        {item.fullName || "Public profile"}
                        {item.suspended ? " · Suspended account" : ""}
                      </p>
                    </div>
                    <span
                      className={`admin-visibility ${item.hidden ? "is-hidden" : ""}`}
                    >
                      {item.hidden ? "Hidden" : "Visible"}
                    </span>
                    <button
                      className={`admin-button admin-button--small ${item.hidden ? "admin-button--quiet" : "admin-button--danger-quiet"}`}
                      onClick={() =>
                        visibility(
                          "profile",
                          item.userId,
                          !item.hidden,
                          `@${item.username}`,
                        )
                      }
                    >
                      {item.hidden ? "Restore" : "Hide"}
                    </button>
                  </article>
                ))}
          </div>
        )}
      </Panel>
    </>
  );
}

function Moderation({
  requestAction,
  liveVersion,
}: {
  requestAction: (action: ActionRequest) => void;
  liveVersion: number;
}) {
  return (
    <AdminModerationPanel
      requestAction={requestAction}
      liveVersion={liveVersion}
    />
  );
}

function System({
  requestAction,
  liveVersion,
}: {
  requestAction: (action: ActionRequest) => void;
  liveVersion: number;
}) {
  const [settings, setSettings] = useState<SystemSettings | null>(null),
    [audit, setAudit] = useState<AuditPage | null>(null),
    [auditPage, setAuditPage] = useState(1),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [nextSettings, nextAudit] = await Promise.all([
        getAdminSystemSettings(),
        getAuditHistory(auditPage),
      ]);
      setSettings(nextSettings);
      setAudit(nextAudit);
      setError("");
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [auditPage]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (liveVersion > 0) void load();
  }, [liveVersion, load]);
  function toggle() {
    if (!settings) return;
    const allowed = !settings.allowPersonalGoogleLogin;
    requestAction({
      title: allowed
        ? "Allow personal Google accounts?"
        : "Return to RTU-only access?",
      description: allowed
        ? "Any verified Google or Google Workspace account will be able to sign up and use Cali."
        : "Existing personal-email users will lose access on their next authorization check. Their data will remain intact, and personal-email administrators keep access.",
      confirmLabel: allowed ? "Allow personal accounts" : "Use RTU-only access",
      tone: allowed ? "default" : "danger",
      onConfirm: async () => {
        setSettings(await setPersonalLogin(allowed));
        setAuditPage(1);
        setAudit(await getAuditHistory(1));
      },
    });
  }
  return (
    <>
      <PageHeader
        eyebrow="ACCESS & SECURITY"
        title="System"
        description="Control login eligibility and review the permanent administration trail."
      />
      {error && <Notice>{error}</Notice>}
      {!settings ? (
        <LoadingState label="Loading system settings" />
      ) : (
        <Panel
          title="Google account access"
          description="This policy is enforced by the database for every protected request."
          className="admin-policy-panel"
        >
          <div className="admin-policy-row">
            <span
              className={`admin-policy-icon ${settings.allowPersonalGoogleLogin ? "is-open" : ""}`}
            >
              <Icon name="shield" />
            </span>
            <div>
              <strong>Allow personal Google accounts</strong>
              <p>
                {settings.allowPersonalGoogleLogin
                  ? "Any verified Google account can access Cali."
                  : "Only verified @rtu.edu.ph accounts and existing administrators can access Cali."}
              </p>
              <small>
                Last updated{" "}
                {new Intl.DateTimeFormat("en-PH", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(settings.updatedAt))}
                {settings.updatedBy ? ` by @${settings.updatedBy}` : ""}
              </small>
            </div>
            <button
              className={`admin-switch ${settings.allowPersonalGoogleLogin ? "is-on" : ""}`}
              role="switch"
              aria-checked={settings.allowPersonalGoogleLogin}
              aria-label="Allow personal Google accounts"
              onClick={toggle}
            >
              <span />
            </button>
          </div>
        </Panel>
      )}
      {audit ? (
        <AuditList audit={audit} page={auditPage} onPageChange={setAuditPage} />
      ) : (
        <LoadingState label="Loading admin activity" />
      )}
    </>
  );
}

export function AdminDashboard() {
  const { state, signOut } = useAuth();
  const { section } = useParams();
  const [menuOpen, setMenuOpen] = useState(false);
  const [action, setAction] = useState<ActionRequest | null>(null);
  const [liveVersion, setLiveVersion] = useState(0);
  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [section]);
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);
  useEffect(() => {
    const client = supabase;
    if (!client || state.status !== "ready" || !state.isAdmin) return;
    const channel = client
      .channel("admin-controls")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "admin_audit_log" },
        () => setLiveVersion((version) => version + 1),
      )
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [state]);
  if (state.status === "loading")
    return (
      <main className="admin-loading-screen">
        <CaliWordmark />
        <span className="admin-loading-pulse" />
        <p>Opening administration…</p>
      </main>
    );
  if (state.status === "signedOut") return <Navigate to="/login" replace />;
  if (state.status === "needsOnboarding")
    return <Navigate to="/onboarding" replace />;
  if (state.status === "ineligible")
    return <Navigate to="/access-denied" replace />;
  if (state.status === "error") return <Navigate to="/" replace />;
  if (!state.isAdmin) return <Navigate to="/dashboard" replace />;
  const active = (
    sections.some((item) => item.key === section) ? section : "overview"
  ) as Section;
  const activeLabel =
    sections.find((item) => item.key === active)?.label ?? "Overview";
  const requestSignOut = () =>
    setAction({
      title: "Sign out of Cali?",
      description:
        "You can sign in again with an eligible verified Google account.",
      confirmLabel: "Sign out",
      cancelLabel: "Stay signed in",
      busyLabel: "Signing out…",
      icon: "signout",
      onConfirm: signOut,
    });
  return (
    <main className="admin-shell">
      {menuOpen && (
        <button
          className="admin-backdrop"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside
        className={`admin-sidebar ${menuOpen ? "is-open" : ""}`}
        aria-label="Administration navigation"
      >
        <header className="admin-sidebar-head">
          <Link to="/admin" aria-label="Cali admin overview">
            <CaliWordmark />
          </Link>
          <button
            aria-label="Close navigation"
            onClick={() => setMenuOpen(false)}
          >
            <Icon name="close" />
          </button>
        </header>
        <nav>
          <div className="admin-nav-caption">
            <p>ADMIN CONSOLE</p>
            <span>@{state.student.username}</span>
          </div>
          {sections.map((item) => (
            <NavLink
              key={item.key}
              to={item.key === "overview" ? "/admin" : `/admin/${item.key}`}
              end
              className={({ isActive }) => (isActive ? "is-active" : "")}
            >
              <span>
                <Icon name={item.key} />
              </span>
              <div>
                <strong>{item.label}</strong>
                <small>{item.hint}</small>
              </div>
              <i />
            </NavLink>
          ))}
        </nav>
        <footer>
          <Link className="admin-side-action" to="/dashboard">
            <span className="admin-side-action-icon">
              <Icon name="workspace" />
            </span>
            <span className="admin-side-action-copy">
              <small>WORKSPACE</small>
              <strong>Open student view</strong>
            </span>
            <Icon name="chevron" />
          </Link>
          <div className="admin-sidebar-tools">
            <ThemePicker />
            <button className="admin-signout" onClick={requestSignOut}>
              <Icon name="signout" />
              <span>Sign out</span>
            </button>
          </div>
        </footer>
      </aside>
      <div className="admin-main">
        <header className="admin-mobile-header">
          <button
            aria-label="Open navigation"
            onClick={() => setMenuOpen(true)}
          >
            <Icon name="menu" />
          </button>
          <CaliWordmark />
          <span>{activeLabel}</span>
        </header>
        <div className="admin-content">
          {active === "overview" ? (
            <Overview liveVersion={liveVersion} />
          ) : active === "users" ? (
            <Users requestAction={setAction} liveVersion={liveVersion} />
          ) : active === "moderation" ? (
            <Moderation requestAction={setAction} liveVersion={liveVersion} />
          ) : active === "handbook" ? (
            <AdminHandbook />
          ) : (
            <System requestAction={setAction} liveVersion={liveVersion} />
          )}
        </div>
      </div>
      <ActionDialog action={action} onClose={() => setAction(null)} />
    </main>
  );
}
