export function compactDuration(totalMinutes: number) {
  const total = Math.max(0, Math.floor(totalMinutes))
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  return [
    hours ? `${hours} ${hours === 1 ? 'hr' : 'hrs'}` : '',
    minutes || !hours ? `${minutes} ${minutes === 1 ? 'min' : 'mins'}` : '',
  ].filter(Boolean).join(' ')
}
