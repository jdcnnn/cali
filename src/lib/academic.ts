const ordinalYearLabels = ['1st Year', '2nd Year', '3rd Year', '4th Year', '5th Year'] as const

export function formatYearLevel(yearLevel: number) {
  return ordinalYearLabels[yearLevel - 1] ?? `${yearLevel}th Year`
}

export const yearLevelOptions = ordinalYearLabels.map((label, index) => ({
  value: String(index + 1),
  label,
}))
