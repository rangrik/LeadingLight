// The run form's answers and their problems, shared by every extension run dialog.
import type { AnswerValue, FormAnswers, FormField, InputProblem } from './extensionContract'
import { answerTextProblem } from './extensionMarkdown'
import { isFieldProblem, type FieldProblem } from './extensionUiText'

export const initialAnswers = (fields: readonly FormField[]): Record<string, AnswerValue> =>
  Object.fromEntries(fields.map(field => [field.id, field.kind === 'boolean' ? false : field.kind === 'choice' ? null : '']))

export const filled = (value: AnswerValue | undefined) => value === true || (typeof value === 'string' && value.trim() !== '')

/** Field problems from the recipe's own checks, then each answer through the literal encoder. */
export function fieldProblems(fields: readonly FormField[], answers: FormAnswers, problems: readonly InputProblem[]): Map<string, FieldProblem> {
  const found = new Map<string, FieldProblem>()
  for (const problem of problems) if (problem.field && isFieldProblem(problem.code) && !found.has(problem.field)) found.set(problem.field, problem.code)
  for (const field of fields) {
    const value = answers[field.id]
    if (found.has(field.id) || typeof value !== 'string' || (field.kind !== 'text' && field.kind !== 'multilineText')) continue
    const failure = answerTextProblem(value, field.kind === 'multilineText')
    if (failure && failure !== 'lineBreak' && failure !== 'tooLong') found.set(field.id, 'unsafeText')
  }
  return found
}

