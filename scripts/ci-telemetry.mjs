/**
 * Sends finished workflow runs, or one closed pull request, to Coralogix, so CI health and code
 * review can be followed over time: slow and failing jobs, queue time, re-runs, time to merge, and
 * what happened to each CodeRabbit finding.
 *
 * What a workflow run sends, per attempt (all the runs of a window go out in one batch):
 *
 * - a `workflow_run` log, and a `workflow_job` log for each job, with the failing step and an excerpt
 *   of the log around the first error for a failed job;
 * - a trace: the run, its jobs under it, and their steps under those;
 * - gauges of the run's and each job's duration and queue time.
 *
 * What a pull request sends: a `pull_request` log (size, time to merge, reviews, how its CodeRabbit
 * findings ended) and a `coderabbit_finding` log for each thread CodeRabbit opened.
 *
 * Usage:
 *
 *   node scripts/ci-telemetry.mjs runs [--since=<time>] [--until=<time>]   # every run that finished in the window
 *   node scripts/ci-telemetry.mjs run <run id> [attempt]
 *   node scripts/ci-telemetry.mjs pr <number> [--closed-at=<time> --merged=<true|false>]
 *   node scripts/ci-telemetry.mjs run <run id> --dry-run    # print the counts and the first logs, send nothing
 *
 * `runs` sends each attempt that finished after `--since` up to and including `--until`, once. Unset,
 * `--until` is when the current run (GITHUB_RUN_ID) was created, or now, and `--since` is when the
 * last successful scheduled run of TELEMETRY_WORKFLOW (a workflow file name) was created, at most
 * 24 hours back (runs that finished before that are never sent), or an hour before `--until`. A run that fails sends nothing, so the next one
 * covers its window; that is the only record of what was sent, so a scheduled run must not overlap
 * another (the workflow serializes them). Re-running a successful window by hand with `--since`
 * sends it again.
 *
 * `--closed-at` and `--merged` come from the close event; without them the pull request's current
 * state is used.
 *
 * Environment: GITHUB_TOKEN (actions and pull requests read), CORALOGIX_SEND_DATA_KEY, and
 * optionally CORALOGIX_INGRESS (https://ingress.eu2.coralogix.com when unset) and GITHUB_REPOSITORY.
 *
 * It fails closed: a GitHub request that fails, a page it cannot finish, or data Coralogix rejects
 * exits 1, never a partial send that reads as complete.
 */
import { createHash } from 'node:crypto';

const REPO = process.env.GITHUB_REPOSITORY || 'ng-native/ng-native';
const REPO_URL = `https://github.com/${REPO}`;
const INGRESS = process.env.CORALOGIX_INGRESS || 'https://ingress.eu2.coralogix.com';
const APP = 'ng-native';
const CODERABBIT = 'coderabbitai';

const args = process.argv.slice(2);
const [command, id, ...rest] = args;
const dryRun = args.includes('--dry-run');
const attemptArg = rest.find((arg) => /^\d+$/.test(arg));
const flag = (name) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) || undefined;
const closedAtArg = flag('closed-at');
const mergedArg = flag('merged');

/** The workflows whose runs are sent; the telemetry workflows themselves are left out. */
const WORKFLOWS = new Set([
  'CI',
  'Desktop host',
  'Desktop host nightly',
  'Device tests',
  'Docs',
  'Latest versions',
  'Native builds',
  'Preview',
  'Release',
  'Web Platform Tests',
]);
/** How long before the window a run may have been created and still finish in it. */
const LONGEST_RUN_HOURS = 12;
const MAX_WINDOW_HOURS = 24;
const SLICE_MS = 3_600_000;

async function main() {
  const numeric = /^\d+$/.test(id ?? '');
  if (command === 'runs') await sendRuns();
  else if (command === 'run' && numeric) await sendRun(id, attemptArg);
  else if (command === 'pr' && numeric) await sendPullRequest(Number(id));
  else
    throw new Error(
      'usage: ci-telemetry.mjs runs [--since=<time>] [--until=<time>] | run <run id> [attempt] | pr <number> [--closed-at=<time> --merged=<true|false>] [--dry-run]',
    );
}

// ------------------------------------------------------------------------------ workflow runs

