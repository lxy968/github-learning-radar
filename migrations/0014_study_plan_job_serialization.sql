CREATE UNIQUE INDEX IF NOT EXISTS job_runs_study_plan_active_user_idx
  ON job_runs ((payload ->> 'userId'))
  WHERE job_name = 'detailed-study-plan'
    AND status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS job_runs_study_plan_repo_idx
  ON job_runs ((payload ->> 'repoFullName'), created_at DESC)
  WHERE job_name = 'detailed-study-plan';
