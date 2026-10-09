import { describe, expect, it } from 'vitest'
import { ACADEMIC_POLICY, buildAcademicPolicyBody, parsePolicyDecision, policyMessage } from './reviewerPolicy'
describe('academic content decisions', () => {
  it('fails closed for malformed or contradictory decisions', () => {
    for (const decision of [null, {}, '{bad json}', { allowed: true, category: 'sexual' }, { allowed: false, category: 'allowed' }, { allowed: true, category: 'unknown' }]) expect(parsePolicyDecision(decision)).toBeNull()
  })
  it('accepts only consistent structured decisions', () => {
    expect(parsePolicyDecision('{"allowed":true,"category":"allowed"}')).toEqual({ allowed: true, category: 'allowed' })
    expect(parsePolicyDecision('```json\n{"allowed":true,"category":"allowed"}\n```')).toEqual({ allowed: true, category: 'allowed' })
    expect(parsePolicyDecision({ allowed: false, category: 'harassment' })).toEqual({ allowed: false, category: 'harassment' })
    expect(policyMessage('harassment')).toContain('does not count')
  })
  it('checks the complete source and preferences as untrusted data with contextual rules', () => {
    const material = { source: 'Sexual reproduction in flowering plants', preferences: { additionalContent: 'Compare pollination mechanisms' } }
    const body = buildAcademicPolicyBody(material, 'input')
    expect(JSON.parse(body.messages[1].content).material).toEqual(material)
    expect(body.messages[0].role).toBe('system')
    expect(ACADEMIC_POLICY).toContain('sensitive keyword alone is not a violation')
  })
})
