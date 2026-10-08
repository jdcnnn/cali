import { describe, expect, it, vi } from 'vitest'
import { applySessionRatings, buildQuizSnapshot, nextQuizQuestionIndex, quizSnapshotMatchesQuestions, richTextFromText, scoreQuiz, SKIPPED_QUIZ_ANSWER, validFlashcard, validQuizQuestion, type QuizQuestion } from './studySets'

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

describe('study set helpers', () => {
  it('excludes incomplete cards and questions', () => {
    expect(validFlashcard({ id: '1', front: richTextFromText('Front'), back: richTextFromText(''), frontText: 'Front', backText: '' })).toBe(false)
    expect(validQuizQuestion({ ...question('q'), correctChoiceId: '' })).toBe(false)
  })

  it('scores immutable quiz snapshots', () => {
    const snapshot = buildQuizSnapshot([question('q1'), question('q2')], false, false)
    expect(scoreQuiz(snapshot, { q1: 'q1-b', q2: 'q2-a' })).toBe(1)
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
})
