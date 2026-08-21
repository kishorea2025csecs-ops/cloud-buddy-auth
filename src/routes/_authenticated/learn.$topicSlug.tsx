import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  CloudOff,
  Gauge,
  Lightbulb,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Search,
  Sparkles,
  Trophy,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { generateGuidance, generateLesson } from "@/lib/ai.functions";
import {
  cacheLesson,
  cacheQuestions,
  readCachedLesson,
  readCachedQuestions,
  useOnlineStatus,
} from "@/lib/offline";
import { saveAttempts, syncOfflineQueue } from "@/lib/sync";
import {
  LEVEL_META,
  MISTAKE_LABELS,
  SELF_LEVELS,
  accuracyOf,
  avgTimeOf,
  classifyMistake,
  conceptSplit,
  decidePath,
  formatSeconds,
  knowledgeLabel,
  levelFromSelfCheck,
  type AnswerRecord,
  type GuidanceContent,
  type LessonContent,
  type Level,
  type Question,
  type SelfLevel,
} from "@/lib/nexlearn";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/_authenticated/learn/$topicSlug")({
  head: () => ({
    meta: [
      { title: "Adaptive learning session — NexLearn AI" },
      {
        name: "description",
        content:
          "Self-level check, initial assessment, an AI-chosen learning path, adaptive quiz, mistake analysis and personalized feedback.",
      },
      { property: "og:title", content: "Adaptive learning session — NexLearn AI" },
      {
        property: "og:description",
        content: "Self-check, assessment, adaptive lesson and quiz, then AI feedback.",
      },
    ],
  }),
  component: LearnPage,
});

type Stage =
  | "self_check"
  | "assessment"
  | "analysis"
  | "lesson"
  | "quiz"
  | "review"
  | "feedback";

const STAGE_STEPS: { id: Stage; label: string }[] = [
  { id: "self_check", label: "Self-level check" },
  { id: "assessment", label: "Initial assessment" },
  { id: "analysis", label: "AI analysis" },
  { id: "lesson", label: "Learning session" },
  { id: "quiz", label: "Adaptive quiz" },
  { id: "review", label: "Mistake analysis" },
  { id: "feedback", label: "AI feedback" },
];