async function sendRun(runId, attemptArg) {
  // The attempt's own record: the run's top-level one is its latest attempt's, which may already
  // be a newer re-run by the time this reads it.
  const run = await github(
    `/repos/${REPO}/actions/runs/${runId}${attemptArg ? `/attempts/${attemptArg}` : ''}`,
  );
  await sendRecords([await buildRecord(run)].filter(Boolean));
}

/** Every attempt that finished in the window, sent as one batch. */
async function sendRuns() {
  const { since, until } = await window();
  console.log(`Runs finished after ${since} up to ${until}`);
  const runs = await completedRuns(
    Date.parse(since) - LONGEST_RUN_HOURS * 3_600_000,
    Date.parse(until),
  );
  const inWindow = (run) =>
    Date.parse(run.updated_at) > Date.parse(since) &&
    Date.parse(run.updated_at) <= Date.parse(until);
  const attempts = [];
  for (const run of runs.filter((run) => WORKFLOWS.has(run.name))) {
    // A re-run's earlier attempts have their own finish times, which the run's record no longer shows.
    for (let attempt = 1; attempt < run.run_attempt; attempt++) {
      const earlier = await github(`/repos/${REPO}/actions/runs/${run.id}/attempts/${attempt}`);
      if (inWindow(earlier)) attempts.push(earlier);
    }
    if (inWindow(run)) attempts.push(run);
  }
  const records = [];
  for (const run of attempts) records.push(await buildRecord(run));
  await sendRecords(records.filter(Boolean));
}

/**
 * The completed runs created from `from` to `to` (milliseconds), listed an hour of creation time at a
 * time so that no list nears the 1000 results the API pages through, however long a window a gap
 * left. A run created on a slice's edge is listed by both slices and kept once.
 */
async function completedRuns(from, to) {
  const byId = new Map();
  for (let start = from; start <= to; start += SLICE_MS) {
    const end = Math.min(start + SLICE_MS, to);
    const range = `${new Date(start).toISOString()}..${new Date(end).toISOString()}`;
    const runs = await githubPages(
      `/repos/${REPO}/actions/runs?status=completed&created=${range}`,
      'workflow_runs',
      1000,
    );
    for (const run of runs) byId.set(run.id, run);
  }
  return [...byId.values()];
}

/**
 * The window to send: the last successful scheduled run's start to this run's start, so a run that
 * failed or never started leaves its window to the next one.
 */
async function window() {
  const runId = process.env.GITHUB_RUN_ID;
  const until =
    flag('until') ??
    (runId
      ? (await github(`/repos/${REPO}/actions/runs/${runId}`)).created_at
      : new Date().toISOString());
  let since = flag('since');
  const workflow = process.env.TELEMETRY_WORKFLOW;
  if (!since && workflow) {
    const { workflow_runs } = await github(
      `/repos/${REPO}/actions/workflows/${workflow}/runs?status=success&event=schedule&per_page=1`,
    );
    since = workflow_runs[0]?.created_at;
  }
  const oldest = new Date(Date.parse(until) - MAX_WINDOW_HOURS * 3_600_000).toISOString();
  if (since && since < oldest && !flag('since'))
    console.warn(`The last send was before ${oldest}; runs that finished before it are not sent.`);
  const fallback = new Date(Date.parse(until) - 3_600_000).toISOString();
  since = !since ? fallback : since < oldest && !flag('since') ? oldest : since;
  return { since, until };
}

/** One attempt's logs, spans and gauges, or undefined when it has no finished jobs. */
async function buildRecord(run) {
  const runId = run.id;
  const attempt = run.run_attempt;
  const jobs = ranInAttempt(
    await githubPages(`/repos/${REPO}/actions/runs/${runId}/attempts/${attempt}/jobs`, 'jobs'),
    attempt,
  );
  if (!jobs.length) {
    console.log(`Run ${runId} attempt ${attempt} has no finished jobs, nothing to send.`);
    return undefined;
  }
  const record = runRecord(run, jobs);
  for (const job of jobs) await addJob(record, job);
  record.points = record.points.filter(([, , , value]) => value !== undefined);
  console.log(
    `${run.name} #${runId} attempt ${attempt}: ${record.logs.length} logs, ${record.spans.length} spans, ${record.points.length} metric points`,
  );
  return record;
}

