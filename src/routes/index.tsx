import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Brain,
  CloudOff,
  Compass,
  LineChart,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NexLearn AI — Adaptive learning that fits every learner" },
      {
        name: "description",
        content:
          "NexLearn AI checks what you know, picks your path, teaches, quizzes adaptively and gives AI feedback — even offline.",
      },
      { property: "og:title", content: "NexLearn AI — Adaptive learning that fits every learner" },
      {
        property: "og:description",
        content:
          "Assessment, AI decision engine, adaptive quizzes, mistake analysis and a progress dashboard.",
      },
    ],
  }),
  component: Landing,
});

const FLOW = [
  { icon: Compass, title: "Self-level check", body: "Tell us how confident you feel before we start." },
  { icon: Target, title: "Initial assessment", body: "A short diagnostic finds what you already know." },
  { icon: Brain, title: "AI decision engine", body: "Accuracy and pace choose Foundation, Standard or Advanced." },
  { icon: Sparkles, title: "Adaptive session", body: "Lessons written for your exact level and gaps." },
  { icon: CloudOff, title: "Works offline", body: "Answer offline; everything auto-syncs when you reconnect." },
  { icon: MessageSquareText, title: "AI feedback", body: "Mistake analysis, hints and study tips after each quiz." },
];

function Landing() {
  const { user } = useAuth();

  return (
    <div>
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-6xl px-4 py-20 text-center">
          <Badge variant="secondary" className="mb-5">
            Adaptive learning engine
          </Badge>
          <h1 className="mx-auto max-w-3xl font-display text-4xl font-bold leading-tight sm:text-6xl">
            Learning that adjusts to <span className="text-primary">how you actually learn</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg">
            NexLearn AI assesses your level, builds a learner profile, teaches on the right path,
            quizzes you adaptively and explains every mistake — online or offline.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link to={user ? "/subjects" : "/auth"}>
                {user ? "Continue learning" : "Start free with Google"}
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to={user ? "/dashboard" : "/auth"}>
                {user ? "View dashboard" : "Sign in"}
              </Link>
            </Button>
          </div>
          <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" /> Your progress is saved securely to your account
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FLOW.map((item) => (
            <Card key={item.title} className="surface-panel border-border/60">
              <CardContent className="pt-6">
                <item.icon className="size-6 text-primary" />
                <h2 className="mt-3 font-display text-lg font-semibold">{item.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-t border-border/60 bg-secondary/40">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-4 py-14">
          <div>
            <h2 className="flex items-center gap-2 font-display text-2xl font-bold">
              <LineChart className="size-6 text-primary" /> Continuous adaptation
            </h2>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Every answer updates your mastery, streak, strengths and weaknesses, so the next
              session starts exactly where you need it.
            </p>
          </div>
          <Button asChild size="lg">
            <Link to={user ? "/subjects" : "/auth"}>Begin a session</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
