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

export type FlashcardStudyOptions = Pick<FlashcardSession, 'mode' | 'learningOnly'>

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
  topic?: string
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

export type QuizMode = 'practice' | 'test'
export type QuizPhase = 'first_pass' | 'review'
export type QuizSnapshot = { questions: QuizQuestion[]; shuffleQuestions: boolean; shuffleChoices: boolean }
export type QuizAttempt = {
  id: string
  quiz_id: string
  user_id: string
  status: 'active' | 'completed' | 'abandoned'
  mode: QuizMode
  phase: QuizPhase
  snapshot: QuizSnapshot
  answers: Record<string, string>
  first_answers: Record<string, string>
  current_index: number
  score: number | null
  first_try_score: number | null
  total: number | null
  started_at: string
  updated_at: string
  completed_at: string | null
}

export type QuizTopicInsight = {
  topic: string
  mastery: number | null
  exposures: number
  correct: number
  accuracy: number
  quizId?: string
}

export const SKIPPED_QUIZ_ANSWER = '__cali_skipped__'

export const EMPTY_RICH_TEXT: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

export function richTextFromText(text: string): JSONContent {
  return { type: 'doc', content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : undefined }] }
}

export function validFlashcard(card: Flashcard): boolean {
  return Boolean(card.frontText.trim() && card.backText.trim())
}

export function flashcardsForSession(cards: Flashcard[], progress: Record<string, CardProgress>, learningOnly: boolean): Flashcard[] {
  return cards.filter(card => validFlashcard(card) && (!learningOnly || !progress[card.id]?.mastered))
}

export function buildFlashcardSession(
  cards: Flashcard[],
  progress: Record<string, CardProgress>,
  options: FlashcardStudyOptions,
  id: string,
  startedAt: string,
  random = Math.random,
): FlashcardSession | null {
  const eligible = flashcardsForSession(cards, progress, options.learningOnly)
  if (!eligible.length) return null
  const cardIds = eligible.map(card => card.id)
  return {
    id,
    cardIds: options.mode === 'shuffle' ? shuffled(cardIds, random) : cardIds,
    index: 0,
    ratings: {},
    mode: options.mode,
    learningOnly: options.learningOnly,
    startedAt,
  }
}

export function flashcardContentChanged(previous: Flashcard[], next: Flashcard[]): boolean {
  if (previous.length !== next.length) return true
  const priorById = new Map(previous.map(card => [card.id, card]))
  return next.some(card => {
    const prior = priorById.get(card.id)
    return !prior || prior.frontText !== card.frontText || prior.backText !== card.backText
  })
}

export function reconcileFlashcardProgress(previous: Flashcard[], next: Flashcard[], progress: Record<string, CardProgress>): Record<string, CardProgress> {
  const priorById = new Map(previous.map(card => [card.id, card]))
  return Object.fromEntries(Object.entries(progress).filter(([cardId]) => {
    const prior = priorById.get(cardId)
    const current = next.find(card => card.id === cardId)
    return Boolean(prior && current && prior.frontText === current.frontText && prior.backText === current.backText)
  }))
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

export function quizSnapshotMatchesQuestionSubset(snapshot: QuizSnapshot, questions: QuizQuestion[]): boolean {
  const snapshotIds = new Set(snapshot.questions.map(question => question.id))
  return quizSnapshotMatchesQuestions(snapshot, questions.filter(question => snapshotIds.has(question.id)))
}

export function scoreQuiz(snapshot: QuizSnapshot, answers: Record<string, string>): number {
  return snapshot.questions.reduce((score, question) => score + Number(answers[question.id] === question.correctChoiceId), 0)
}

export function quizTopic(question: QuizQuestion, quizTitle: string): string {
  return question.topic?.trim() || quizTitle.trim() || 'General review'
}

export function quizAttemptMetrics(attempt: QuizAttempt) {
  const questions = attempt.snapshot.questions
  const firstAnswers = attempt.first_answers ?? attempt.answers
  const firstTryCorrect = scoreQuiz(attempt.snapshot, firstAnswers)
  const finalCorrect = scoreQuiz(attempt.snapshot, attempt.answers)
  const skipped = questions.filter(question => !firstAnswers[question.id] || firstAnswers[question.id] === SKIPPED_QUIZ_ANSWER).length
  return {
    total: questions.length,
    firstTryCorrect,
    finalCorrect,
    recovered: Math.max(0, finalCorrect - firstTryCorrect),
    skipped,
  }
}

export function quizTopicInsights(attempts: QuizAttempt[], quizTitles: Record<string, string> = {}): QuizTopicInsight[] {
  const outcomes = new Map<string, Array<{ value: number; correct: boolean; quizId: string }>>()
  const completed = attempts
    .filter(attempt => attempt.status === 'completed')
    .sort((left, right) => new Date(right.completed_at ?? right.updated_at).getTime() - new Date(left.completed_at ?? left.updated_at).getTime())
  for (const attempt of completed) {
    const firstAnswers = attempt.first_answers ?? attempt.answers
    for (const question of attempt.snapshot.questions) {
      const topic = quizTopic(question, quizTitles[attempt.quiz_id] ?? 'General review')
      const firstCorrect = firstAnswers[question.id] === question.correctChoiceId
      const finalCorrect = attempt.answers[question.id] === question.correctChoiceId
      const entries = outcomes.get(topic) ?? []
      if (entries.length < 5) entries.push({ value: firstCorrect ? 100 : finalCorrect ? 60 : 0, correct: finalCorrect, quizId: attempt.quiz_id })
      outcomes.set(topic, entries)
    }
  }
  return [...outcomes.entries()].map(([topic, entries]) => {
    const correct = entries.filter(entry => entry.correct).length
    return {
      topic,
      exposures: entries.length,
      correct,
      accuracy: Math.round((correct / entries.length) * 100),
      mastery: entries.length < 2 ? null : Math.round(entries.reduce((sum, entry) => sum + entry.value, 0) / entries.length),
      quizId: entries[0]?.quizId,
    }
  }).sort((left, right) => left.accuracy - right.accuracy || right.exposures - left.exposures)
}

export function quizReviewQuestionIds(attempt: QuizAttempt): string[] {
  const firstAnswers = attempt.first_answers ?? attempt.answers
  return attempt.snapshot.questions
    .filter(question => firstAnswers[question.id] !== question.correctChoiceId)
    .map(question => question.id)
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