async function sendRecords(records) {
  const logs = records.flatMap((record) => record.logs);
  const points = records.flatMap((record) => record.points);
  const spans = Object.groupBy(
    records.flatMap((record) =>
      record.spans.map((span) => ({ ...span, workflow: record.run.name })),
    ),
    (span) => serviceName(span.workflow),
  );
  const spanCount = records.reduce((total, record) => total + record.spans.length, 0);
  console.log(
    `${records.length} runs: ${logs.length} logs, ${spanCount} spans, ${points.length} metric points`,
  );
  if (dryRun || !records.length) return dryRun && printSample(logs);
  await sendLogs(logs);
  for (const [service, group] of Object.entries(spans))
    await sendOtlp(
      '/v1/traces',
      encodeTraces(service, group),
      `${group.length} spans for ${service}`,
    );
  await sendOtlp('/v1/metrics', encodeMetrics(points), `${points.length} metric points`);
}

/**
 * The finished jobs that ran in this attempt. A re-run also lists the jobs it carried over from the
 * attempt before, created again but started back then; those were sent with that attempt and would
 * stretch this one back to its start.
 */
function ranInAttempt(jobs, attempt) {
  return jobs.filter(
    (job) =>
      job.started_at &&
      job.completed_at &&
      !(attempt > 1 && Date.parse(job.started_at) < Date.parse(job.created_at)),
  );
}

/** The run's log, root span and gauges, which each job then adds its own to. */
function runRecord(run, jobs) {
  const attempt = run.run_attempt;
  const start = earliest(jobs.map((job) => job.started_at));
  const end = latest(jobs.map((job) => job.completed_at));
  const queued = earliest(jobs.map((job) => job.created_at ?? job.started_at));
  const failed = jobs.filter((job) => job.conclusion === 'failure').length;
  const conclusion = run.conclusion ?? (failed ? 'failure' : 'cancelled');
  const url = `${REPO_URL}/actions/runs/${run.id}/attempts/${attempt}`;
  const actor = run.triggering_actor?.login ?? run.actor?.login;
  const common = {
    repo: REPO,
    workflow: run.name,
    run_id: run.id,
    run_attempt: attempt,
    branch: run.head_branch,
    trigger: run.event,
    actor,
    url,
  };
  const traceId = digest(`run-${run.id}-${attempt}`, 16);
  const rootId = digest(`root-${run.id}-${attempt}`, 8);
  return {
    run,
    common,
    traceId,
    rootId,
    logs: [
      {
        time: end,
        severity: severityFor(conclusion),
        subsystem: 'ci',
        body: {
          event: 'workflow_run',
          message: `${run.name} ${conclusion} on ${run.head_branch} in ${minutes(start, end)} min`,
          conclusion,
          duration_min: minutes(start, end),
          queue_min: minutes(queued, start),
          jobs_total: jobs.length,
          jobs_failed: failed,
          is_rerun: attempt > 1,
          ...common,
        },
      },
    ],
    spans: [
      {
        traceId,
        spanId: rootId,
        name: run.name,
        start,
        end,
        error: conclusion === 'failure',
        attrs: {
          'ci.workflow': run.name,
          'ci.run_id': String(run.id),
          'ci.run_attempt': attempt,
          'ci.branch': run.head_branch,
          'ci.trigger': run.event,
          'ci.conclusion': conclusion,
          'ci.actor': actor,
          'ci.url': url,
        },
      },
    ],
    points: [
      [
        'ci_run_duration_minutes',
        { workflow: run.name, conclusion, branch: run.head_branch },
        end,
        minutes(start, end),
      ],
      ['ci_run_queue_minutes', { workflow: run.name }, end, minutes(queued, start)],
    ],
  };
}

