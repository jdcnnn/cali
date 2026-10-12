import { describe, expect, it, vi } from 'vitest'
import { applySessionRatings, buildFlashcardSession, buildQuizSnapshot, flashcardContentChanged, flashcardsForSession, nextQuizQuestionIndex, quizAttemptMetrics, quizReviewQuestionIds, quizSnapshotMatchesQuestions, quizSnapshotMatchesQuestionSubset, quizTopicInsights, reconcileFlashcardProgress, richTextFromText, scoreQuiz, SKIPPED_QUIZ_ANSWER, validFlashcard, validQuizQuestion, type CardProgress, type Flashcard, type QuizAttempt, type QuizQuestion } from './studySets'

const question = (id: string): QuizQuestion => ({
  id,
  type: 'multiple_choice',
  prompt: richTextFromText('Question'),
  promptText: 'Question',
  choices: [{ id: `${id}-a`, text: 'A' }, { id: `${id}-b`, text: 'B' }],
  correctChoiceId: `${id}-b`,
  explanation: richTextFromText('Because'),
  explanationText: 'Because',
})

const card = (id: string, front = `Front ${id}`, back = `Back ${id}`): Flashcard => ({
  id,
  front: richTextFromText(front),
  back: richTextFromText(back),
  frontText: front,
  backText: back,
})

const learned = (mastered: boolean): CardProgress => ({ goodStreak: mastered ? 2 : 1, mastered, lastRating: 'good', updatedAt: '2026-01-01' })

const attempt = (values: Partial<QuizAttempt> = {}): QuizAttempt => ({
  id: 'attempt', quiz_id: 'quiz', user_id: 'student', status: 'completed', mode: 'practice', phase: 'review',
  snapshot: buildQuizSnapshot([{ ...question('q1'), topic: 'Foundations' }, { ...question('q2'), topic: 'Foundations' }], false, false),
  answers: { q1: 'q1-b', q2: 'q2-b' }, first_answers: { q1: 'q1-a', q2: 'q2-b' }, current_index: 1,
  score: 2, first_try_score: 1, total: 2, started_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:05:00Z', completed_at: '2026-01-01T00:05:00Z',
  ...values,
})

