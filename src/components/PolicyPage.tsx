import { useEffect } from 'react'
import { Link } from 'react-router'
import { CaliWordmark } from './CaliWordmark'
import { SiteFooter } from './SiteFooter'
import './entry.css'

type PolicyKind = 'terms' | 'privacy' | 'community'
type PolicySection = { id: string; title: string; paragraphs?: string[]; bullets?: string[] }

const documents: Record<PolicyKind, { title: string; summary: string; sections: PolicySection[] }> = {
  terms: {
    title: 'Terms & Conditions',
    summary: 'The rules for using Cali as an independent academic workspace for RTU students.',
    sections: [
      { id: 'agreement', title: '1. Agreement and scope', paragraphs: ['These terms govern your access to and use of Cali (Class Ally), a web based academic workspace developed by Team ChiliMansi. By creating an account or using Cali, you agree to these terms. If you do not agree, please stop using the service.', 'Cali is intended to help students organize classes, coursework, and study materials. Schedule tools, task tracking, study generation, analytics, and community sharing are covered by these terms.'] },
      { id: 'accounts', title: '2. Accounts and eligibility', paragraphs: ['Cali access is intended for RTU students and authorized academic evaluators. The current sign in flow requires a verified @rtu.edu.ph Google account. Keep your account secure, provide accurate profile information, and promptly report suspected unauthorized access to the development team. You are responsible for activity under your account.'] },
      { id: 'content', title: '3. Your content and sharing', paragraphs: ['You keep ownership of the notes, schedules, and other study materials you submit. You give Team ChiliMansi a nonexclusive, royalty free license to host, format, process, and display that content as needed to provide and improve Cali. Where an AI feature is offered, this may include processing the content you select for that feature.', 'If you choose to publish materials in Cali Community, you allow other registered users to view, study, and copy them for personal educational use. Share only material you have the right to share.'] },
      { id: 'conduct', title: '4. Acceptable use', bullets: ['Use Cali for legitimate educational purposes and treat other users respectfully.', 'Do not probe or disrupt the service, bypass security or rate limits, or distribute malicious files or code.', 'Do not post unlawful, abusive, harassing, or infringing content.', 'Do not use Cali or its AI features to cheat, obtain unauthorized exam assistance, or present generated output as verified academic authority.'], paragraphs: ['Additional posting rules appear in the Community Guidelines.'] },
      { id: 'ai', title: '5. AI assisted tools', paragraphs: ['If AI study tools become available, they may use third party model providers, including OpenRouter or Groq, to generate study sets, summaries, flashcards, or quizzes from content you select. AI output can contain mistakes, missing context, or incorrect answers. Review and verify it against your course materials before relying on it.'] },
      { id: 'independence', title: '6. Institutional independence', paragraphs: ['Cali is an independent student project. It is not an official RTU Learning Management System or administrative portal, and it does not handle enrollment, tuition, official grades, or faculty administration.'] },
      { id: 'availability', title: '7. Availability and liability', paragraphs: ['Cali is under active development and is provided as available. Features may change, be limited, or become temporarily unavailable. To the extent permitted by applicable Philippine law, Team ChiliMansi and its developers are not responsible for indirect or consequential losses arising from service downtime, data loss, or use of the service. Nothing here limits rights that cannot legally be excluded.'] },
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    summary: 'How Cali handles account information and academic data, based on the Data Privacy Act of 2012.',
    sections: [
      { id: 'principles', title: '1. Our approach', paragraphs: ['Team ChiliMansi processes personal data for clear academic workspace purposes, following the principles of transparency, legitimate purpose, and proportionality under Republic Act No. 10173, the Data Privacy Act of 2012. We collect information needed to operate the features you use.'] },
      { id: 'collected', title: '2. Information we collect', bullets: ['Account and profile: your Google name, RTU email address, account identifier, avatar, username, program, year level, and preferences.', 'Academic content, when relevant features are available and you use them: schedules, tasks, lecture notes, and study materials.', 'AI inputs, when you use an AI feature: the text or prompt you choose to submit and your edits to generated study materials.', 'Activity data, when analytics features are available: study activity, task completion, and feature usage needed for dashboards or project evaluation.'], paragraphs: ['The current account flow uses Google sign in and stores a student profile. Other categories apply only when their related features are provided and used.'] },
      { id: 'uses', title: '3. How we use information', paragraphs: ['We use account data to verify eligibility, maintain sessions, and personalize your workspace. Academic content is used to support planning, reminders, study workflows, and sharing that you choose. Activity data may support personal insights and project evaluation. We do not sell or trade user data for marketing.'] },
      { id: 'sharing', title: '4. Service providers and sharing', paragraphs: ['Cali uses Google for sign in and Supabase for authentication and database services. If AI generation becomes available, only the content you select for generation will be sent over HTTPS to the relevant model provider, such as OpenRouter or Groq. Content you publish to Cali Community will be visible to other registered users according to that feature’s sharing controls.'] },
      { id: 'security', title: '5. Security and retention', paragraphs: ['Cali uses HTTPS, session handling, database access controls, and validation to protect account data. No online service can guarantee absolute security. We keep data only as long as needed for the service and legitimate project evaluation purposes, then delete or anonymize it as appropriate. A deletion request may be subject to applicable legal or operational requirements.'] },
      { id: 'rights', title: '6. Your rights', paragraphs: ['Under the Data Privacy Act of 2012, you may have rights to be informed, access your personal data, correct inaccurate data, object to certain processing, and request erasure or blocking when the law allows. You may also have rights to data portability and to lodge a complaint with the National Privacy Commission.'] },
    ],
  },
  community: {
    title: 'Community Guidelines',
    summary: 'A practical guide for sharing study materials and helping fellow RTU students.',
    sections: [
      { id: 'purpose', title: '1. Share for learning', paragraphs: ['Cali Community is intended for sharing academic reviewers and study collections with other registered users. Shared materials are for personal educational use.'] },
      { id: 'rights', title: '2. Respect ownership', paragraphs: ['Share only materials you have the right to share. Do not publish content that infringes someone else’s copyright. You keep ownership of your own materials, while allowing other registered users to view, study, and copy what you choose to publish for personal educational use.'] },
      { id: 'integrity', title: '3. Protect academic integrity', paragraphs: ['Do not use Cali or its AI features to cheat, obtain unauthorized assistance during an active examination, or present generated output as verified academic authority. Check AI generated study materials before relying on or sharing them.'] },
      { id: 'respect', title: '4. Keep the space safe', paragraphs: ['Do not upload malware, corrupted files, or unlawful, offensive, or harassing content. Do not use community features to interfere with Cali’s security or infrastructure.'] },
    ],
  },
}

export function PolicyPage({ kind }: { kind: PolicyKind }) {
  const policy = documents[kind]
  useEffect(() => {
    const previousTitle = document.title
    window.scrollTo(0, 0)
    document.title = `${policy.title} | Cali`
    return () => { document.title = previousTitle }
  }, [policy.title])

  const policyLinks: { kind: PolicyKind; path: string }[] = [
    { kind: 'terms', path: '/terms-and-conditions' },
    { kind: 'privacy', path: '/privacy-policy' },
    { kind: 'community', path: '/community-guidelines' },
  ]

  return <div className="entry-page policy-page">
    <a className="entry-skip" href="#policy-main">Skip to content</a>
    <header className="team-header"><div className="entry-container team-header-inner">
      <Link to="/" aria-label="Cali home"><CaliWordmark /></Link>
      <Link className="team-back" to="/">Back to Cali</Link>
    </div></header>
    <main className="entry-container policy-main" id="policy-main">
      <div className="policy-intro"><h1>{policy.title}</h1><p>{policy.summary}</p></div>
      <nav className="policy-switcher" aria-label="Policy pages">{policyLinks.map(link => <Link key={link.kind} to={link.path} aria-current={kind === link.kind ? 'page' : undefined}>{documents[link.kind].title}</Link>)}</nav>
      <div className="policy-layout"><nav className="policy-toc" aria-label="On this page"><strong>On this page</strong>{policy.sections.map(section => <a key={section.id} href={`#${section.id}`}>{section.title}</a>)}</nav>
        <article className="policy-content">{policy.sections.map(section => {
          const [number, ...heading] = section.title.split(' ')
          return <section className="policy-section" id={section.id} key={section.id}>
            <div className="policy-section-heading"><span aria-hidden="true">{number.replace('.', '').padStart(2, '0')}</span><h2>{heading.join(' ')}</h2></div>
            <div className="policy-section-body">{section.paragraphs?.map((paragraph, index) => <p key={index}>{paragraph}</p>)}{section.bullets && <ul>{section.bullets.map(bullet => <li key={bullet}>{bullet}</li>)}</ul>}</div>
          </section>
        })}
          {kind === 'privacy' && <p className="policy-contact">For privacy questions or requests, email Team ChiliMansi at <a href="mailto:2024-200362@rtu.edu.ph">2024-200362@rtu.edu.ph</a>.</p>}
        </article>
      </div>
    </main>
    <SiteFooter />
  </div>
}