async function addJob(record, job) {
  const { run, common } = record;
  const runner = (job.labels ?? []).join(',') || 'unknown';
  const body = {
    event: 'workflow_job',
    job: job.name,
    job_id: job.id,
    conclusion: job.conclusion,
    duration_min: minutes(job.started_at, job.completed_at),
    queue_min: minutes(job.created_at, job.started_at),
    runner,
    failed_step: job.steps?.find((step) => step.conclusion === 'failure')?.name,
    ...common,
    url: `${REPO_URL}/actions/runs/${run.id}/job/${job.id}`,
    message: `${run.name} › ${job.name} ${job.conclusion} in ${minutes(job.started_at, job.completed_at)} min`,
  };
  if (job.conclusion === 'failure') {
    const { summary, excerpt } = failureExcerpt(await jobLog(job.id));
    Object.assign(body, {
      error: summary,
      log_excerpt: excerpt,
      message: `${run.name} › ${job.name} failed${summary ? `: ${summary}` : ''}`,
    });
  }
  record.logs.push({
    time: job.completed_at,
    severity: severityFor(job.conclusion),
    subsystem: 'ci',
    body,
  });
  record.points.push(
    [
      'ci_job_duration_minutes',
      { workflow: run.name, job: job.name, runner, conclusion: job.conclusion },
      job.completed_at,
      body.duration_min,
    ],
    [
      'ci_job_queue_wait_minutes',
      { workflow: run.name, job: job.name, runner },
      job.completed_at,
      body.queue_min,
    ],
  );

  const jobSpan = digest(`job-${job.id}`, 8);
  record.spans.push(
    {
      traceId: record.traceId,
      spanId: jobSpan,
      parent: record.rootId,
      name: job.name,
      start: job.started_at,
      end: job.completed_at,
      error: job.conclusion === 'failure',
      attrs: {
        'ci.job': job.name,
        'ci.job_id': String(job.id),
        'ci.runner': runner,
        'ci.conclusion': job.conclusion ?? '',
        'ci.workflow': run.name,
      },
    },
    ...stepSpans(record, job, jobSpan),
  );
}

function stepSpans(record, job, jobSpan) {
  return (job.steps ?? [])
    .filter(
      (step) =>
        step.started_at &&
        step.completed_at &&
        step.conclusion !== 'skipped' &&
        Date.parse(step.completed_at) >= Date.parse(step.started_at),
    )
    .map((step) => ({
      traceId: record.traceId,
      spanId: digest(`step-${job.id}-${step.number}`, 8),
      parent: jobSpan,
      name: step.name,
      start: step.started_at,
      end: step.completed_at,
      error: step.conclusion === 'failure',
      attrs: {
        'ci.step': step.name,
        'ci.job': job.name,
        'ci.workflow': record.run.name,
        'ci.conclusion': step.conclusion ?? '',
      },
    }));
}

function serviceName(workflow) {
  return `ng-native-${workflow
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;
}

function severityFor(conclusion) {
  return { failure: 5, timed_out: 5, cancelled: 4 }[conclusion] ?? 3;
}

/** The log of a job, or undefined once GitHub no longer has it. */
async function jobLog(jobId) {
  const response = await fetch(`https://api.github.com/repos/${REPO}/actions/jobs/${jobId}/logs`, {
    headers: githubHeaders(),
  });
  if (response.status === 404 || response.status === 410) return undefined;
  if (!response.ok) throw new Error(`GitHub job ${jobId} log: HTTP ${response.status}`);
  return response.text();
}

const ERROR_PATTERNS = [
  /AssertionError.*/,
  /error TS\d+.*/,
  /FAIL .*/,
  /Error: .*/,
  /✗ .*/,
  /✖ .*/,
  /##\[error\](.*)/,
];

/**
 * How much of the error line an excerpt keeps: one line of serialized output can run to many
 * kilobytes, past what Coralogix parses in a single log.
 */
const MAX_ERROR_LINE = 1000;

/**
 * The earliest error in a job log, and the lines leading up to it rather than the cleanup that ends
 * every log: at most 2,000 characters before, the error line, and 1,000 after.
 */
