export type Level = "foundation" | "standard" | "advanced";
export type SelfLevel = "new" | "some" | "well" | "very_well";
export type MistakeType =
  | "concept_misunderstanding"
  | "calculation_error"
  | "misread_question"
  | "careless_mistake";

export interface Question {
  id: string;
  topic_id: string;
  level: Level;
  stage: string;
  prompt: string;
  options: string[];
  correct_index: number;
  explanation: string;
  concept: string;
}

export interface AnswerRecord {
  question_id: string;
  topic_id: string;
  stage: "assessment" | "quiz";
  selected_index: number;
  is_correct: boolean;
  time_ms: number;
  concept: string;
  mistake_type: MistakeType | null;
}

export interface LessonContent {
  intro: string;
  sections: { heading: string; body: string }[];
  examples: string[];
  practice: string[];
}

export interface GuidanceContent {
  summary: string;
  hints: string[];
  studyTips: string[];
  nextSteps: string[];
}

export const SELF_LEVELS: { value: SelfLevel; label: string; hint: string }[] = [
  { value: "new", label: "New to it", hint: "I have not studied this before" },
  { value: "some", label: "Know some", hint: "I have seen it but I forget things" },
  { value: "well", label: "Know well", hint: "I can solve most normal questions" },
  { value: "very_well", label: "Know very well", hint: "I want a real challenge" },
];

export const LEVEL_META: Record<Level, { label: string; blurb: string; bullets: string[] }> = {
  foundation: {
    label: "Foundation Path",
    blurb: "Basic concepts, simple explanations, guided practice",
    bullets: ["Basic concepts", "Simple explanations", "Guided practice"],
  },
  standard: {
    label: "Standard Path",
    blurb: "Conceptual learning, examples, practice questions",
    bullets: ["Conceptual learning", "Worked examples", "Practice questions"],
  },
  advanced: {
    label: "Advanced Path",
    blurb: "In-depth concepts, complex problems, challenges",
    bullets: ["In-depth concepts", "Complex problems", "Challenges"],
  },
};

export const MISTAKE_LABELS: Record<MistakeType, string> = {
  concept_misunderstanding: "Concept misunderstanding",
  calculation_error: "Calculation error",
  misread_question: "Misread question",
  careless_mistake: "Careless mistake",
};

/** Step 3 -> 4: which difficulty the initial assessment should start from. */
export function levelFromSelfCheck(self: SelfLevel): Level {
  if (self === "new") return "foundation";
  if (self === "some") return "standard";
  return "advanced";
}

/** Step 5 + 7: AI decision engine — turn assessment performance into a path. */
export function decidePath(selfLevel: SelfLevel, accuracy: number, avgTimeMs: number): Level {
  let score = accuracy;
  if (selfLevel === "well") score += 6;
  if (selfLevel === "very_well") score += 12;
  if (selfLevel === "new") score -= 6;
  if (avgTimeMs > 45000) score -= 8;
  else if (avgTimeMs < 12000) score += 4;

  if (score >= 80) return "advanced";
  if (score >= 50) return "standard";
  return "foundation";
}

export function knowledgeLabel(accuracy: number): string {
  if (accuracy >= 85) return "Strong";
  if (accuracy >= 60) return "Developing";
  if (accuracy >= 35) return "Emerging";
  return "Beginner";
}

/** Step 10: classify why a mistake happened from answer behaviour. */
export function classifyMistake(
  question: Question,
  selectedIndex: number,
  timeMs: number,
): MistakeType {
  if (timeMs < 4000) return "careless_mistake";
  if (timeMs > 60000) return "concept_misunderstanding";
  const picked = (question.options[selectedIndex] ?? "").toLowerCase();
  const correct = (question.options[question.correct_index] ?? "").toLowerCase();
  const numeric = /\d/.test(picked) && /\d/.test(correct);
  if (numeric) return "calculation_error";
  if (/not|never|except|least|false/.test(question.prompt.toLowerCase())) return "misread_question";
  return "concept_misunderstanding";
}

export function accuracyOf(answers: AnswerRecord[]): number {
  if (answers.length === 0) return 0;
  return Math.round((answers.filter((a) => a.is_correct).length / answers.length) * 100);
}

export function avgTimeOf(answers: AnswerRecord[]): number {
  if (answers.length === 0) return 0;
  return Math.round(answers.reduce((sum, a) => sum + a.time_ms, 0) / answers.length);
}

export function conceptSplit(answers: AnswerRecord[]): { strengths: string[]; weaknesses: string[] } {
  const map = new Map<string, { ok: number; total: number }>();
  for (const a of answers) {
    const entry = map.get(a.concept) ?? { ok: 0, total: 0 };
    entry.total += 1;
    if (a.is_correct) entry.ok += 1;
    map.set(a.concept, entry);
  }
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  for (const [concept, { ok, total }] of map) {
    if (ok / total >= 0.7) strengths.push(concept);
    else weaknesses.push(concept);
  }
  return { strengths, weaknesses };
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
