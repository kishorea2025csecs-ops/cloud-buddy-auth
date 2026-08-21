import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BookOpen, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/subjects")({
  head: () => ({
    meta: [
      { title: "Choose a subject — NexLearn AI" },
      {
        name: "description",
        content: "Pick a subject and topic to start an adaptive NexLearn AI learning session.",
      },
      { property: "og:title", content: "Choose a subject — NexLearn AI" },
      {
        property: "og:description",
        content: "Pick a subject and topic to start an adaptive learning session.",
      },
    ],
  }),
  component: SubjectsPage,
});

function SubjectsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["catalogue"],
    queryFn: async () => {
      const [subjects, topics] = await Promise.all([
        supabase.from("subjects").select("*").order("name"),
        supabase.from("topics").select("*").order("name"),
      ]);
      if (subjects.error) throw subjects.error;
      if (topics.error) throw topics.error;
      return { subjects: subjects.data, topics: topics.data };
    },
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <p className="text-sm font-semibold uppercase tracking-wide text-primary">Step 2</p>
      <h1 className="mt-1 font-display text-3xl font-bold">Select subject and topic</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        Choose what you want to learn. NexLearn AI will check what you already know before it
        decides your path.
      </p>

      {isLoading ? (
        <div className="flex justify-center py-24">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {data?.subjects.map((subject) => (
            <Card key={subject.id} className="surface-panel border-border/60">
              <CardHeader>
                <div className="flex items-center gap-2 text-primary">
                  <BookOpen className="size-5" />
                  <Badge variant="secondary">{data.topics.filter((t) => t.subject_id === subject.id).length} topics</Badge>
                </div>
                <CardTitle className="font-display text-xl">{subject.name}</CardTitle>
                <p className="text-sm text-muted-foreground">{subject.description}</p>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.topics
                  .filter((topic) => topic.subject_id === subject.id)
                  .map((topic) => (
                    <Link
                      key={topic.id}
                      to="/learn/$topicSlug"
                      params={{ topicSlug: topic.slug }}
                      className="flex items-center justify-between rounded-lg border border-border/70 bg-background/70 px-3 py-2.5 text-sm font-medium transition-colors hover:border-primary hover:bg-secondary"
                    >
                      <span>
                        {topic.name}
                        <span className="block text-xs font-normal text-muted-foreground">
                          {topic.description}
                        </span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-primary" />
                    </Link>
                  ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