function failureExcerpt(log) {
  if (!log) return {};
  const text = log
    .split('\n')
    .map((line) => line.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, '').replace(/\x1b\[[0-9;]*m/g, ''))
    .filter((line) => line.trim() && !/^##\[(group|endgroup)\]/.test(line))
    .join('\n');
  const matches = ERROR_PATTERNS.map((pattern) => pattern.exec(text)).filter(Boolean);
  if (!matches.length) return { excerpt: text.slice(-3000) };
  const match = matches.reduce((first, next) => (next.index < first.index ? next : first));
  const lineEnd = match.index + Math.min(match[0].length, MAX_ERROR_LINE);
  return {
    summary: (match[1] ?? match[0]).trim().slice(0, 300),
    excerpt:
      text.slice(Math.max(0, match.index - 2000), lineEnd) +
      text.slice(match.index + match[0].length, match.index + match[0].length + 1000),
  };
}

// ------------------------------------------------------------------------------ pull requests

const PR_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number title state isDraft createdAt mergedAt closedAt additions deletions changedFiles
      author { login }
      labels(first: 100) { totalCount nodes { name } }
      commits { totalCount }
      reviews(first: 100) { totalCount nodes { author { login } state submittedAt } }
      reviewThreads(first: 100) {
        totalCount
        nodes {
          isResolved isOutdated path
          comments(first: 100) { totalCount nodes { author { login } createdAt body } }
        }
      }
    }
  }
}`;

const SEVERITIES = ['Critical', 'Major', 'Minor', 'Trivial'];
const CATEGORY =
  /(Functional Correctness|Stability & Availability|Data Integrity & Integration|Maintainability & Code Quality|Performance & Scalability|Security & Privacy|Accessibility)/;

async function sendPullRequest(number) {
  const pr = await fetchPullRequest(number);
  const author = pr.author?.login ?? 'ghost';
  const threads = pr.reviewThreads.nodes.filter(
    (thread) => thread.comments.nodes[0]?.author?.login === CODERABBIT,
  );
  const findings = threads.map((thread) => findingLog(pr, thread, author));
  const logs = [...findings, pullRequestLog(pr, author, findings)];
  console.log(`PR #${number}: ${logs.length} logs (${threads.length} CodeRabbit findings)`);
  if (dryRun) return printSample(logs);
  await sendLogs(logs);
}

/** The pull request, failing on any GraphQL error and on any list it could not read in full. */
async function fetchPullRequest(number) {
  const [owner, name] = REPO.split('/');
  const data = await github('/graphql', { query: PR_QUERY, variables: { owner, name, number } });
  if (data.errors?.length)
    throw new Error(`GitHub #${number}: ${JSON.stringify(data.errors).slice(0, 300)}`);
  const pr = data.data?.repository?.pullRequest;
  if (!pr) throw new Error(`GitHub: no pull request #${number}`);
  const lists = [
    pr.labels,
    pr.reviews,
    pr.reviewThreads,
    ...pr.reviewThreads.nodes.map((thread) => thread.comments),
  ];
  if (lists.some((list) => list.nodes.length < list.totalCount)) {
    throw new Error(
      `#${number} has more than 100 labels, reviews, threads or replies in a thread; this script reads only the first page.`,
    );
  }
  return pr;
}

function findingLog(pr, thread, author) {
  const first = thread.comments.nodes[0];
  const finding = classifyFinding(first.body, thread, author);
  return {
    time: first.createdAt,
    severity: { Critical: 5, Major: 4 }[finding.severity] ?? 3,
    subsystem: 'code-review',
    body: {
      event: 'coderabbit_finding',
      message: `CodeRabbit ${finding.severity.toLowerCase()}: ${finding.title}`,
      pr: pr.number,
      pr_title: pr.title,
      pr_author: author,
      path: thread.path ?? '',
      area: (thread.path ?? '').split('/').slice(0, 2).join('/'),
      repo: REPO,
      url: `${REPO_URL}/pull/${pr.number}`,
      ...finding,
    },
  };
}

