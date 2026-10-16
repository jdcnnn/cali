import { useEffect } from 'react'
import { Link, useLocation } from 'react-router'
import { CaliWordmark } from './CaliWordmark'
import { BackToTop } from './BackToTop'
import '../styles/entry.css'
import '../styles/policy-pages.css'

type PolicyKind = 'terms' | 'privacy' | 'community'
type PolicySection = { id: string; title: string; paragraphs?: string[]; bullets?: string[] }
type PolicyReturnState = { from?: string; backLabel?: string; view?: 'student' | 'admin'; previousState?: unknown }

const documents: Record<PolicyKind, { title: string; summary: string; sections: PolicySection[] }> = {
  "terms": {
    "title": "Terms and conditions",
    "summary": "Your account, your content, and the rules for using Cali.",
    "sections": [
      {
        "id": "agreement",
        "title": "Using Cali",
        "paragraphs": [
          "Cali (Class Ally) is an independent academic workspace developed by Team ChiliMansi for RTU students. These terms cover its planning, study, and community features. By creating an account or using Cali, you agree to these terms. If you do not agree, stop using the service."
        ]
      },
      {
        "id": "accounts",
        "title": "Your account",
        "paragraphs": [
          "Sign in with an eligible, verified Google account under the login policy shown at sign-in. Keep your account secure and your profile accurate. You are responsible for activity under your account. Contact the team if you suspect unauthorized access."
        ]
      },
      {
        "id": "content",
        "title": "Your content and sharing",
        "paragraphs": [
          "You keep ownership of the notes, schedules, and study materials you submit. You give Team ChiliMansi a nonexclusive, royalty-free license to host, format, process, and display your content as needed to provide and improve Cali. This includes processing material you select for an AI feature.",
          "Publishing a reviewer makes it discoverable to other registered users. Its visibility and access settings determine who can read, edit, or copy it for personal educational use. Share only content you have the right to share, and respect the permissions set by its owner."
        ]
      },
      {
        "id": "conduct",
        "title": "Acceptable use",
        "bullets": [
          "Use Cali for educational purposes and treat others respectfully.",
          "Do not bypass security, access controls, or usage limits, disrupt the service, or distribute malicious content.",
          "Do not share unlawful, abusive, harassing, or copyright-infringing material.",
          "Do not use Cali to cheat or obtain unauthorized assistance during an examination."
        ],
        "paragraphs": [
          "The Community guidelines explain the rules for shared reviewers in more detail."
        ]
      },
      {
        "id": "ai",
        "title": "AI and study accuracy",
        "paragraphs": [
          "AI reviewer generation sends the extracted text you review to OpenRouter and a configured model provider. Original notebook images and PDFs are processed in your browser and are not uploaded.",
          "OCR and AI output may contain mistakes or omit context. Check generated material against your course sources before saving, studying, or sharing it. Flashcards and quizzes do not make a separate AI request."
        ]
      },
      {
        "id": "independence",
        "title": "Independent student project",
        "paragraphs": [
          "Cali is not an official RTU learning management system or administrative portal. It does not handle enrollment, tuition, official grades, or faculty administration."
        ]
      },
      {
        "id": "availability",
        "title": "Availability and responsibility",
        "paragraphs": [
          "Cali is under active development and is provided as available. Features may change, be limited, or become temporarily unavailable.",
          "To the extent permitted by applicable Philippine law, Team ChiliMansi and its developers are not responsible for indirect or consequential losses caused by downtime, data loss, or use of the service. This does not limit rights that cannot legally be excluded."
        ]
      }
    ]
  },
  "privacy": {
    "title": "Privacy policy",
    "summary": "What Cali collects, how it is used, and the choices you have.",
    "sections": [
      {
        "id": "principles",
        "title": "Our approach",
        "paragraphs": [
          "Team ChiliMansi processes personal data to operate Cali, following the principles of transparency, legitimate purpose, and proportionality under the Philippine Data Privacy Act of 2012 (Republic Act No. 10173)."
        ]
      },
      {
        "id": "collected",
        "title": "Information you provide",
        "bullets": [
          "Account and profile: your Google name, email address, account identifier, avatar, username, program, year level, and saved preferences.",
          "Workspace content: the schedules, tasks, events, reviewers, flashcards, and quizzes you create or save, along with study progress.",
          "Community activity: reviewers you publish, access requests and permissions, votes, reports, and related notifications.",
          "Reminders: your reminder settings and browser push subscription when you enable notifications.",
          "AI generation: the reviewed source text and preferences you submit, plus request status and usage metadata needed for quotas and reliability."
        ]
      },
      {
        "id": "uses",
        "title": "How information is used",
        "paragraphs": [
          "Account information verifies your eligibility, maintains your session, and identifies your profile. Your workspace content supports planning, reminders, study progress, and sharing that you choose.",
          "Cali does not sell or trade your data for marketing."
        ]
      },
      {
        "id": "sharing",
        "title": "Providers and shared content",
        "bullets": [
          "Google handles sign-in. Supabase provides authentication, database storage, temporary generated drafts, and reminder dispatch.",
          "When you enable notifications, encrypted Web Push messages pass through your browser or device provider.",
          "For AI reviewer generation, reviewed source text is sent over HTTPS to OpenRouter and a configured downstream model provider. Their terms and privacy practices apply to that processing. Avoid submitting confidential or sensitive personal information.",
          "Original notebook images, schedule images, and PDFs are processed on your device and are not uploaded.",
          "Published reviewers are discoverable to registered users. Reading, editing, and copying depend on the reviewer permissions. Reports and shared reviewers may be reviewed by administrators for moderation."
        ]
      },
      {
        "id": "security",
        "title": "Storage and security",
        "paragraphs": [
          "Cali uses HTTPS, authenticated sessions, database access controls, and input validation. No online service can guarantee absolute security.",
          "AI source text is not stored in Supabase. Browser recovery may keep your reviewed text and preferences on your device for up to 24 hours. Signing out, deleting your account, or discarding the work clears that recovery data.",
          "Private generated drafts expire after 24 hours unless you save them as reviewers. Generation metadata may be retained for quotas and reliability. Other data is retained as needed for the service and legitimate project evaluation, then deleted or anonymized as appropriate."
        ]
      },
      {
        "id": "choices",
        "title": "Your controls",
        "bullets": [
          "Update your profile details from Profile.",
          "Manage device notifications and delete your account from Settings.",
          "Choose whether to publish a reviewer, and manage its visibility and access permissions.",
          "Delete workspace content you no longer need. Account deletion also removes generation requests and drafts."
        ]
      },
      {
        "id": "rights",
        "title": "Your privacy rights",
        "paragraphs": [
          "Subject to applicable law, you may request access to or correction of your personal data, object to processing, or request erasure, blocking, or data portability. You may also lodge a complaint with the National Privacy Commission.",
          "Contact Team ChiliMansi using the email below to ask a privacy question or make a request."
        ]
      }
    ]
  },
  "community": {
    "title": "Community guidelines",
    "summary": "Share useful reviewers, respect other students, and protect academic integrity.",
    "sections": [
      {
        "id": "purpose",
        "title": "Share for learning",
        "paragraphs": [
          "Cali Community helps registered users discover and share academic reviewers for personal educational use. Use clear titles, relevant subjects, and accurate descriptions so others know what they are opening."
        ]
      },
      {
        "id": "rights",
        "title": "Respect ownership and access",
        "paragraphs": [
          "Publish only material you own or have permission to share. Do not post copyrighted content without authorization.",
          "Follow each reviewer's visibility and access settings. Request permission when needed, and do not bypass restrictions on reading, editing, or copying. Keep attribution when using another student's work."
        ]
      },
      {
        "id": "integrity",
        "title": "Keep academic work honest",
        "bullets": [
          "Do not share material to enable cheating or unauthorized help during an active examination.",
          "Check AI-generated reviewers against course sources before publishing.",
          "Do not present generated content as verified academic authority or misrepresent someone else's work as your own."
        ]
      },
      {
        "id": "respect",
        "title": "Respect people and privacy",
        "paragraphs": [
          "Keep interactions respectful. Do not publish harassment, threats, hateful abuse, or unlawful content. Do not share another person's private or sensitive information without permission."
        ]
      },
      {
        "id": "safety",
        "title": "Protect the workspace",
        "paragraphs": [
          "Do not upload malicious or intentionally corrupted material, spam the community, or interfere with Cali's security, access controls, or infrastructure."
        ]
      },
      {
        "id": "reports",
        "title": "Reports and moderation",
        "paragraphs": [
          "Use Report on a shared reviewer when it appears to violate these guidelines. Choose a relevant reason and provide enough context for review.",
          "Administrators review reports and may dismiss a report or hide a reviewer. Owners receive related moderation notices. A report count alone does not automatically suspend an account."
        ]
      }
    ]
  }
}

