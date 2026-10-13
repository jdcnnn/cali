import type { ReviewerPreferences } from '../lib/reviewerPreferences'

type Props = {
  preferences: ReviewerPreferences
  detail: 'concise' | 'standard' | 'detailed'
  onPreferencesChange: (value: ReviewerPreferences) => void
  onDetailChange: (value: Props['detail']) => void
}
export function ReviewerStyleOptions({ preferences, detail, onPreferencesChange, onDetailChange }: Props) {
  const toggle = (key: 'comparisons' | 'commonMistakes' | 'memoryAids' | 'selfCheck') => onPreferencesChange({ ...preferences, [key]: !preferences[key] })
  return <div className="ai-style-options">
    <fieldset className="ai-length-field"><legend>Level of detail</legend><div className="ai-detail-options">{([
      { value: 'concise', label: 'Quick', note: 'Essential key points' },
      { value: 'standard', label: 'Balanced', note: 'Key points with explanations' },
      { value: 'detailed', label: 'In depth', note: 'Thorough explanations and coverage' },
    ] as const).map(option => <label key={option.value}><input type="radio" name="detail" checked={detail === option.value} onChange={() => onDetailChange(option.value)} /><span><strong>{option.label}</strong><small>{option.note}</small></span></label>)}</div></fieldset>
    <fieldset className="ai-length-field"><legend>Worked examples</legend><div className="ai-detail-options ai-example-options">{([
      { value: 'none', label: 'None', note: 'Do not add examples' },
      { value: 'some', label: 'Some', note: 'Include at least 2' },
      { value: 'many', label: 'Many', note: 'Include at least 4' },
    ] as const).map(option => <label key={option.value}><input type="radio" name="examples" checked={preferences.examples === option.value} onChange={() => onPreferencesChange({ ...preferences, examples: option.value })} /><span><strong>{option.label}</strong><small>{option.note}</small></span></label>)}</div></fieldset>
    <fieldset className="ai-study-aids"><legend>Helpful study sections <small>Optional</small></legend><div className="ai-study-aid-grid">{([
      ['comparisons', 'Compare concepts', 'Explain important similarities and differences'],
      ['commonMistakes', 'Correct common mistakes', 'Show a misconception and its correction'],
      ['memoryAids', 'Add memory aids', 'Include short cues that support recall'],
      ['selfCheck', 'Add self-check questions', 'Include practice questions with answers'],
    ] as const).map(([key, label, note]) => <label key={key}><input type="checkbox" checked={preferences[key]} onChange={() => toggle(key)} /><span><strong>{label}</strong><small>{note}</small></span></label>)}</div></fieldset>
    <fieldset className="ai-length-field"><legend>Writing style</legend><div className="ai-detail-options ai-presentation-options">{([
      { value: 'mixed', label: 'Mixed', note: 'Bullets and explanations' },
      { value: 'bullets', label: 'Bullet points', note: 'Short points that are easy to scan' },
      { value: 'explanatory', label: 'Explanation-first', note: 'Connected sentences with more context' },
    ] as const).map(option => <label key={option.value}><input type="radio" name="presentation" checked={preferences.presentation === option.value} onChange={() => onPreferencesChange({ ...preferences, presentation: option.value })} /><span><strong>{option.label}</strong><small>{option.note}</small></span></label>)}</div></fieldset>
    {preferences.examples !== 'none' && <label className="ai-supplementary-toggle"><input type="checkbox" checked={preferences.allowSupplementaryExamples} onChange={event => onPreferencesChange({ ...preferences, allowSupplementaryExamples: event.target.checked })} /><span><strong>Allow supplementary examples</strong><small>Use clearly labeled general examples when your notes do not include enough.</small></span></label>}
    <details className="ai-academic-note"><summary><span><strong>Academic use only</strong><small>Review content and account rules</small></span></summary><ul><li>Relevant academic discussion is allowed. Unsafe requests are blocked without using your quota.</li><li>Inappropriate shared reviewers may be reported. Confirmed or repeated violations may lead to hiding or account suspension.</li></ul></details>
  </div>
}