function pullRequestLog(pr, author, findings) {
  const { state, time } = closedState(pr);
  const reviews = pr.reviews.nodes.filter((review) => review.submittedAt);
  const coderabbit = reviews.filter((review) => review.author?.login === CODERABBIT);
  const humans = [...new Set(reviews.map((review) => review.author?.login))]
    .filter((login) => login && login !== CODERABBIT && login !== author)
    .sort();
  const lastState = coderabbit.at(-1)?.state;
  const mergedWithChangesRequested = state === 'MERGED' && lastState === 'CHANGES_REQUESTED';
  const outcomes = Object.groupBy(findings, (finding) => finding.body.outcome);
  const count = (outcome) => outcomes[outcome]?.length ?? 0;
  return {
    time,
    severity: mergedWithChangesRequested ? 4 : 3,
    subsystem: 'pull-requests',
    body: {
      event: 'pull_request',
      message: `PR #${pr.number} ${state.toLowerCase()}: ${pr.title}`,
      pr: pr.number,
      title: pr.title,
      state,
      author,
      is_draft: pr.isDraft,
      labels: pr.labels.nodes.map((label) => label.name),
      additions: pr.additions,
      deletions: pr.deletions,
      lines_changed: pr.additions + pr.deletions,
      files_changed: pr.changedFiles,
      commits: pr.commits.totalCount,
      hours_to_merge:
        state === 'MERGED'
          ? round((Date.parse(time) - Date.parse(pr.createdAt)) / 3_600_000)
          : undefined,
      minutes_to_first_coderabbit_review: coderabbit.length
        ? minutes(pr.createdAt, earliest(coderabbit.map((review) => review.submittedAt)))
        : undefined,
      coderabbit_reviews: coderabbit.length,
      coderabbit_change_requests: coderabbit.filter(
        (review) => review.state === 'CHANGES_REQUESTED',
      ).length,
      coderabbit_last_state: lastState,
      coderabbit_findings: findings.length,
      findings_fixed: count('fixed') + count('fixed (inferred)'),
      findings_dismissed: count('dismissed'),
      findings_unresolved: count('open'),
      human_reviewers: humans,
      human_reviews: humans.length,
      merged_with_changes_requested: mergedWithChangesRequested,
      repo: REPO,
      url: `${REPO_URL}/pull/${pr.number}`,
    },
  };
}

/**
 * Whether the pull request merged, and when it closed: from the close event when the workflow
 * passes it, since the pull request may have been reopened since; from GitHub's current state when
 * run by hand.
 */
function closedState(pr) {
  if (closedAtArg) return { state: mergedArg === 'true' ? 'MERGED' : 'CLOSED', time: closedAtArg };
  return { state: pr.state, time: pr.mergedAt ?? pr.closedAt ?? pr.createdAt };
}

/** A CodeRabbit thread's severity, category and title from its first comment, and how it ended. */
function classifyFinding(body, thread, author) {
  const plain = body.replace(/<[^>]+>/g, '');
  const head = plain.split('\n').slice(0, 4).join(' ');
  const replies = thread.comments.nodes
    .slice(1)
    .filter((comment) => comment.author?.login === author)
    .map((comment) => comment.body)
    .join(' ')
    .toLowerCase();
  return {
    severity: SEVERITIES.find((label) => new RegExp(`\\b${label}\\b`).test(head)) ?? 'Unlabelled',
    category: CATEGORY.exec(head)?.[1] ?? 'Other',
    effort: ['Heavy lift', 'Quick win'].find((label) => head.includes(label)),
    title: findingTitle(plain),
    outcome: findingOutcome(body, thread, replies),
    author_replied: Boolean(replies),
  };
}

function findingTitle(plain) {
  const labels =
    /Potential issue|Minor|Major|Critical|Quick win|Heavy lift|Correctness|Availability|Integrity|Maintainability|Performance|Security/;
  const bold = [...plain.matchAll(/\*\*([^*\n]{8,200})\*\*/g)].map((match) => match[1]);
  return (bold.find((text) => !labels.test(text)) ?? '').trim();
}

