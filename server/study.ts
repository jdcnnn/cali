export type ReviewerDetail = 'concise' | 'standard' | 'detailed'

export type GeneratedReviewer = {
  title: string
  sections: Array<{
    heading: string
    paragraphs: string[]
    bulletPoints: string[]
    numberedSteps: string[]
    keyTerms: Array<{ term: string; definition: string }>
  }>
}

type TipTapNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: TipTapNode[]
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
}

const textNode = (text: string, bold = false): TipTapNode => ({
  type: 'text',
  text,
  ...(bold ? { marks: [{ type: 'bold' }] } : {}),
})

const paragraph = (text: string): TipTapNode => ({ type: 'paragraph', content: text ? [textNode(text)] : undefined })

function list(items: string[], ordered: boolean): TipTapNode | null {
  if (!items.length) return null
  return {
    type: ordered ? 'orderedList' : 'bulletList',
    content: items.map(item => ({ type: 'listItem', content: [paragraph(item)] })),
  }
}

export function generatedReviewerToTipTap(value: GeneratedReviewer): { content: TipTapNode; plainText: string } {
  const content: TipTapNode[] = []
  const plain: string[] = []

  for (const section of value.sections) {
    const heading = section.heading.trim()
    if (heading) {
      content.push({ type: 'heading', attrs: { level: 2 }, content: [textNode(heading)] })
      plain.push(heading)
    }
    for (const item of section.paragraphs) {
      content.push(paragraph(item))
      plain.push(item)
    }
    const terms = section.keyTerms.map(item => `${item.term} — ${item.definition}`)
    const bullets = list([...terms, ...section.bulletPoints], false)
    if (bullets) content.push(bullets)
    plain.push(...terms, ...section.bulletPoints)
    const steps = list(section.numberedSteps, true)
    if (steps) content.push(steps)
    plain.push(...section.numberedSteps)
  }

  return { content: { type: 'doc', content: content.length ? content : [paragraph('')] }, plainText: plain.join('\n') }
}

function stringArray(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, maximum).filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean)
}

export function validateGeneratedReviewer(value: unknown): GeneratedReviewer {
  if (!value || typeof value !== 'object') throw new Error('The provider returned an invalid reviewer.')
  const candidate = value as Record<string, unknown>
  const title = typeof candidate.title === 'string' ? candidate.title.trim().slice(0, 160) : ''
  if (!title || !Array.isArray(candidate.sections) || candidate.sections.length === 0 || candidate.sections.length > 80) {
    throw new Error('The provider returned an incomplete reviewer.')
  }
  const sections = candidate.sections.map(raw => {
    if (!raw || typeof raw !== 'object') throw new Error('The provider returned an invalid section.')
    const section = raw as Record<string, unknown>
    const rawTerms = Array.isArray(section.keyTerms) ? section.keyTerms.slice(0, 80) : []
    return {
      heading: typeof section.heading === 'string' ? section.heading.trim().slice(0, 200) : '',
      paragraphs: stringArray(section.paragraphs, 80),
      bulletPoints: stringArray(section.bulletPoints, 120),
      numberedSteps: stringArray(section.numberedSteps, 80),
      keyTerms: rawTerms.flatMap(item => {
        if (!item || typeof item !== 'object') return []
        const term = typeof (item as Record<string, unknown>).term === 'string' ? String((item as Record<string, unknown>).term).trim() : ''
        const definition = typeof (item as Record<string, unknown>).definition === 'string' ? String((item as Record<string, unknown>).definition).trim() : ''
        return term && definition ? [{ term: term.slice(0, 160), definition: definition.slice(0, 1000) }] : []
      }),
    }
  }).filter(section => section.heading || section.paragraphs.length || section.bulletPoints.length || section.numberedSteps.length || section.keyTerms.length)
  if (!sections.length) throw new Error('The provider returned an empty reviewer.')
  return { title, sections }
}

export const reviewerJsonSchema = {
  name: 'cali_study_reviewer',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'sections'],
    properties: {
      title: { type: 'string' },
      sections: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object', additionalProperties: false,
          required: ['heading', 'paragraphs', 'bulletPoints', 'numberedSteps', 'keyTerms'],
          properties: {
            heading: { type: 'string' },
            paragraphs: { type: 'array', items: { type: 'string' } },
            bulletPoints: { type: 'array', items: { type: 'string' } },
            numberedSteps: { type: 'array', items: { type: 'string' } },
            keyTerms: {
              type: 'array',
              items: {
                type: 'object', additionalProperties: false, required: ['term', 'definition'],
                properties: { term: { type: 'string' }, definition: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  },
} as const

export function reviewerSystemPrompt(detail: ReviewerDetail): string {
  const detailInstruction = detail === 'concise'
    ? 'Keep each section very compact and include only essential terms and facts.'
    : detail === 'detailed'
      ? 'Cover the source thoroughly while keeping every point study-friendly.'
      : 'Balance completeness and brevity.'
  return `You create accurate, source-grounded study reviewers. Use only the supplied material; never invent facts. Preserve the source's dominant language, exact names, numbers, formulas, and technical terms. Keep the original topic order and include every distinct section. Use paragraphs for explanations, bulletPoints for related facts, numberedSteps only for genuine sequences, and keyTerms for term-definition pairs. Do not add an overview, transitions, commentary, or key-takeaway ending. ${detailInstruction} Return only JSON matching the requested schema.`
}