describe('study set helpers', () => {
  it('excludes incomplete cards and questions', () => {
    expect(validFlashcard({ id: '1', front: richTextFromText('Front'), back: richTextFromText(''), frontText: 'Front', backText: '' })).toBe(false)
    expect(validQuizQuestion({ ...question('q'), correctChoiceId: '' })).toBe(false)
  })

  it('scores immutable quiz snapshots', () => {
    const snapshot = buildQuizSnapshot([question('q1'), question('q2')], false, false)
    expect(scoreQuiz(snapshot, { q1: 'q1-b', q2: 'q2-a' })).toBe(1)
  })

  it('distinguishes first-try learning from recovered answers', () => {
    expect(quizAttemptMetrics(attempt())).toMatchObject({ total: 2, firstTryCorrect: 1, finalCorrect: 2, recovered: 1 })
    expect(quizReviewQuestionIds(attempt())).toEqual(['q1'])
  })

  it('builds topic mastery from recent real outcomes', () => {
    const insights = quizTopicInsights([
      attempt(),
      attempt({ id: 'older', answers: { q1: 'q1-a', q2: 'q2-b' }, first_answers: { q1: 'q1-a', q2: 'q2-b' }, completed_at: '2025-12-31T00:00:00Z' }),
    ], { quiz: 'Quiz title' })
    expect(insights[0]).toMatchObject({ topic: 'Foundations', exposures: 4, correct: 3, accuracy: 75, mastery: 65 })
  })

  it('applies question and choice shuffle options without mutating the quiz', () => {
    const questions = [question('q1'), question('q2'), question('q3')]
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    const snapshot = buildQuizSnapshot(questions, true, true)

    expect(snapshot.shuffleQuestions).toBe(true)
    expect(snapshot.shuffleChoices).toBe(true)
    expect(snapshot.questions.map(item => item.id)).toEqual(['q2', 'q3', 'q1'])
    expect(snapshot.questions.every(item => item.choices[0].id === `${item.id}-b`)).toBe(true)
    expect(questions.map(item => item.id)).toEqual(['q1', 'q2', 'q3'])
    expect(questions.every(item => item.choices[0].id === `${item.id}-a`)).toBe(true)
    random.mockRestore()
  })

  it('preserves authored order when shuffle options are off', () => {
    const questions = [question('q1'), question('q2'), question('q3')]
    const snapshot = buildQuizSnapshot(questions, false, false)

    expect(snapshot.questions.map(item => item.id)).toEqual(['q1', 'q2', 'q3'])
    expect(snapshot.questions.every(item => item.choices[0].id === `${item.id}-a`)).toBe(true)
  })

  it('returns skipped questions after all untouched questions', () => {
    const questions = [question('q1'), question('q2'), question('q3')]
    const answers = { q1: SKIPPED_QUIZ_ANSWER, q2: 'q2-b' }

    expect(nextQuizQuestionIndex(questions, answers, 1)).toBe(2)
    expect(nextQuizQuestionIndex(questions, { ...answers, q3: 'q3-a' }, 2)).toBe(0)
    expect(nextQuizQuestionIndex(questions, { q1: 'q1-a', q2: 'q2-b', q3: 'q3-a' }, 2)).toBeNull()
  })

  it('keeps the final skipped item open until it is answered', () => {
    const questions = [question('q1')]
    expect(nextQuizQuestionIndex(questions, { q1: SKIPPED_QUIZ_ANSWER }, 0)).toBe(0)
  })

  it('detects when an active attempt no longer matches an edited quiz', () => {
    const original = [question('q1'), question('q2')]
    const snapshot = buildQuizSnapshot(original, true, true)

    expect(quizSnapshotMatchesQuestions(snapshot, original)).toBe(true)
    expect(quizSnapshotMatchesQuestions(snapshot, original.map(item => item.id === 'q1' ? { ...item, promptText: 'Updated question' } : item))).toBe(false)
  })

  it('accepts a current needs-review subset but rejects edited review questions', () => {
    const current = [question('q1'), question('q2'), question('q3')]
    const reviewSnapshot = buildQuizSnapshot([current[0], current[2]], false, false)

    expect(quizSnapshotMatchesQuestionSubset(reviewSnapshot, current)).toBe(true)
    expect(quizSnapshotMatchesQuestionSubset(reviewSnapshot, current.map(item => item.id === 'q3' ? { ...item, promptText: 'Edited' } : item))).toBe(false)
  })

  it('requires two consecutive Got it recalls for mastery', () => {
    const first = applySessionRatings({}, { card: 'good' }, '2026-01-01')
    expect(first.card).toMatchObject({ mastered: false, goodStreak: 1 })
    const second = applySessionRatings(first, { card: 'good' }, '2026-01-02')
    expect(second.card).toMatchObject({ mastered: true, goodStreak: 2 })
    const reset = applySessionRatings(second, { card: 'hard' }, '2026-01-03')
    expect(reset.card).toMatchObject({ mastered: false, goodStreak: 0 })
  })

  it('tracks mastery independently across multiple cards', () => {
    const progress = applySessionRatings({}, { first: 'hard', second: 'good' }, '2026-01-01')
    expect(progress.first.mastered).toBe(false)
    expect(progress.second).toMatchObject({ mastered: false, goodStreak: 1 })
    const next = applySessionRatings(progress, { second: 'good' }, '2026-01-02')
    expect(next.second.mastered).toBe(true)
  })

  it('builds sequential and deterministic shuffled flashcard sessions', () => {
    const cards = [card('1'), card('2'), card('3')]
    const sequential = buildFlashcardSession(cards, {}, { mode: 'sequential', learningOnly: false }, 'session-a', '2026-01-01', () => 0)
    const shuffledSession = buildFlashcardSession(cards, {}, { mode: 'shuffle', learningOnly: false }, 'session-b', '2026-01-01', () => 0)

    expect(sequential?.cardIds).toEqual(['1', '2', '3'])
    expect(shuffledSession?.cardIds).toEqual(['2', '3', '1'])
    expect(cards.map(item => item.id)).toEqual(['1', '2', '3'])
  })

  it('builds learning-only sessions from ready cards that are not mastered', () => {
    const cards = [card('1'), card('2'), card('3', '', '')]
    const progress = { '1': learned(true), '2': learned(false) }

    expect(flashcardsForSession(cards, progress, true).map(item => item.id)).toEqual(['2'])
    expect(buildFlashcardSession(cards, progress, { mode: 'sequential', learningOnly: true }, 'session', '2026-01-01')?.cardIds).toEqual(['2'])
    expect(buildFlashcardSession([card('1')], { '1': learned(true) }, { mode: 'sequential', learningOnly: true }, 'session', '2026-01-01')).toBeNull()
  })

  it('preserves progress for reorder-only edits and resets changed or deleted cards', () => {
    const first = card('1'), second = card('2'), progress = { '1': learned(true), '2': learned(false) }
    expect(flashcardContentChanged([first, second], [second, first])).toBe(false)
    expect(reconcileFlashcardProgress([first, second], [second, first], progress)).toEqual(progress)

    const edited = card('1', 'Updated front', first.backText)
    expect(flashcardContentChanged([first, second], [edited, second])).toBe(true)
    expect(reconcileFlashcardProgress([first, second], [edited], progress)).toEqual({})
  })
})
