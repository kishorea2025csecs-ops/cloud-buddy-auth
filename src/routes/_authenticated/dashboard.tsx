import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  CloudUpload,
  Flame,
  Loader2,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useOnlineStatus } from "@/lib/offline";
import { syncOfflineQueue } from "@/lib/sync";
import { LEVEL_META, MISTAKE_LABELS, knowledgeLabel, type MistakeType } from "@/lib/nexlearn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Your progress dashboard — NexLearn AI" },
      {
        name: "description",
        content:
          "Track topic mastery, accuracy, learning streak, strengths and weaknesses across every NexLearn AI session.",
      },
      { property: "og:title", content: "Your progress dashboard — NexLearn AI" },
      {
        property: "og:description",
        content: "Track topic mastery, accuracy, streaks, strengths and weaknesses.",
      },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { user } = useAuth();
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const [profile, learner, topics, attempts] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user!.id).maybeSingle(),
        supabase.from("learner_topics").select("*").eq("user_id", user!.id),
        supabase.from("topics").select("id, name, slug, subject_id"),
        supabase
          .from("attempts")
          .select("id, is_correct, mistake_type, concept, created_at")
          .eq("user_id", user!.id)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      if (learner.error) throw learner.error;
      if (topics.error) throw topics.error;
      return {
        profile: profile.data,
        learner: learner.data,
        topics: topics.data,
        attempts: attempts.data ?? [],
      };
    },
  });

  useEffect(() => {
    if (!user || !online) return;
    void syncOfflineQueue(user.id).then((count) => {
      if (count > 0) {
        toast.success(`Synced ${count} offline answers.`);
        void queryClient.invalidateQueries({ queryKey: ["dashboard", user.id] });
      }
    });
  }, [user, online, queryClient]);

  async function manualSync() {
    if (!user) return;
    setSyncing(true);
    const count = await syncOfflineQueue(user.id);
    setSyncing(false);
    toast[count > 0 ? "success" : "info"](
      count > 0 ? `Synced ${count} offline answers.` : "Everything is already synced.",
    );
    void queryClient.invalidateQueries({ queryKey: ["dashboard", user.id] });
  }

  if (isLoading || !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const topicName = (id: string) => data.topics.find((t) => t.id === id)?.name ?? "Topic";
  const topicSlug = (id: string) => data.topics.find((t) => t.id === id)?.slug ?? "";
  const overall =
    data.learner.length > 0
      ? Math.round(data.learner.reduce((s, l) => s + l.mastery, 0) / data.learner.length)
      : 0;
  const accuracy =
    data.attempts.length > 0
      ? Math.round(
          (data.attempts.filter((a) => a.is_correct).length / data.attempts.length) * 100,
        )
      : 0;
  const streak = data.learner.reduce((max, l) => Math.max(max, l.streak), 0);

  const mistakeCounts = new Map<string, number>();
  for (const a of data.attempts) {
    if (a.mistake_type) mistakeCounts.set(a.mistake_type, (mistakeCounts.get(a.mistake_type) ?? 0) + 1);
  }
  const topMistakes = [...mistakeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

  const allWeak = [...new Set(data.learner.flatMap((l) => l.weaknesses))].slice(0, 6);
  const allStrong = [...new Set(data.learner.flatMap((l) => l.strengths))].slice(0, 6);

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">
            Progress dashboard
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold">
            Hello, {data.profile?.display_name ?? "learner"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your learner profile updates continuously as you study.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={manualSync} disabled={syncing || !online}>
            {syncing ? <Loader2 className="size-4 animate-spin" /> : <CloudUpload className="size-4" />}
            Sync now
          </Button>
          <Button asChild>
            <Link to="/subjects">
              Start a session <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={<TrendingUp className="size-4" />} label="Overall progress" value={`${overall}%`} />
        <Stat icon={<Target className="size-4" />} label="Answer accuracy" value={`${accuracy}%`} />
        <Stat icon={<Flame className="size-4" />} label="Best streak" value={`${streak}`} />
        <Stat
          icon={<Activity className="size-4" />}
          label="Questions answered"
          value={`${data.attempts.length}`}
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <Card className="surface-panel border-border/60 lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display text-xl">Topic mastery</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.learner.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No sessions yet. Pick a topic to build your learner profile.
              </p>
            )}
            {data.learner.map((row) => (
              <div key={row.id} className="space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <Link
                    to="/learn/$topicSlug"
                    params={{ topicSlug: topicSlug(row.topic_id) }}
                    className="font-medium hover:text-primary"
                  >
                    {topicName(row.topic_id)}
                  </Link>
                  <div className="flex items-center gap-2">
                    {row.path && (
                      <Badge variant="secondary">{LEVEL_META[row.path as "foundation"].label}</Badge>
                    )}
                    <span className="text-muted-foreground">
                      {knowledgeLabel(row.accuracy)} · {row.mastery}%
                    </span>
                  </div>
                </div>
                <Progress value={row.mastery} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="surface-panel border-border/60">
          <CardHeader>
            <CardTitle className="font-display text-xl">Mistake patterns</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {topMistakes.length === 0 && (
              <p className="text-sm text-muted-foreground">No mistakes recorded yet.</p>
            )}
            {topMistakes.map(([type, count]) => (
              <div key={type} className="flex items-center justify-between text-sm">
                <span>{MISTAKE_LABELS[type as MistakeType] ?? type}</span>
                <Badge variant="outline">{count}</Badge>
              </div>
            ))}
            <div className="pt-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Strengths
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {allStrong.length === 0 && <span className="text-sm text-muted-foreground">—</span>}
                {allStrong.map((s) => (
                  <Badge key={s} className="bg-success text-success-foreground">
                    {s}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Needs work
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {allWeak.length === 0 && <span className="text-sm text-muted-foreground">—</span>}
                {allWeak.map((w) => (
                  <Badge key={w} variant="destructive">
                    {w}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 surface-panel border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display text-xl">
            <Sparkles className="size-5 text-primary" /> Recommended next steps
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {data.learner.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Start your first topic to get recommendations.
            </p>
          ) : (
            [...data.learner]
              .sort((a, b) => a.mastery - b.mastery)
              .slice(0, 4)
              .map((row) => (
                <Link
                  key={row.id}
                  to="/learn/$topicSlug"
                  params={{ topicSlug: topicSlug(row.topic_id) }}
                  className="flex items-center justify-between rounded-lg border border-border/70 bg-background/70 px-4 py-3 text-sm transition-colors hover:border-primary"
                >
                  <span>
                    {row.mastery >= 70 ? "Advance in" : "Revise"} {topicName(row.topic_id)}
                    <span className="block text-xs text-muted-foreground">
                      {row.weaknesses.length > 0
                        ? `Focus: ${row.weaknesses.slice(0, 2).join(", ")}`
                        : "Keep the streak going"}
                    </span>
                  </span>
                  <ArrowRight className="size-4 text-primary" />
                </Link>
              ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card className="surface-panel border-border/60">
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {icon} {label}
        </div>
        <p className="mt-2 font-display text-3xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
