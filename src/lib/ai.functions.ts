import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const LessonInput = z.object({
  subject: z.string().min(1),
  topic: z.string().min(1),
  path: z.enum(["foundation", "standard", "advanced"]),
  weaknesses: z.array(z.string()).max(12).default([]),
});

const GuidanceInput = z.object({
  subject: z.string().min(1),
  topic: z.string().min(1),
  path: z.enum(["foundation", "standard", "advanced"]),
  accuracy: z.number().min(0).max(100),
  avgSeconds: z.number().min(0),
  mistakes: z
    .array(z.object({ concept: z.string(), type: z.string() }))
    .max(20)
    .default([]),
  strengths: z.array(z.string()).max(12).default([]),
});

export const generateLesson = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => LessonInput.parse(input))
  .handler(async ({ data }) => {
    const { callGatewayJson } = await import("./ai.server");
    const result = await callGatewayJson(
      "You are NexLearn AI, a patient tutor for school students in India, including learners with limited connectivity. Write clear, short, plain English.",
      `Create a personalized lesson.
Subject: ${data.subject}
Topic: ${data.topic}
Learning path: ${data.path} (foundation = basics and simple explanations, standard = concepts plus examples, advanced = in-depth and challenging)
Known weak concepts: ${data.weaknesses.length ? data.weaknesses.join(", ") : "none recorded yet"}

JSON shape:
{"intro":"2 sentences","sections":[{"heading":"...","body":"3-5 sentences"}],"examples":["worked example with the steps"],"practice":["practice prompt"]}
Use 3 sections, 2 examples, 3 practice prompts.`,
    );
    return result as {
      intro: string;
      sections: { heading: string; body: string }[];
      examples: string[];
      practice: string[];
    };
  });

export const generateGuidance = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => GuidanceInput.parse(input))
  .handler(async ({ data }) => {
    const { callGatewayJson } = await import("./ai.server");
    const result = await callGatewayJson(
      "You are NexLearn AI, an encouraging tutor. Be specific, warm and never generic. Plain English, short sentences.",
      `Give feedback after a quiz.
Subject: ${data.subject}. Topic: ${data.topic}. Path: ${data.path}.
Accuracy: ${data.accuracy}%. Average time per question: ${data.avgSeconds}s.
Strong concepts: ${data.strengths.join(", ") || "none yet"}.
Mistakes: ${data.mistakes.map((m) => `${m.concept} (${m.type})`).join("; ") || "none"}.

JSON shape:
{"summary":"2-3 sentences on how the learner did","hints":["targeted hint for a specific mistake"],"studyTips":["study tip"],"nextSteps":["what to do next"]}
Give 3 hints, 3 study tips, 3 next steps.`,
    );
    return result as {
      summary: string;
      hints: string[];
      studyTips: string[];
      nextSteps: string[];
    };
  });
