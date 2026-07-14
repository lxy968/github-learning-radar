export type Difficulty = "beginner" | "intermediate" | "advanced";

export type RefreshInterval = "daily" | "three-days" | "weekly" | "monthly" | "never";

export type RadarCategory =
  | "ai-app"
  | "frontend"
  | "backend"
  | "devtool"
  | "database"
  | "automation"
  | "cli"
  | "fullstack";

export type RepoSignalState = "present" | "absent" | "unknown";

export type RepoEnrichmentSignals = {
  readme: RepoSignalState;
  languages: RepoSignalState;
  rootFiles: RepoSignalState;
  tests: RepoSignalState;
  examples: RepoSignalState;
  ci: RepoSignalState;
  docker: RepoSignalState;
};

export type RepoSnapshot = {
  id: number;
  fullName: string;
  owner: string;
  name: string;
  description: string;
  url: string;
  homepage?: string;
  topics: string[];
  category: RadarCategory;
  primaryLanguage: string;
  languages: Array<{ name: string; bytes: number }>;
  stars: number;
  forks: number;
  openIssues: number;
  license: string | null;
  createdAt: string;
  updatedAt: string;
  pushedAt: string;
  readmeExcerpt: string;
  detectedFiles: string[];
  hasTests: boolean;
  hasExamples: boolean;
  hasCi: boolean;
  hasDocker: boolean;
  enrichment?: RepoEnrichmentSignals;
  dependencies: string[];
  dailyStarDelta: number;
  weeklyStarDelta: number;
  sizeKb: number;
};

export type RuleScore = {
  repoId: number;
  trendScore: number;
  learningValueScore: number;
  cloneabilityScore: number;
  repoHealthScore: number;
  userMatchScore: number;
  finalScore: number;
  reasons: string[];
  risks: string[];
};

export type LearningPlanDay = {
  day: number;
  goal: string;
  tasks: string[];
  deliverable: string;
};

export type LearningPlan = {
  plan3Days: LearningPlanDay[];
  plan7Days: LearningPlanDay[];
  plan14Days: LearningPlanDay[];
};

export type DetailedStudyPlanDuration = 3 | 7 | 14;

export type DetailedStudyStep = {
  id: string;
  title: string;
  purpose: string;
  actions: string[];
  references: string[];
  verification: string;
  deliverable: string;
  estimatedMinutes: number;
};

export type DetailedStudyDay = {
  day: number;
  goal: string;
  outcome: string;
  steps: DetailedStudyStep[];
};

export type DetailedStudyPlan = {
  id: string;
  repoId: number;
  repoFullName: string;
  duration: DetailedStudyPlanDuration;
  source: "ai" | "rule" | "mixed";
  provider?: string;
  modelId?: string;
  fallbackReason?: "not-configured" | "provider-error";
  errorSummary?: string;
  errorCategory?: string;
  retryable?: boolean;
  providerAttempts?: AiProviderAttempt[];
  cache?: DetailedStudyPlanCacheMetadata;
  basedOnPushedAt: string;
  generatedAt: string;
  summary: string;
  prerequisites: string[];
  glossary?: Array<{ term: string; explanation: string }>;
  days: DetailedStudyDay[];
  generatedThroughDay?: number;
  generationStatus?: "partial" | "complete";
};

export type DetailedStudyPlanCacheMetadata = {
  key: string;
  inputHash: string;
  preferenceLevel: Difficulty;
  preferenceGoal: UserPreference["goal"];
  promptVersion: string;
  schemaVersion: string;
  provider: "deepseek" | "rule";
  modelId: string;
};

export type AiProviderAttempt = {
  provider: "deepseek";
  modelId: string;
  status: "success" | "failed";
  errorSummary?: string;
  errorCategory?: string;
  retryable?: boolean;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
};

export type AiAnalysisTrace = {
  source: "ai" | "seed" | "rule";
  fallbackReason?: "not-configured" | "provider-error";
  providerAttempts: AiProviderAttempt[];
};

export type RepoAnalysis = {
  repoId: number;
  projectType: string;
  oneLineSummary: string;
  learningTags: string[];
  difficulty: Difficulty;
  whyLearn: string[];
  miniCloneScope: {
    goal: string;
    coreFeatures: string[];
    excludedFeatures: string[];
  };
  recommendedFor: string[];
  notRecommendedFor: string[];
  risks: string[];
  confidence: number;
  learningPlan: LearningPlan;
};

export type RadarRecommendation = {
  repo: RepoSnapshot;
  score: RuleScore;
  analysis: RepoAnalysis;
  rank: number;
  analysisTrace?: AiAnalysisTrace;
};

export type RadarRun = {
  runId: string;
  date: string;
  source: "seed" | "github";
  status: "success" | "partial" | "failed";
  startedAt: string;
  finishedAt: string;
  rawCandidateCount: number;
  recommendationCount: number;
  notes: string[];
  preference?: UserPreference;
  metrics?: RadarRunMetrics;
  recommendations: RadarRecommendation[];
};

export type RadarRunMetrics = {
  discoveryQueryCount: number;
  discoveryFailureCount: number;
  discoveredCandidateCount: number;
  scoredCandidateCount: number;
  aiRequestedCount: number;
  aiSuccessCount: number;
  aiFallbackCount: number;
  ruleOnlyCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type JobRunStatus = "queued" | "running" | "success" | "partial" | "failed" | "cancelled";

export type JobRunProgress = {
  completed: number;
  total: number;
};

export type JobRun = {
  runId: string;
  idempotencyKey: string;
  jobName: string;
  status: JobRunStatus;
  stage: string | null;
  progress: JobRunProgress;
  attemptCount: number;
  maxAttempts: number;
  payload: Record<string, unknown>;
  summary: Record<string, unknown>;
  errorSummary: string | null;
  errorCategory: string | null;
  createdAt: string;
  availableAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  heartbeatAt: string | null;
  updatedAt: string;
};

export type UserPreference = {
  interests: RadarCategory[];
  languages: string[];
  level: Difficulty;
  goal: "clone" | "portfolio" | "trend" | "source-reading";
  refreshInterval: RefreshInterval;
};

export type FeedbackEventType = "want_to_learn" | "bookmarked" | "skipped" | "too_hard" | "too_easy";

export type FeedbackEvent = {
  id: string;
  userId: string;
  repoId: number;
  eventType: FeedbackEventType;
  value: boolean;
  payload?: Record<string, unknown>;
  createdAt: string;
};

export type RepoInteraction = {
  repoId: number;
  wantToLearn: boolean;
  bookmarked: boolean;
  skipped: boolean;
  tooHard: boolean;
  tooEasy: boolean;
  updatedAt: string | null;
};
