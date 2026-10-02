export const calendarColors = [
  { key: 'ocean', name: 'Ocean' },
  { key: 'sky', name: 'Sky' },
  { key: 'teal', name: 'Teal' },
  { key: 'mint', name: 'Mint' },
  { key: 'fern', name: 'Fern' },
  { key: 'sunflower', name: 'Sunflower' },
  { key: 'tangerine', name: 'Tangerine' },
  { key: 'coral', name: 'Coral' },
  { key: 'rose', name: 'Rose' },
  { key: 'violet', name: 'Violet' },
] as const

export type CalendarColorKey = typeof calendarColors[number]['key']

export const defaultCalendarColor: CalendarColorKey = 'ocean'

export function calendarColorValue(key: string | null | undefined) {
  const safeKey = calendarColors.find(color => color.key === key)?.key ?? defaultCalendarColor
  return `var(--calendar-color-${safeKey})`
}

export function isCalendarColorKey(value: string | null | undefined): value is CalendarColorKey {
  return calendarColors.some(color => color.key === value)
}
