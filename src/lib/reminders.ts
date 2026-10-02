export const reminderPresets = [
  { value: '', label: 'No reminder' },
  { value: '30', label: '30 minutes before' },
  { value: '60', label: '1 hour before' },
  { value: '180', label: '3 hours before' },
  { value: '300', label: '5 hours before' },
]

export function reminderLabel(minutes: number | null | undefined) {
  if (!minutes) return 'No reminder'
  const preset = reminderPresets.find(item => Number(item.value) === minutes)
  if (preset) return preset.label
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return `${hours ? `${hours} hr${hours === 1 ? '' : 's'}` : ''}${hours && remainder ? ' ' : ''}${remainder ? `${remainder} min` : ''} before`
}