function LearnPage() {
  const { topicSlug } = useParams({ from: "/_authenticated/learn/$topicSlug" });
  const { user } = useAuth();
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const runLesson = useServerFn(generateLesson);
  const runGuidance = useServerFn(generateGuidance);

  const [stage, setStage] = useState<Stage>("self_check");
  const [selfLevel, setSelfLevel] = useState<SelfLevel | null>(null);
  const [path, setPath] = useState<Level | null>(null);
  const [assessAnswers, setAssessAnswers] = useState<AnswerRecord[]>([]);
  const [quizAnswers, setQuizAnswers] = useState<AnswerRecord[]>([]);
  const [lesson, setLesson] = useState<LessonContent | null>(null);
  const [lessonLoading, setLessonLoading] = useState(false);
  const [guidance, setGuidance] = useState<GuidanceContent | null>(null);
  const [guidanceLoading, setGuidanceLoading] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["topic", topicSlug],
    queryFn: async () => {
      const topic = await supabase
        .from("topics")
        .select("*, subjects(name)")
        .eq("slug", topicSlug)
        .maybeSingle();
      if (topic.error) throw topic.error;
      if (!topic.data) throw new Error("Topic not found");
      const questions = await supabase.from("questions").select("*").eq("topic_id", topic.data.id);
      if (questions.error) throw questions.error;
      const payload = {
        topic: topic.data,
        questions: questions.data as unknown as Question[],
      };
      cacheQuestions(topic.data.id, payload);
      return payload;
    },
    retry: 1,
    initialData: () => readCachedQuestions<{ topic: any; questions: Question[] }>(topicSlug) ?? undefined,
  });

  useEffect(() => {
    if (user && online) void syncOfflineQueue(user.id);
  }, [user, online]);

  const questions = data?.questions ?? [];
  const subjectName = (data?.topic?.subjects as { name?: string } | null)?.name ?? "";
  const topicName = data?.topic?.name ?? "";

  const assessmentSet = useMemo(() => {
    if (!selfLevel) return [];
    const pool = questions.filter((q) => q.stage === "assessment");
    const start = levelFromSelfCheck(selfLevel);
    const order: Level[] = ["foundation", "standard", "advanced"];
    return [...pool].sort(
      (a, b) =>
        Math.abs(order.indexOf(a.level) - order.indexOf(start)) -
        Math.abs(order.indexOf(b.level) - order.indexOf(start)),
    );
  }, [questions, selfLevel]);

  const quizPool = useMemo(() => questions.filter((q) => q.stage === "quiz"), [questions]);

  async function persist(records: AnswerRecord[], extra?: Record<string, unknown>) {
    if (!user || !data) return;
    const result = await saveAttempts(user.id, records, online);
    if (!result.synced) {
      toast.info("Saved on this device. It will sync when you are back online.");
    }
    if (online && extra) {
      await supabase
        .from("learner_topics")
        .upsert({ user_id: user.id, topic_id: data.topic.id, ...extra }, { onConflict: "user_id,topic_id" });
      void queryClient.invalidateQueries({ queryKey: ["dashboard", user.id] });
    }
  }

  async function finishAssessment(records: AnswerRecord[]) {
    setAssessAnswers(records);
    const accuracy = accuracyOf(records);
    const avg = avgTimeOf(records);
    const chosen = decidePath(selfLevel!, accuracy, avg);
    setPath(chosen);
    setStage("analysis");
    const { strengths, weaknesses } = conceptSplit(records);
    await persist(records, {
      self_level: selfLevel,
      path: chosen,
      knowledge_level: knowledgeLabel(accuracy),
      accuracy,
      avg_time_ms: avg,
      strengths,
      weaknesses,
      last_stage: "analysis",
    });
  }

  async function startLesson(chosen: Level) {
    setStage("lesson");
    const cached = data ? readCachedLesson(data.topic.id, chosen) : null;
    if (cached) {
      setLesson(cached);
      return;
    }
    if (!online) {
      toast.error("No cached lesson for this path yet. Reconnect once to download it.");
      return;
    }
    setLessonLoading(true);
    try {
      const { weaknesses } = conceptSplit(assessAnswers);
      const result = await runLesson({
        data: { subject: subjectName, topic: topicName, path: chosen, weaknesses },
      });
      setLesson(result);
      if (data) cacheLesson(data.topic.id, chosen, result);
      if (user && data) {
        await supabase
          .from("ai_lessons")
          .upsert(
            { user_id: user.id, topic_id: data.topic.id, path: chosen, content: result },
            { onConflict: "user_id,topic_id,path" },
          );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate the lesson.");
    } finally {
      setLessonLoading(false);
    }
  }

  async function finishQuiz(records: AnswerRecord[]) {
    setQuizAnswers(records);
    setStage("review");
    const all = [...assessAnswers, ...records];
    const accuracy = accuracyOf(all);
    const avg = avgTimeOf(all);
    const { strengths, weaknesses } = conceptSplit(all);
    const mastery = Math.round(
      accuracy * (path === "advanced" ? 1 : path === "standard" ? 0.9 : 0.8),
    );
    let streak = 0;
    for (const r of records) {
      if (r.is_correct) streak += 1;
      else streak = 0;
    }
    await persist(records, {
      accuracy,
      avg_time_ms: avg,
      mastery,
      streak,
      strengths,
      weaknesses,
      knowledge_level: knowledgeLabel(accuracy),
      last_stage: "review",
    });
  }

  async function loadGuidance() {
    setStage("feedback");
    if (!online) {
      toast.error("AI feedback needs internet. Your results are saved.");
      return;
    }
    setGuidanceLoading(true);
    try {
      const all = [...assessAnswers, ...quizAnswers];
      const { strengths } = conceptSplit(all);
      const result = await runGuidance({
        data: {
          subject: subjectName,
          topic: topicName,
          path: path ?? "standard",
          accuracy: accuracyOf(all),
          avgSeconds: Math.round(avgTimeOf(all) / 1000),
          strengths,
          mistakes: all
            .filter((a) => !a.is_correct)
            .map((a) => ({ concept: a.concept, type: a.mistake_type ?? "unknown" })),
        },
      });
      setGuidance(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate feedback.");
    } finally {
      setGuidanceLoading(false);
    }
  }

  if (isLoading || !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const stageIndex = STAGE_STEPS.findIndex((s) => s.id === stage);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">
            {subjectName}
          </p>
          <h1 className="font-display text-3xl font-bold">{topicName}</h1>
        </div>
        {!online && (
          <Badge variant="outline" className="gap-1.5">
            <CloudOff className="size-3.5" /> Learning offline
          </Badge>
        )}
      </div>

      <div className="mt-6">
        <Progress value={((stageIndex + 1) / STAGE_STEPS.length) * 100} />
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {STAGE_STEPS.map((s, i) => (
            <span key={s.id} className={i <= stageIndex ? "font-semibold text-primary" : ""}>
              {i + 1}. {s.label}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-8 space-y-6">
        {stage === "self_check" && (
          <Card className="surface-panel border-border/60">
            <CardHeader>
              <CardTitle className="font-display text-xl">
                How well do you know this topic?
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Your answer sets the starting difficulty of the assessment.
              </p>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {SELF_LEVELS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    setSelfLevel(option.value);
                    setStage("assessment");
                  }}
                  className="rounded-xl border border-border/70 bg-background/70 p-4 text-left transition-all hover:border-primary hover:lift"
                >
                  <span className="font-semibold">{option.label}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{option.hint}</span>
                </button>
              ))}
            </CardContent>
          </Card>
        )}

        {stage === "assessment" && (
          <QuestionRunner
            title="Initial assessment"
            subtitle="A short check to see what you already understand."
            questions={assessmentSet}
            stageName="assessment"
            onDone={finishAssessment}
          />
        )}

        {stage === "analysis" && path && (
          <AnalysisPanel
            answers={assessAnswers}
            path={path}
            onContinue={() => startLesson(path)}
          />
        )}

        {stage === "lesson" && (
          <LessonPanel
            lesson={lesson}
            loading={lessonLoading}
            path={path ?? "standard"}
            onRetry={() => startLesson(path ?? "standard")}
            onStartQuiz={() => setStage("quiz")}
          />
        )}

        {stage === "quiz" && (
          <AdaptiveQuiz pool={quizPool} startLevel={path ?? "standard"} onDone={finishQuiz} />
        )}

        {stage === "review" && (
          <ReviewPanel
            answers={[...assessAnswers, ...quizAnswers]}
            quizAnswers={quizAnswers}
            onContinue={loadGuidance}
          />
        )}

        {stage === "feedback" && (
          <FeedbackPanel
            guidance={guidance}
            loading={guidanceLoading}
            onRetry={loadGuidance}
            onRestart={() => {
              setStage("self_check");
              setSelfLevel(null);
              setPath(null);
              setAssessAnswers([]);
              setQuizAnswers([]);
              setGuidance(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

function QuestionRunner({
  title,
  subtitle,
  questions,
  stageName,
  onDone,
}: {
  title: string;
  subtitle: string;
  questions: Question[];
  stageName: "assessment" | "quiz";
  onDone: (records: AnswerRecord[]) => void;
}) {
  const [index, setIndex] = useState(0);
  const [records, setRecords] = useState<AnswerRecord[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const startedAt = useRef(Date.now());

  const question = questions[index];

  useEffect(() => {
    startedAt.current = Date.now();
    setSelected(null);
  }, [index]);

  if (!question) {
    return (
      <Card className="surface-panel border-border/60">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No questions available for this topic yet.
        </CardContent>
      </Card>
    );
  }

  function submit(choice: number) {
    if (selected !== null) return;
    setSelected(choice);
    const timeMs = Date.now() - startedAt.current;
    const correct = choice === question.correct_index;
    const record: AnswerRecord = {
      question_id: question.id,
      topic_id: question.topic_id,
      stage: stageName,
      selected_index: choice,
      is_correct: correct,
      time_ms: timeMs,
      concept: question.concept,
      mistake_type: correct ? null : classifyMistake(question, choice, timeMs),
    };
    const next = [...records, record];
    setRecords(next);
    window.setTimeout(() => {
      if (index + 1 >= questions.length) onDone(next);
      else setIndex(index + 1);
    }, 1400);
  }

  return (
    <Card className="surface-panel border-border/60">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="font-display text-xl">{title}</CardTitle>
          <Badge variant="secondary">
            {index + 1} / {questions.length}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{LEVEL_META[question.level].label}</Badge>
          <span className="text-xs text-muted-foreground">{question.concept}</span>
        </div>
        <p className="text-lg font-medium">{question.prompt}</p>
        <div className="grid gap-2">
          {question.options.map((option, i) => {
            const isCorrect = i === question.correct_index;
            const chosen = selected === i;
            const state =
              selected === null
                ? "idle"
                : isCorrect
                  ? "correct"
                  : chosen
                    ? "wrong"
                    : "idle";
            return (
              <button
                key={option}
                onClick={() => submit(i)}
                disabled={selected !== null}
                className={[
                  "flex items-center justify-between rounded-lg border px-4 py-3 text-left text-sm transition-colors",
                  state === "correct"
                    ? "border-success bg-success/15"
                    : state === "wrong"
                      ? "border-destructive bg-destructive/10"
                      : "border-border/70 bg-background/70 hover:border-primary",
                ].join(" ")}
              >
                <span>{option}</span>
                {state === "correct" && <CheckCircle2 className="size-4 text-success" />}
                {state === "wrong" && <XCircle className="size-4 text-destructive" />}
              </button>
            );
          })}
        </div>
        {selected !== null && (
          <p className="rounded-lg bg-secondary p-3 text-sm text-secondary-foreground">
            {question.explanation}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function AdaptiveQuiz({
  pool,
  startLevel,
  onDone,
}: {
  pool: Question[];
  startLevel: Level;
  onDone: (records: AnswerRecord[]) => void;
}) {
  const order: Level[] = ["foundation", "standard", "advanced"];
  const [used, setUsed] = useState<string[]>([]);
  const [level, setLevel] = useState<Level>(startLevel);
  const [records, setRecords] = useState<AnswerRecord[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const startedAt = useRef(Date.now());

  const remaining = pool.filter((q) => !used.includes(q.id));
  const question =
    remaining.find((q) => q.level === level) ??
    remaining.slice().sort(
      (a, b) =>
        Math.abs(order.indexOf(a.level) - order.indexOf(level)) -
        Math.abs(order.indexOf(b.level) - order.indexOf(level)),
    )[0];

  useEffect(() => {
    startedAt.current = Date.now();
    setSelected(null);
  }, [question?.id]);

  if (!question) {
    return (
      <Card className="surface-panel border-border/60">
        <CardContent className="space-y-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">Quiz complete.</p>
          <Button onClick={() => onDone(records)}>See results</Button>
        </CardContent>
      </Card>
    );
  }

  function submit(choice: number) {
    if (selected !== null) return;
    setSelected(choice);
    const timeMs = Date.now() - startedAt.current;
    const correct = choice === question.correct_index;
    const record: AnswerRecord = {
      question_id: question.id,
      topic_id: question.topic_id,
      stage: "quiz",
      selected_index: choice,
      is_correct: correct,
      time_ms: timeMs,
      concept: question.concept,
      mistake_type: correct ? null : classifyMistake(question, choice, timeMs),
    };
    const next = [...records, record];
    setRecords(next);
    const currentIdx = order.indexOf(question.level);
    const nextLevel = order[Math.min(2, Math.max(0, currentIdx + (correct ? 1 : -1)))]!;
    window.setTimeout(() => {
      const nextUsed = [...used, question.id];
      setUsed(nextUsed);
      setLevel(nextLevel);
      if (pool.filter((q) => !nextUsed.includes(q.id)).length === 0) onDone(next);
    }, 1500);
  }

  return (
    <Card className="surface-panel border-border/60">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 font-display text-xl">
            <BrainCircuit className="size-5 text-primary" /> Adaptive quiz
          </CardTitle>
          <Badge variant="secondary">
            {used.length + 1} / {pool.length}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Difficulty moves up when you are right and down when you need support.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{LEVEL_META[question.level].label}</Badge>
          <span className="text-xs text-muted-foreground">{question.concept}</span>
        </div>
        <p className="text-lg font-medium">{question.prompt}</p>
        <div className="grid gap-2">
          {question.options.map((option, i) => {
            const isCorrect = i === question.correct_index;
            const chosen = selected === i;
            return (
              <button
                key={option}
                onClick={() => submit(i)}
                disabled={selected !== null}
                className={[
                  "flex items-center justify-between rounded-lg border px-4 py-3 text-left text-sm transition-colors",
                  selected !== null && isCorrect
                    ? "border-success bg-success/15"
                    : selected !== null && chosen
                      ? "border-destructive bg-destructive/10"
                      : "border-border/70 bg-background/70 hover:border-primary",
                ].join(" ")}
              >
                <span>{option}</span>
                {selected !== null && isCorrect && <CheckCircle2 className="size-4 text-success" />}
                {selected !== null && chosen && !isCorrect && (
                  <XCircle className="size-4 text-destructive" />
                )}
              </button>
            );
          })}
        </div>
        {selected !== null && (
          <p className="rounded-lg bg-secondary p-3 text-sm text-secondary-foreground">
            {question.explanation}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function AnalysisPanel({
  answers,
  path,
  onContinue,
}: {
  answers: AnswerRecord[];
  path: Level;
  onContinue: () => void;
}) {
  const accuracy = accuracyOf(answers);
  const avg = avgTimeOf(answers);
  const { strengths, weaknesses } = conceptSplit(answers);

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card className="surface-panel border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display text-xl">
            <Gauge className="size-5 text-primary" /> AI analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="Score" value={`${answers.filter((a) => a.is_correct).length}/${answers.length}`} />
          <Row label="Accuracy" value={`${accuracy}%`} />
          <Row label="Average time" value={formatSeconds(avg)} />
          <Row label="Knowledge level" value={knowledgeLabel(accuracy)} />
          <div className="pt-2">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Strengths</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {strengths.length === 0 ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                strengths.map((s) => (
                  <Badge key={s} className="bg-success text-success-foreground">
                    {s}
                  </Badge>
                ))
              )}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground">Weaknesses</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {weaknesses.length === 0 ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                weaknesses.map((w) => (
                  <Badge key={w} variant="destructive">
                    {w}
                  </Badge>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="surface-panel border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display text-xl">
            <Sparkles className="size-5 text-accent" /> Your learning path
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="font-display text-2xl font-bold">{LEVEL_META[path].label}</p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {LEVEL_META[path].bullets.map((b) => (
              <li key={b}>• {b}</li>
            ))}
          </ul>
          <Button className="w-full" onClick={onContinue}>
            Start learning session <ArrowRight className="size-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function LessonPanel({
  lesson,
  loading,
  path,
  onRetry,
  onStartQuiz,
}: {
  lesson: LessonContent | null;
  loading: boolean;
  path: Level;
  onRetry: () => void;
  onStartQuiz: () => void;
}) {
  return (
    <Card className="surface-panel border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="font-display text-xl">Learning session</CardTitle>
          <Badge variant="secondary">{LEVEL_META[path].label}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Personalized lesson, examples and practice — cached on your device for offline reading.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading && (
          <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> NexLearn AI is writing your lesson…
          </div>
        )}

        {!loading && !lesson && (
          <div className="space-y-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">The lesson could not be loaded.</p>
            <Button variant="outline" onClick={onRetry}>
              <RefreshCw className="size-4" /> Try again
            </Button>
          </div>
        )}

        {lesson && (
          <>
            <p className="text-base">{lesson.intro}</p>
            {lesson.sections?.map((section) => (
              <div key={section.heading}>
                <h3 className="font-display text-lg font-semibold">{section.heading}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{section.body}</p>
              </div>
            ))}
            {lesson.examples?.length > 0 && (
              <div className="rounded-lg border border-border/70 bg-background/70 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <Lightbulb className="size-4 text-accent" /> Worked examples
                </p>
                <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                  {lesson.examples.map((ex) => (
                    <li key={ex}>{ex}</li>
                  ))}
                </ul>
              </div>
            )}
            {lesson.practice?.length > 0 && (
              <div>
                <p className="text-sm font-semibold">Practice before the quiz</p>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {lesson.practice.map((p) => (
                    <li key={p}>• {p}</li>
                  ))}
                </ul>
              </div>
            )}
            <Button className="w-full" onClick={onStartQuiz}>
              I'm ready — start the adaptive quiz <ArrowRight className="size-4" />
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ReviewPanel({
  answers,
  quizAnswers,
  onContinue,
}: {
  answers: AnswerRecord[];
  quizAnswers: AnswerRecord[];
  onContinue: () => void;
}) {
  const accuracy = accuracyOf(quizAnswers);
  const mistakes = answers.filter((a) => !a.is_correct);
  const ready = accuracy >= 70;

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card className="surface-panel border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display text-xl">
            <Search className="size-5 text-primary" /> Mistake analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {mistakes.length === 0 ? (
            <p className="text-muted-foreground">No mistakes — excellent work.</p>
          ) : (
            mistakes.map((m, i) => (
              <div key={`${m.question_id}-${i}`} className="rounded-lg border border-border/70 p-3">
                <p className="font-medium">{m.concept}</p>
                <p className="text-muted-foreground">
                  {MISTAKE_LABELS[m.mistake_type ?? "concept_misunderstanding"]} ·{" "}
                  {formatSeconds(m.time_ms)}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="surface-panel border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display text-xl">
            <Trophy className="size-5 text-accent" /> Performance check
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label="Quiz accuracy" value={`${accuracy}%`} />
          <Row label="Questions" value={`${quizAnswers.length}`} />
          <div
            className={`rounded-lg p-4 ${ready ? "bg-success/15" : "bg-destructive/10"}`}
          >
            <p className="font-semibold">{ready ? "Ready to advance" : "Needs support"}</p>
            <ul className="mt-1 space-y-1 text-muted-foreground">
              {(ready
                ? ["Harder questions", "Next topic", "New challenges"]
                : ["Revision and hints", "Extra practice", "Simplified explanation"]
              ).map((item) => (
                <li key={item}>• {item}</li>
              ))}
            </ul>
          </div>
          <Button className="w-full" onClick={onContinue}>
            Get AI feedback <ArrowRight className="size-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function FeedbackPanel({
  guidance,
  loading,
  onRetry,
  onRestart,
}: {
  guidance: GuidanceContent | null;
  loading: boolean;
  onRetry: () => void;
  onRestart: () => void;
}) {
  return (
    <Card className="surface-panel border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display text-xl">
          <MessageSquareText className="size-5 text-primary" /> AI feedback & guidance
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Your learner profile has been updated with this session — the next one adapts to it.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading && (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Preparing personalized feedback…
          </div>
        )}

        {!loading && !guidance && (
          <div className="space-y-3 py-6 text-center">
            <p className="text-sm text-muted-foreground">Feedback is not available right now.</p>
            <Button variant="outline" onClick={onRetry}>
              <RefreshCw className="size-4" /> Try again
            </Button>
          </div>
        )}

        {guidance && (
          <>
            <p className="text-base">{guidance.summary}</p>
            <FeedbackList title="Hints" items={guidance.hints} />
            <FeedbackList title="Study tips" items={guidance.studyTips} />
            <FeedbackList title="Next steps" items={guidance.nextSteps} />
          </>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          <Button asChild variant="outline">
            <Link to="/dashboard">View progress dashboard</Link>
          </Button>
          <Button variant="ghost" onClick={onRestart}>
            <RefreshCw className="size-4" /> Study this topic again
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function FeedbackList({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="text-sm font-semibold">{title}</p>
      <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={item}>• {item}</li>
        ))}
      </ul>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
