/**
 * Sends one finished workflow run, or one closed pull request, to Coralogix, so CI health and code
 * review can be followed over time: slow and failing jobs, queue time, re-runs, time to merge, and
 * what happened to each CodeRabbit finding.
 *
 * What a workflow run sends, per attempt:
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
 *   node scripts/ci-telemetry.mjs run <run id> [attempt]
 *   node scripts/ci-telemetry.mjs pr <number>
 *   node scripts/ci-telemetry.mjs run <run id> --dry-run    # print what it would send
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

const [command, id, ...rest] = process.argv.slice(2);
const dryRun = rest.includes('--dry-run');
const attemptArg = rest.find((arg) => /^\d+$/.test(arg));

async function main() {
  if (command === 'run' && /^\d+$/.test(id ?? ''))
    await sendRun(id, attemptArg ? Number(attemptArg) : undefined);
  else if (command === 'pr' && /^\d+$/.test(id ?? '')) await sendPullRequest(Number(id));
  else throw new Error('usage: ci-telemetry.mjs run <run id> [attempt] | pr <number> [--dry-run]');
}

// ------------------------------------------------------------------------------ workflow runs

async function sendRun(runId, attemptOverride) {
  const run = await github(`/repos/${REPO}/actions/runs/${runId}`);
  const attempt = attemptOverride ?? run.run_attempt;
  const jobs = await githubPages(
    `/repos/${REPO}/actions/runs/${runId}/attempts/${attempt}/jobs`,
    'jobs',
  );
  // A re-run lists the jobs it carried over from the attempt before, created again but started back
  // then; those were sent with that attempt and would stretch this one back to its start.
  const finished = jobs.filter(
    (job) =>
      job.started_at &&
      job.completed_at &&
      !(attempt > 1 && Date.parse(job.started_at) < Date.parse(job.created_at)),
  );
  if (!finished.length) {
    console.log(`Run ${runId} attempt ${attempt} has no finished jobs, nothing to send.`);
    return;
  }

  const start = earliest(finished.map((job) => job.started_at));
  const end = latest(finished.map((job) => job.completed_at));
  const queued = earliest(finished.map((job) => job.created_at ?? job.started_at));
  const failedJobs = finished.filter((job) => job.conclusion === 'failure');
  // The run's conclusion is its latest attempt's; an earlier attempt's is read from its jobs.
  const conclusion =
    attempt === run.run_attempt && run.conclusion
      ? run.conclusion
      : failedJobs.length
        ? 'failure'
        : 'cancelled';
  const url = `${REPO_URL}/actions/runs/${runId}/attempts/${attempt}`;
  const common = {
    repo: REPO,
    workflow: run.name,
    run_id: run.id,
    run_attempt: attempt,
    branch: run.head_branch,
    trigger: run.event,
    actor: run.triggering_actor?.login ?? run.actor?.login,
    url,
  };

  const logs = [
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
        jobs_total: finished.length,
        jobs_failed: failedJobs.length,
        is_rerun: attempt > 1,
        ...common,
      },
    },
  ];

  const traceId = digest(`run-${runId}-${attempt}`, 16);
  const rootId = digest(`root-${runId}-${attempt}`, 8);
  const spans = [
    {
      traceId,
      spanId: rootId,
      name: run.name,
      start,
      end,
      error: conclusion === 'failure',
      attrs: {
        'ci.workflow': run.name,
        'ci.run_id': String(runId),
        'ci.run_attempt': attempt,
        'ci.branch': run.head_branch,
        'ci.trigger': run.event,
        'ci.conclusion': conclusion,
        'ci.actor': common.actor,
        'ci.url': url,
      },
    },
  ];
  const points = [
    [
      'ci_run_duration_minutes',
      { workflow: run.name, conclusion, branch: run.head_branch },
      end,
      minutes(start, end),
    ],
    ['ci_run_queue_minutes', { workflow: run.name }, end, minutes(queued, start)],
  ];

  for (const job of finished) {
    const runner = (job.labels ?? []).join(',') || 'unknown';
    const failedStep = job.steps?.find((step) => step.conclusion === 'failure')?.name;
    const body = {
      event: 'workflow_job',
      job: job.name,
      job_id: job.id,
      conclusion: job.conclusion,
      duration_min: minutes(job.started_at, job.completed_at),
      queue_min: minutes(job.created_at, job.started_at),
      runner,
      failed_step: failedStep,
      ...common,
      url: `${REPO_URL}/actions/runs/${runId}/job/${job.id}`,
    };
    if (job.conclusion === 'failure') {
      const { summary, excerpt } = failureExcerpt(await jobLog(job.id));
      Object.assign(body, { error: summary, log_excerpt: excerpt });
      body.message = `${run.name} › ${job.name} failed${summary ? `: ${summary}` : ''}`;
    } else {
      body.message = `${run.name} › ${job.name} ${job.conclusion} in ${body.duration_min} min`;
    }
    logs.push({
      time: job.completed_at,
      severity: severityFor(job.conclusion),
      subsystem: 'ci',
      body,
    });
    points.push(
      [
        'ci_job_duration_minutes',
        { workflow: run.name, job: job.name, runner, conclusion: job.conclusion },
        job.completed_at,
        body.duration_min,
      ],
      [
        'ci_job_queue_wait_minutes',
        { workflow: run.name, runner },
        job.completed_at,
        body.queue_min,
      ],
    );

    const jobSpan = digest(`job-${job.id}`, 8);
    spans.push({
      traceId,
      spanId: jobSpan,
      parent: rootId,
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
    });
    for (const step of job.steps ?? []) {
      if (!step.started_at || !step.completed_at || step.conclusion === 'skipped') continue;
      if (Date.parse(step.completed_at) < Date.parse(step.started_at)) continue;
      spans.push({
        traceId,
        spanId: digest(`step-${job.id}-${step.number}`, 8),
        parent: jobSpan,
        name: step.name,
        start: step.started_at,
        end: step.completed_at,
        error: step.conclusion === 'failure',
        attrs: {
          'ci.step': step.name,
          'ci.job': job.name,
          'ci.workflow': run.name,
          'ci.conclusion': step.conclusion ?? '',
        },
      });
    }
  }

  const service = `ng-native-${run.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;
  const metricPoints = points.filter(([, , , value]) => value !== undefined);
  console.log(
    `${run.name} #${runId} attempt ${attempt}: ${logs.length} logs, ${spans.length} spans, ${metricPoints.length} metric points`,
  );
  if (dryRun) return printSample(logs);
  await sendLogs(logs);
  await sendOtlp('/v1/traces', encodeTraces(service, spans), `${spans.length} spans`);
  await sendOtlp(
    '/v1/metrics',
    encodeMetrics(metricPoints),
    `${metricPoints.length} metric points`,
  );
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
];

/** The first error in a job log, and the lines leading up to it rather than the cleanup that ends every log. */
function failureExcerpt(log) {
  if (!log) return {};
  const text = log
    .split('\n')
    .map((line) => line.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, '').replace(/\x1b\[[0-9;]*m/g, ''))
    .filter((line) => line.trim() && !/^##\[(group|endgroup)\]/.test(line))
    .join('\n');
  let match;
  for (const pattern of ERROR_PATTERNS) {
    match = pattern.exec(text);
    if (match) break;
  }
  if (!match) {
    const marker = /##\[error\](.*)/.exec(text);
    if (marker)
      match = Object.assign([marker[1]], {
        index: marker.index,
        input: text,
        length: marker[0].length,
      });
  }
  if (!match) return { excerpt: text.slice(-3000) };
  const at = match.index;
  return {
    summary: match[0].replace('##[error]', '').trim().slice(0, 300),
    excerpt: text.slice(Math.max(0, at - 2000), at + match[0].length + 1000),
  };
}

// ------------------------------------------------------------------------------ pull requests

const PR_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number title state isDraft createdAt mergedAt closedAt additions deletions changedFiles
      author { login }
      labels(first: 20) { nodes { name } }
      commits { totalCount }
      reviews(first: 100) { totalCount nodes { author { login } state submittedAt } }
      reviewThreads(first: 100) {
        totalCount
        nodes { isResolved isOutdated path comments(first: 10) { nodes { author { login } createdAt body } } }
      }
    }
  }
}`;

const SEVERITIES = ['Critical', 'Major', 'Minor', 'Trivial'];
const CATEGORY =
  /(Functional Correctness|Stability & Availability|Data Integrity & Integration|Maintainability & Code Quality|Performance & Scalability|Security & Privacy|Accessibility)/;

async function sendPullRequest(number) {
  const [owner, name] = REPO.split('/');
  const data = await github('/graphql', { query: PR_QUERY, variables: { owner, name, number } });
  const pr = data.data?.repository?.pullRequest;
  if (!pr)
    throw new Error(
      `GitHub: no pull request #${number}: ${JSON.stringify(data.errors ?? data).slice(0, 300)}`,
    );
  if (
    pr.reviews.nodes.length < pr.reviews.totalCount ||
    pr.reviewThreads.nodes.length < pr.reviewThreads.totalCount
  ) {
    throw new Error(
      `#${number} has more than 100 reviews or review threads; this script reads only the first page.`,
    );
  }

  const author = pr.author?.login ?? 'ghost';
  const url = `${REPO_URL}/pull/${number}`;
  const reviews = pr.reviews.nodes.filter((review) => review.submittedAt);
  const coderabbit = reviews.filter((review) => review.author?.login === CODERABBIT);
  const humans = [...new Set(reviews.map((review) => review.author?.login))]
    .filter((login) => login && login !== CODERABBIT && login !== author)
    .sort();
  const threads = pr.reviewThreads.nodes.filter(
    (thread) => thread.comments.nodes[0]?.author?.login === CODERABBIT,
  );

  const logs = [];
  const outcomes = {};
  for (const thread of threads) {
    const first = thread.comments.nodes[0];
    const finding = classifyFinding(first.body, thread, author);
    outcomes[finding.outcome] = (outcomes[finding.outcome] ?? 0) + 1;
    logs.push({
      time: first.createdAt,
      severity: { Critical: 5, Major: 4 }[finding.severity] ?? 3,
      subsystem: 'code-review',
      body: {
        event: 'coderabbit_finding',
        message: `CodeRabbit ${finding.severity.toLowerCase()}: ${finding.title}`,
        pr: number,
        pr_title: pr.title,
        pr_author: author,
        path: thread.path ?? '',
        area: (thread.path ?? '').split('/').slice(0, 2).join('/'),
        repo: REPO,
        url,
        ...finding,
      },
    });
  }

  const lastState = coderabbit.at(-1)?.state;
  const firstReview = coderabbit.length
    ? earliest(coderabbit.map((review) => review.submittedAt))
    : undefined;
  const mergedWithChangesRequested = Boolean(pr.mergedAt) && lastState === 'CHANGES_REQUESTED';
  logs.push({
    time: pr.mergedAt ?? pr.closedAt ?? pr.createdAt,
    severity: mergedWithChangesRequested ? 4 : 3,
    subsystem: 'pull-requests',
    body: {
      event: 'pull_request',
      message: `PR #${number} ${pr.state.toLowerCase()}: ${pr.title}`,
      pr: number,
      title: pr.title,
      state: pr.state,
      author,
      is_draft: pr.isDraft,
      labels: pr.labels.nodes.map((label) => label.name),
      additions: pr.additions,
      deletions: pr.deletions,
      lines_changed: pr.additions + pr.deletions,
      files_changed: pr.changedFiles,
      commits: pr.commits.totalCount,
      hours_to_merge: pr.mergedAt
        ? round((Date.parse(pr.mergedAt) - Date.parse(pr.createdAt)) / 3_600_000)
        : undefined,
      minutes_to_first_coderabbit_review: minutes(pr.createdAt, firstReview),
      coderabbit_reviews: coderabbit.length,
      coderabbit_change_requests: coderabbit.filter(
        (review) => review.state === 'CHANGES_REQUESTED',
      ).length,
      coderabbit_last_state: lastState,
      coderabbit_findings: threads.length,
      findings_fixed: (outcomes['fixed'] ?? 0) + (outcomes['fixed (inferred)'] ?? 0),
      findings_dismissed: outcomes['dismissed'] ?? 0,
      findings_unresolved: outcomes['open'] ?? 0,
      human_reviewers: humans,
      human_reviews: humans.length,
      merged_with_changes_requested: mergedWithChangesRequested,
      repo: REPO,
      url,
    },
  });

  console.log(`PR #${number}: ${logs.length} logs (${threads.length} CodeRabbit findings)`);
  if (dryRun) return printSample(logs);
  await sendLogs(logs);
}

