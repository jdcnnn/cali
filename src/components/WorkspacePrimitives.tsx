import type { ReactNode } from 'react'
import '../styles/workspace-primitives.css'

type HeaderProps = {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
  titleId?: string
}

export function WorkspacePageHeader({ eyebrow, title, description, actions, className = '', titleId }: HeaderProps) {
  return <header className={`workspace-page-header${className ? ` ${className}` : ''}`}>
    <div className="workspace-page-header-copy">
      {eyebrow && <p className="workspace-overline">{eyebrow}</p>}
      <h1 id={titleId}>{title}</h1>
      {description && <p className="workspace-page-header-description">{description}</p>}
    </div>
    {actions && <div className="workspace-page-header-actions">{actions}</div>}
  </header>
}

export function WorkspaceSectionHeader({ eyebrow, title, description, actions, className = '', titleId }: HeaderProps) {
  return <header className={`workspace-section-header${className ? ` ${className}` : ''}`}>
    <div className="workspace-section-header-copy">
      {eyebrow && <p className="workspace-overline">{eyebrow}</p>}
      <h2 id={titleId}>{title}</h2>
      {description && <p>{description}</p>}
    </div>
    {actions && <div className="workspace-section-header-actions">{actions}</div>}
  </header>
}

export function WorkspaceEmptyState({ title, description, action, className = '' }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return <div className={`workspace-empty-state${className ? ` ${className}` : ''}`}>
    <strong>{title}</strong>
    {description && <p>{description}</p>}
    {action && <div>{action}</div>}
  </div>
}
