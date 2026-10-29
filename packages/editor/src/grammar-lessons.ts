export type GrammarLesson = {
  title: string;
  why: string;
  example: string;
  practice: { prompt: string; choices: string[]; answer: number; explanation: string };
};

// These lessons match named Harper rules; other findings keep the checker's own explanation.
const lessons: Record<string, GrammarLesson> = {
  AnA: {
    title: "A or an",
    why: "Use “an” before a vowel sound and “a” before a consonant sound.",
    example: "an apple · a book · an hour · a university",
    practice: { prompt: "I waited for ___ hour.", choices: ["a", "an"], answer: 1, explanation: "“Hour” starts with a vowel sound, so use “an”." },
  },
  PronounVerbAgreement: {
    title: "Match the subject and verb",
    why: "Choose the verb form that fits who you mean: “she has”, but “they have”.",
    example: "She has a plan. They have a plan.",
    practice: { prompt: "She ___ a plan.", choices: ["has", "have"], answer: 0, explanation: "“She” pairs with “has”; “they” pairs with “have”." },
  },
  RepeatedWords: {
    title: "Notice repeated words",
    why: "A word can slip in twice while drafting. Keep both if the repetition is intentional.",
    example: "It is is ready. → It is ready.",
    practice: { prompt: "Which version has no accidental repetition?", choices: ["The the book arrived.", "The book arrived."], answer: 1, explanation: "One “the” is enough here. Repetition can still be a deliberate writing choice." },
  },
  ModalOf: {
    title: "Could have, not could of",
    why: "“Could’ve” sounds like “could of”, but its full form is “could have”.",
    example: "I could have called. I should have called.",
    practice: { prompt: "I should ___ called.", choices: ["have", "of"], answer: 0, explanation: "Use “have” after “could”, “should”, and “would” in this pattern." },
  },
};
export const grammarLesson = (rule: string) => lessons[rule];
