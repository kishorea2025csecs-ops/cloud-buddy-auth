import { useEffect, useState } from "react";
import type { AnswerRecord, LessonContent } from "./nexlearn";

const QUEUE_KEY = "nexlearn.offline.attempts";
const LESSON_KEY = (topicId: string, path: string) => `nexlearn.lesson.${topicId}.${path}`;
const QUESTIONS_KEY = (topicId: string) => `nexlearn.questions.${topicId}`;

function safeRead<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable — offline cache is best effort */
  }
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(window.navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  return online;
}

export function queueAttempts(records: AnswerRecord[]) {
  const existing = safeRead<AnswerRecord[]>(QUEUE_KEY) ?? [];
  safeWrite(QUEUE_KEY, [...existing, ...records]);
}

export function readQueue(): AnswerRecord[] {
  return safeRead<AnswerRecord[]>(QUEUE_KEY) ?? [];
}

export function clearQueue() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(QUEUE_KEY);
}

export function cacheLesson(topicId: string, path: string, lesson: LessonContent) {
  safeWrite(LESSON_KEY(topicId, path), lesson);
}

export function readCachedLesson(topicId: string, path: string): LessonContent | null {
  return safeRead<LessonContent>(LESSON_KEY(topicId, path));
}

export function cacheQuestions(topicId: string, questions: unknown) {
  safeWrite(QUESTIONS_KEY(topicId), questions);
}

export function readCachedQuestions<T>(topicId: string): T | null {
  return safeRead<T>(QUESTIONS_KEY(topicId));
}
