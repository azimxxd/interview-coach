export type Role = "Frontend" | "PM";
export type Level = "Junior" | "Mid" | "Senior";
export type Language = "EN";

export type DeliverySignals = {
  wpm: number;
  pauses_sec: number;
  filler_count: number;
  eye_contact_pct: number;
  smile_proxy: number;
  duration_sec?: number;
};

export type InterviewSettings = {
  role: Role;
  level: Level;
  language: Language;
  storeLocal: boolean;
  questionCount: number;
};
