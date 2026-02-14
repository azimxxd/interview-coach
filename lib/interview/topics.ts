import type { InterviewSettings } from "@/lib/types";

const CATEGORY_TOPICS: Record<InterviewSettings["category"], string[]> = {
  Frontend: ["React performance", "Accessibility", "State management"],
  Backend: ["API design", "Data modeling", "Scalability"],
  "Full-stack": ["Architecture", "API contracts", "Delivery tradeoffs"],
  Mobile: ["Offline support", "Rendering performance", "Platform constraints"],
  "DevOps/SRE": ["Reliability", "Observability", "Incident response"],
  "QA/Test Automation": ["Test strategy", "E2E reliability", "Automation ROI"],
  "Data Engineering": ["Pipelines", "Data quality", "Streaming vs batch"],
  "Data Science": ["Experiment design", "Model evaluation", "Business impact"],
  "ML Engineering": ["Model serving", "Monitoring", "MLOps"],
  Cybersecurity: ["Threat modeling", "Auth hardening", "Incident handling"]
};

export function getTopicForStep(settings: InterviewSettings, step: number) {
  const topics = settings.subtopics.length
    ? settings.subtopics
    : CATEGORY_TOPICS[settings.category] ?? CATEGORY_TOPICS.Frontend;
  return topics[step % topics.length];
}