/** "Fixed in abc123" counts as a fix; "not fixed in this PR" does not. */
const FIXED_REPLY = /(?<!\bnot |\bnever |n't )\b(?:fixed|done) in\b/;
const DISMISSED_REPLY =
  /won't|will not|not (going to|changing)|intentional|by design|out of scope|disagree|not a bug|false positive/;

function findingOutcome(body, thread, replies) {
  if (body.toLowerCase().includes('addressed in commit') || FIXED_REPLY.test(replies))
    return 'fixed';
  if (DISMISSED_REPLY.test(replies)) return 'dismissed';
  if (thread.isResolved && thread.isOutdated) return 'fixed (inferred)';
  if (thread.isResolved) return 'resolved without change';
  return 'open';
}

// ------------------------------------------------------------------------------ GitHub

function githubHeaders() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is not set.');
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function github(path, body) {
  const response = await fetch(`https://api.github.com${path}`, {
    method: body ? 'POST' : 'GET',
    headers: githubHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok)
    throw new Error(
      `GitHub ${path}: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`,
    );
  return response.json();
}

/** Every page of a list endpoint, checked against the total GitHub reports. */
async function githubPages(path, key, cap = Infinity) {
  const items = [];
  for (let page = 1; ; page++) {
    const data = await github(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (data.total_count > cap)
      throw new Error(
        `GitHub ${path}: ${data.total_count} results, more than the ${cap} it can page through`,
      );
    items.push(...data[key]);
    if (items.length >= data.total_count || !data[key].length) {
      if (items.length < data.total_count)
        throw new Error(`GitHub ${path}: read ${items.length} of ${data.total_count}`);
      return items;
    }
  }
}

// ------------------------------------------------------------------------------ Coralogix

function sendKey() {
  const key = process.env.CORALOGIX_SEND_DATA_KEY;
  if (!key) throw new Error('CORALOGIX_SEND_DATA_KEY is not set.');
  return key;
}

async function sendLogs(logs) {
  const entries = logs.map((log) => ({
    applicationName: APP,
    subsystemName: log.subsystem,
    computerName: 'github-actions',
    severity: log.severity,
    timestamp: Date.parse(log.time),
    text: JSON.stringify(log.body, (_key, value) => (value === null ? undefined : value)),
  }));
  for (let i = 0; i < entries.length; i += 500) {
    const response = await fetch(`${INGRESS}/logs/v1/singles`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sendKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(entries.slice(i, i + 500)),
    });
    if (!response.ok)
      throw new Error(
        `Coralogix logs: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`,
      );
  }
  console.log(`  ${entries.length} logs sent`);
}

async function sendOtlp(path, payload, label) {
  const response = await fetch(`${INGRESS}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sendKey()}`, 'Content-Type': 'application/x-protobuf' },
    body: payload,
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!response.ok)
    throw new Error(
      `Coralogix ${path}: HTTP ${response.status} ${new TextDecoder().decode(bytes).slice(0, 300)}`,
    );
  const { rejected, message } = partialSuccess(bytes);
  if (rejected) throw new Error(`Coralogix ${path}: ${rejected} rejected: ${message}`);
  console.log(`  ${label} sent`);
}

// ------------------------------------------------------------------------------ OTLP protobuf

// Hand-encoded so the workflow needs no install: only the few OTLP messages sent here.

function encodeTraces(service, spans) {
  const encoded = spans.map((span) =>
    bytesField(
      2,
      concat(
        bytesField(1, span.traceId),
        bytesField(2, span.spanId),
        span.parent ? bytesField(4, span.parent) : empty,
        stringField(5, span.name),
        varintField(6, 1),
        fixed64Field(7, nanos(span.start)),
        fixed64Field(8, nanos(span.end)),
        ...Object.entries(span.attrs)
          .filter(([, value]) => value !== undefined && value !== null)
          .map(([key, value]) => bytesField(9, keyValue(key, value))),
        bytesField(15, varintField(3, span.error ? 2 : 1)),
      ),
    ),
  );
  const scopeSpans = concat(bytesField(1, stringField(1, 'ng-native-ci-telemetry')), ...encoded);
  return bytesField(1, concat(bytesField(1, resource(service, 'ci')), bytesField(2, scopeSpans)));
}

function encodeMetrics(points) {
  const byName = new Map();
  for (const [name, labels, when, value] of points) {
    if (!byName.has(name)) byName.set(name, []);
    byName
      .get(name)
      .push(
        bytesField(
          1,
          concat(
            ...Object.entries(labels).map(([key, label]) =>
              bytesField(7, keyValue(key, label ?? '')),
            ),
            fixed64Field(3, nanos(when)),
            doubleField(4, value),
          ),
        ),
      );
  }
  const metrics = [...byName].map(([name, dataPoints]) =>
    bytesField(2, concat(stringField(1, name), bytesField(5, concat(...dataPoints)))),
  );
  const scope = concat(bytesField(1, stringField(1, 'ng-native-ci-telemetry')), ...metrics);
  return bytesField(
    1,
    concat(bytesField(1, resource('ng-native-ci', 'metrics')), bytesField(2, scope)),
  );
}

function resource(service, subsystem) {
  const attrs = {
    'service.name': service,
    'cx.application.name': APP,
    'cx.subsystem.name': subsystem,
  };
  return concat(
    ...Object.entries(attrs).map(([key, value]) => bytesField(1, keyValue(key, value))),
  );
}

function keyValue(key, value) {
  let any;
  if (typeof value === 'boolean') any = varintField(2, value ? 1 : 0, true);
  else if (Number.isInteger(value)) any = varintField(3, value, true);
  else if (typeof value === 'number') any = doubleField(4, value);
  else any = stringField(1, String(value), true);
  return concat(stringField(1, key), bytesField(2, any));
}

/** ExportTraceServiceResponse / ExportMetricsServiceResponse field 1, partial_success: (rejected, message). */
function partialSuccess(bytes) {
  const reader = new Reader(bytes);
  for (let tag; (tag = reader.tag());) {
    if (tag.field === 1 && tag.wire === 2) {
      const inner = new Reader(reader.bytes());
      let rejected = 0;
      let message = '';
      for (let t; (t = inner.tag());) {
        if (t.field === 1 && t.wire === 0) rejected = Number(inner.varint());
        else if (t.field === 2 && t.wire === 2) message = new TextDecoder().decode(inner.bytes());
        else inner.skip(t.wire);
      }
      return { rejected, message };
    }
    reader.skip(tag.wire);
  }
  return { rejected: 0, message: '' };
}

class Reader {
  #bytes;
  #at = 0;
  constructor(bytes) {
    this.#bytes = bytes;
  }
  tag() {
    if (this.#at >= this.#bytes.length) return undefined;
    const key = Number(this.varint());
    return { field: key >> 3, wire: key & 7 };
  }
  varint() {
    let result = 0n;
    for (let shift = 0n; this.#at < this.#bytes.length; shift += 7n) {
      const byte = this.#bytes[this.#at++];
      result |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) return result;
    }
    throw new Error('Truncated protobuf varint');
  }
  bytes() {
    const length = Number(this.varint());
    const out = this.#bytes.subarray(this.#at, this.#at + length);
    this.#at += length;
    return out;
  }
  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.#at += 8;
    else if (wire === 2) this.bytes();
    else if (wire === 5) this.#at += 4;
    else throw new Error(`Unknown protobuf wire type ${wire}`);
  }
}

