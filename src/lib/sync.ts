import { supabase } from "@/integrations/supabase/client";
import type { AnswerRecord } from "./nexlearn";
import { clearQueue, queueAttempts, readQueue } from "./offline";

export async function saveAttempts(userId: string, records: AnswerRecord[], online: boolean) {
  if (records.length === 0) return { synced: false };
  if (!online) {
    queueAttempts(records);
    return { synced: false };
  }
  const { error } = await supabase.from("attempts").insert(
    records.map((r) => ({
      user_id: userId,
      topic_id: r.topic_id,
      question_id: r.question_id,
      stage: r.stage,
      selected_index: r.selected_index,
      is_correct: r.is_correct,
      time_ms: r.time_ms,
      mistake_type: r.mistake_type,
      concept: r.concept,
      synced_offline: false,
    })),
  );
  if (error) {
    queueAttempts(records);
    return { synced: false };
  }
  return { synced: true };
}

/** Step: auto-sync & resume — push everything saved while offline. */
export async function syncOfflineQueue(userId: string): Promise<number> {
  const pending = readQueue();
  if (pending.length === 0) return 0;
  const { error } = await supabase.from("attempts").insert(
    pending.map((r) => ({
      user_id: userId,
      topic_id: r.topic_id,
      question_id: r.question_id,
      stage: r.stage,
      selected_index: r.selected_index,
      is_correct: r.is_correct,
      time_ms: r.time_ms,
      mistake_type: r.mistake_type,
      concept: r.concept,
      synced_offline: true,
    })),
  );
  if (error) return 0;
  clearQueue();
  return pending.length;
}
