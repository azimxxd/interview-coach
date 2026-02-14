export const INTERVIEW_CATEGORIES = [
  "Frontend",
  "Backend",
  "Full-stack",
  "Mobile",
  "DevOps/SRE",
  "QA/Test Automation",
  "Data Engineering",
  "Data Science",
  "ML Engineering",
  "Cybersecurity"
] as const;

export const INTERVIEW_TYPES = [
  "Behavioral (STAR)",
  "Technical Q&A",
  "System Design",
  "Debugging"
] as const;

export type InterviewCategory = (typeof INTERVIEW_CATEGORIES)[number];
export type InterviewType = (typeof INTERVIEW_TYPES)[number];

export const CATEGORY_SUBTOPICS: Record<InterviewCategory, string[]> = {
  Frontend: ["React", "TypeScript", "CSS", "Performance", "A11y", "Testing"],
  Backend: ["APIs", "Databases", "Caching", "Scalability", "Security", "Observability"],
  "Full-stack": ["Architecture", "API Design", "Data Modeling", "Deployment", "Testing", "Performance"],
  Mobile: ["React Native", "iOS", "Android", "Offline Sync", "Performance", "App Store"],
  "DevOps/SRE": ["CI/CD", "Kubernetes", "Terraform", "Reliability", "Monitoring", "Incident Response"],
  "QA/Test Automation": ["Test Strategy", "E2E", "Unit Testing", "API Testing", "Flaky Tests", "Tooling"],
  "Data Engineering": ["ETL", "Batch", "Streaming", "Data Modeling", "Orchestration", "Data Quality"],
  "Data Science": ["Experiment Design", "Statistics", "Feature Engineering", "Model Selection", "Evaluation", "Storytelling"],
  "ML Engineering": ["MLOps", "Serving", "Feature Store", "Monitoring", "A/B Testing", "Latency"],
  Cybersecurity: ["Threat Modeling", "Auth", "Encryption", "AppSec", "Cloud Security", "Incident Handling"]
};

export function mapLegacyRoleToCategory(role?: string): InterviewCategory {
  if (role === "Frontend") return "Frontend";
  if (role === "PM") return "Full-stack";
  if (role && INTERVIEW_CATEGORIES.includes(role as InterviewCategory)) {
    return role as InterviewCategory;
  }
  return "Frontend";
}

export function normalizeSubtopics(category: InterviewCategory, subtopics: string[] = []) {
  const allowed = new Set(CATEGORY_SUBTOPICS[category]);
  const deduped = Array.from(new Set(subtopics.map((item) => item.trim()).filter(Boolean)));
  const filtered = deduped.filter((item) => allowed.has(item));
  return filtered.slice(0, 8);
}

export function estimateDurationRange(questionCount: number, interviewType: InterviewType) {
  const safeCount = Math.max(1, Math.min(20, questionCount));
  const perQuestionMinutes =
    interviewType === "Behavioral (STAR)"
      ? { min: 3.2, max: 4.4 }
      : interviewType === "System Design"
        ? { min: 4.2, max: 5.8 }
        : interviewType === "Debugging"
          ? { min: 3.5, max: 4.8 }
          : { min: 2.8, max: 4.1 };

  const minMinutes = Math.round(safeCount * perQuestionMinutes.min);
  const maxMinutes = Math.round(safeCount * perQuestionMinutes.max);

  return {
    minMinutes,
    maxMinutes,
    label: `~${minMinutes}-${maxMinutes} min`
  };
}
