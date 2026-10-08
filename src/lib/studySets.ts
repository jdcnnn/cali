import type { JSONContent } from '@tiptap/react'

export type FlashcardRating = 'again' | 'hard' | 'good'

export type Flashcard = {
  id: string
  front: JSONContent
  back: JSONContent
  frontText: string
  backText: string
}

export type CardProgress = {
  goodStreak: number
  mastered: boolean
  lastRating: FlashcardRating
  updatedAt: string
}

export type FlashcardSession = {
  id: string
  cardIds: string[]
  index: number
  ratings: Record<string, FlashcardRating>
  mode: 'sequential' | 'shuffle'
  learningOnly: boolean
  startedAt: string
}

export type FlashcardSet = {
  id: string
  user_id: string
  subject_id: string | null
  source_reviewer_id: string | null
  source_reviewer_title: string | null
  title: string
  cards: Flashcard[]
  progress: Record<string, CardProgress>
  active_session: FlashcardSession | null
  revision: number
  card_count: number
  created_at: string
  updated_at: string
}

export type QuizChoice = { id: string; text: string }
export type QuizQuestion = {
  id: string
  type: 'multiple_choice' | 'true_false'
  prompt: JSONContent
  promptText: string
  choices: QuizChoice[]
  correctChoiceId: string
  explanation: JSONContent
  explanationText: string
}

export type Quiz = {
  id: string
  user_id: string
  subject_id: string | null
  source_reviewer_id: string | null
  source_reviewer_title: string | null
  title: string
  questions: QuizQuestion[]
  active_attempt_id: string | null
  revision: number
  question_count: number
  created_at: string
  updated_at: string
}

export type QuizSnapshot = { questions: QuizQuestion[]; shuffleQuestions: boolean; shuffleChoices: boolean }
export type QuizAttempt = {
  id: string
  quiz_id: string
  user_id: string
  status: 'active' | 'completed' | 'abandoned'
  snapshot: QuizSnapshot
  answers: Record<string, string>
  current_index: number
  score: number | null
  total: number | null
  started_at: string
  updated_at: string
  completed_at: string | null
}

export const SKIPPED_QUIZ_ANSWER = '__cali_skipped__'

export const EMPTY_RICH_TEXT: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

export function richTextFromText(text: string): JSONContent {
  return { type: 'doc', content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : undefined }] }
}

export function validFlashcard(card: Flashcard): boolean {
  return Boolean(card.frontText.trim() && card.backText.trim())
}

export function validQuizQuestion(question: QuizQuestion): boolean {
  if (!question.promptText.trim()) return false
  if (question.type === 'true_false') return question.choices.length === 2 && question.choices.some(choice => choice.id === question.correctChoiceId)
  const usable = question.choices.filter(choice => choice.text.trim())
  return usable.length >= 2 && usable.length <= 6 && usable.some(choice => choice.id === question.correctChoiceId)
}

export function shuffled<T>(values: T[], random = Math.random): T[] {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    ;[result[index], result[target]] = [result[target], result[index]]
  }
  return result
}

export function buildQuizSnapshot(questions: QuizQuestion[], shuffleQuestions: boolean, shuffleChoices: boolean): QuizSnapshot {
  const valid = questions.filter(validQuizQuestion).map(question => ({ ...question, choices: shuffleChoices ? shuffled(question.choices) : [...question.choices] }))
  return { questions: shuffleQuestions ? shuffled(valid) : valid, shuffleQuestions, shuffleChoices }
}

function comparableQuizQuestion(question: QuizQuestion) {
  return {
    ...question,
    choices: [...question.choices].sort((left, right) => left.id.localeCompare(right.id)),
  }
}

export function quizSnapshotMatchesQuestions(snapshot: QuizSnapshot, questions: QuizQuestion[]): boolean {
  const current = questions.filter(validQuizQuestion).map(comparableQuizQuestion).sort((left, right) => left.id.localeCompare(right.id))
  const saved = snapshot.questions.map(comparableQuizQuestion).sort((left, right) => left.id.localeCompare(right.id))
  return JSON.stringify(current) === JSON.stringify(saved)
}

export function scoreQuiz(snapshot: QuizSnapshot, answers: Record<string, string>): number {
  return snapshot.questions.reduce((score, question) => score + Number(answers[question.id] === question.correctChoiceId), 0)
}

export function nextQuizQuestionIndex(questions: QuizQuestion[], answers: Record<string, string>, currentIndex: number): number | null {
  for (let index = currentIndex + 1; index < questions.length; index += 1) {
    if (!answers[questions[index].id]) return index
  }
  const untouched = questions.findIndex(question => !answers[question.id])
  if (untouched >= 0) return untouched
  const skipped = questions.findIndex(question => answers[question.id] === SKIPPED_QUIZ_ANSWER)
  return skipped >= 0 ? skipped : null
}

export function applySessionRatings(progress: Record<string, CardProgress>, ratings: Record<string, FlashcardRating>, completedAt: string): Record<string, CardProgress> {
  const next = { ...progress }
  for (const [cardId, rating] of Object.entries(ratings)) {
    const prior = next[cardId]
    const goodStreak = rating === 'good' ? (prior?.goodStreak ?? 0) + 1 : 0
    next[cardId] = { goodStreak, mastered: goodStreak >= 2, lastRating: rating, updatedAt: completedAt }
  }
  return next
}