export function PolicyPage({ kind }: { kind: PolicyKind }) {
  const policy = documents[kind]
  const location = useLocation()
  const returnState = (location.state ?? {}) as PolicyReturnState
  const returnTo = typeof returnState.from === 'string' && returnState.from.startsWith('/') && !returnState.from.startsWith('//')
    ? returnState.from
    : '/'
  const backLabel = typeof returnState.backLabel === 'string' ? returnState.backLabel : 'Back to Cali'
  useEffect(() => {
    const previousTitle = document.title
    const target = location.hash ? document.getElementById(location.hash.slice(1)) : null
    if (target) target.scrollIntoView()
    else window.scrollTo(0, 0)
    document.title = `${policy.title} | Cali`
    return () => { document.title = previousTitle }
  }, [policy.title, location.hash])

  const policyLinks: { kind: PolicyKind; path: string }[] = [
    { kind: 'terms', path: '/terms-and-conditions' },
    { kind: 'privacy', path: '/privacy-policy' },
    { kind: 'community', path: '/community-guidelines' },
  ]

  return <div className="entry-page policy-page">
    <a className="entry-skip" href="#policy-main">Skip to content</a>
    <header className="team-header"><div className="entry-container team-header-inner">
      <Link to={returnTo} state={returnState.previousState} aria-label={backLabel}><CaliWordmark /></Link>
      <Link className="team-back" to={returnTo} state={returnState.previousState}>{backLabel}</Link>
    </div></header>
    <main className="entry-container policy-main" id="policy-main" tabIndex={-1}>
      <div className="policy-intro"><span className="policy-eyebrow">CALI POLICIES</span><h1 id="policy-title">{policy.title}</h1><p>{policy.summary}</p></div>
      <nav className="policy-switcher" aria-label="Policy pages">{policyLinks.map(link => <Link key={link.kind} to={link.path} state={returnState} aria-current={kind === link.kind ? 'page' : undefined}>{documents[link.kind].title}</Link>)}</nav>
      <details className="policy-mobile-toc" key={kind}><summary>On this page</summary><nav aria-label="Page sections">{policy.sections.map(section => <a key={section.id} href={`#${section.id}`}>{section.title}</a>)}</nav></details>
      <div className="policy-layout"><nav className="policy-toc" aria-label="On this page"><strong>On this page</strong>{policy.sections.map(section => <a key={section.id} href={`#${section.id}`}>{section.title}</a>)}</nav>
        <article className="policy-content" aria-labelledby="policy-title">{policy.sections.map((section, sectionIndex) => {
          return <section className="policy-section" id={section.id} key={section.id} aria-labelledby={`${section.id}-title`}>
            <div className="policy-section-heading"><span aria-hidden="true">{sectionIndex + 1}</span><h2 id={`${section.id}-title`}>{section.title}</h2></div>
            <div className="policy-section-body">{section.paragraphs?.map((paragraph, index) => <p key={index}>{paragraph}</p>)}{section.bullets && <ul>{section.bullets.map(bullet => <li key={bullet}>{bullet}</li>)}</ul>}</div>
            {kind === 'privacy' && section.id === 'rights' && <p className="policy-source"><a href="https://privacy.gov.ph/data-subject-rights/" target="_blank" rel="noreferrer">Read about your rights at the National Privacy Commission</a></p>}
          </section>
        })}
          <aside className="policy-contact" aria-label="Contact the team"><h2>{kind === 'privacy' ? 'Privacy questions or requests?' : 'Questions about these rules?'}</h2><p>Contact Team ChiliMansi at <a href="mailto:2024-200362@rtu.edu.ph">2024-200362@rtu.edu.ph</a>.</p></aside>
        </article>
      </div>
    </main>
    <footer className="policy-footer entry-container"><p>Cali is an independent student workspace.</p><BackToTop /></footer>
  </div>
}