/** A CodeRabbit thread's severity, category and title from its first comment, and how it ended. */
function classifyFinding(body, thread, author) {
  const plain = body.replace(/<[^>]+>/g, '');
  const head = plain.split('\n').slice(0, 4).join(' ');
  const severity =
    SEVERITIES.find((label) => new RegExp(`\\b${label}\\b`).test(head)) ?? 'Unlabelled';
  const effort = head.includes('Heavy lift')
    ? 'Heavy lift'
    : head.includes('Quick win')
      ? 'Quick win'
      : undefined;
  const title =
    [...plain.matchAll(/\*\*([^*\n]{8,200})\*\*/g)]
      .map((match) => match[1])
      .find(
        (text) =>
          !/Potential issue|Minor|Major|Critical|Quick win|Heavy lift|Correctness|Availability|Integrity|Maintainability|Performance|Security/.test(
            text,
          ),
      ) ?? '';
  const replies = thread.comments.nodes
    .slice(1)
    .filter((comment) => comment.author?.login === author)
    .map((comment) => comment.body)
    .join(' ')
    .toLowerCase();

  let outcome;
  if (
    body.toLowerCase().includes('addressed in commit') ||
    /\bfixed in\b|\bdone in\b/.test(replies)
  )
    outcome = 'fixed';
  else if (
    /won't|will not|not (going to|changing)|intentional|by design|out of scope|disagree|not a bug|false positive/.test(
      replies,
    )
  )
    outcome = 'dismissed';
  else if (thread.isResolved && thread.isOutdated) outcome = 'fixed (inferred)';
  else if (thread.isResolved) outcome = 'resolved without change';
  else outcome = 'open';

  return {
    severity,
    category: CATEGORY.exec(head)?.[1] ?? 'Other',
    effort,
    title: title.trim(),
    outcome,
    author_replied: Boolean(replies),
  };
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
async function githubPages(path, key) {
  const items = [];
  for (let page = 1; ; page++) {
    const data = await github(`${path}?per_page=100&page=${page}`);
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
