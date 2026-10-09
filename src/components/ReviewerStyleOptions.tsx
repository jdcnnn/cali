import type { ReviewerPreferences } from '../lib/reviewerPreferences'

type Props = {
  preferences: ReviewerPreferences
  detail: 'concise' | 'standard' | 'detailed'
  onPreferencesChange: (value: ReviewerPreferences) => void
  onDetailChange: (value: Props['detail']) => void
}
export function ReviewerStyleOptions({ preferences, detail, onPreferencesChange, onDetailChange }: Props) {
  return <div className="ai-style-options">
    <fieldset className="ai-length-field"><legend>Reviewer length</legend><div className="ai-detail-options">{([
      { value: 'concise', label: 'Quick', note: 'Key points' },
      { value: 'standard', label: 'Balanced', note: 'Brief explanations' },
      { value: 'detailed', label: 'In depth', note: 'More detail' },
    ] as const).map(option => <label key={option.value}><input type="radio" name="detail" checked={detail === option.value} onChange={() => onDetailChange(option.value)} /><span><strong>{option.label}</strong><small>{option.note}</small></span></label>)}</div></fieldset>
    <label className="study-field ai-style-instructions"><span><strong>Style instructions</strong><small>Optional</small></span><textarea rows={3} maxLength={2000} value={preferences.additionalContent} placeholder="Use short bullet points, compare key concepts, and add practice questions with answers." onChange={event => onPreferencesChange({ ...preferences, additionalContent: event.target.value })} /><small>Tell Cali how to present the material or what study aids to include.</small></label>
    <details className="ai-academic-note"><summary>Academic content only</summary><p>Sources and instructions flagged for abuse, gratuitous profanity, explicit sexual content, or other policy violations are blocked. Relevant academic discussion of sensitive topics is allowed. Blocked attempts do not use your monthly quota.</p></details>
  </div>
}