const empty = new Uint8Array();
const encoder = new TextEncoder();

function varint(value) {
  let v = BigInt.asUintN(64, BigInt(value));
  const out = [];
  while (v >= 0x80n) {
    out.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  out.push(Number(v));
  return Uint8Array.from(out);
}

function tag(field, wire) {
  return varint((field << 3) | wire);
}

function bytesField(field, bytes) {
  return concat(tag(field, 2), varint(bytes.length), bytes);
}

function stringField(field, text, keepEmpty = false) {
  return text || keepEmpty ? bytesField(field, encoder.encode(text)) : empty;
}

function varintField(field, value, keepZero = false) {
  return value || keepZero ? concat(tag(field, 0), varint(value)) : empty;
}

function fixed64Field(field, value) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return concat(tag(field, 1), out);
}

function doubleField(field, value) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, value, true);
  return concat(tag(field, 1), out);
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// ------------------------------------------------------------------------------ helpers

function nanos(time) {
  return BigInt(Date.parse(time)) * 1_000_000n;
}

function minutes(from, to) {
  if (!from || !to) return undefined;
  const ms = Date.parse(to) - Date.parse(from);
  return ms >= 0 ? round(ms / 60_000) : undefined;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function earliest(times) {
  return times.reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a));
}

function latest(times) {
  return times.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));
}

function digest(text, length) {
  return new Uint8Array(createHash('sha256').update(text).digest().subarray(0, length));
}

function printSample(logs) {
  for (const log of logs.slice(0, 3))
    console.log(
      JSON.stringify({
        ...log,
        body: { ...log.body, log_excerpt: log.body.log_excerpt?.slice(0, 200) },
      }),
    );
}

// Last, so every constant above is initialised before main reads it.
await main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
