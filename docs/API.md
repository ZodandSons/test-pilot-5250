# TestPilot 5250 – Server API Contract

Base URL: `http://localhost:4250` (REST under `/api`, WebSocket at `/ws`).
All bodies are JSON. Timestamps are ISO-8601 strings. Durations are milliseconds.

## Shared shapes

### Screen
```json
{
  "rows": 24, "cols": 80,
  "text": ["24 strings of exactly 80 chars"],
  "cursor": { "row": 1, "col": 1 },            // 1-based
  "keyboardLocked": false,
  "fields": [
    { "id": 0, "row": 5, "col": 20, "length": 10, "input": true,
      "bypass": false, "hidden": false, "numeric": false,
      "value": "10001", "label": "Customer number" }
  ],
  "attrs": [ { "row": 1, "col": 30, "length": 20, "color": "white",
               "reverse": false, "underline": false } ]   // color: green|white|red|turquoise|yellow|pink|blue
}
```
`label` is inferred text to the left of the field (may be empty).

### Step (test-case step definition, as in YAML)
`{ "action": "fill", "args": { "label": "Customer", "value": "10001" } }`
Actions: `connect`, `signon`, `waitFor`, `command`, `fill`, `press`, `assertText`, `assertField`,
`assertNotText`, `assertCursor`, `screenshot`, `wait`, `setVar`, `coverageStart`, `coverageStop`.

### StepResult
```json
{ "index": 3, "action": "press", "description": "Press Enter", "status": "passed|failed|skipped",
  "durationMs": 120, "error": null, "screen": Screen, "expected": "optional text" }
```

## Environments
- `GET /api/environments` → `Environment[]`
- `POST /api/environments` body `Environment` (no id) → `Environment`
- `PUT /api/environments/:id` → `Environment`
- `DELETE /api/environments/:id` → `{ ok: true }`

```json
{ "id": "env_1", "name": "Simulator", "host": "127.0.0.1", "port": 2323,
  "deviceName": "", "user": "TESTER", "password": "***",
  "coverageAdapter": "simulator|codecov|none",
  "codecov": { "ifsDir": "/home/TESTER/cc", "sshHost": "", "sshUser": "", "sshPort": 22 },
  "variables": { "LIB": "ORDLIB" } }
```

## Test cases
- `GET /api/tests` → `[{ id, name, suite, type: "yaml"|"js", tags: [], description, updatedAt,
   lastStatus: "passed"|"failed"|"error"|null, lastRunAt, stepCount }]`
- `GET /api/tests/:id` → same + `content` (raw YAML/JS source) + `steps` (parsed, YAML only)
- `POST /api/tests` body `{ name, suite, type, content }` → test
- `PUT /api/tests/:id` body `{ name?, suite?, content? }` → test
- `DELETE /api/tests/:id` → `{ ok: true }`
- `POST /api/tests/validate` body `{ type, content }` → `{ ok, errors: [] }`

## Runs
- `POST /api/runs` body `{ testIds?: [], suite?: "", tags?: [], environmentId, coverage: true, name? }`
  → `{ runId }` (run starts asynchronously; progress over WebSocket)
- `POST /api/runs/import` body `{ run: Run & { results }, coverage: [normalizedCoverage|null] }` → `{ runId }` (used by `tp5250 run --server`)
- `GET /api/runs?limit=50` → `Run[]`
- `GET /api/runs/:id` → `Run & { results: Result[] }`
- `DELETE /api/runs/:id`
- `GET /api/runs/:id/report.html` | `/report.junit.xml` | `/report.json` — downloadable reports

```json
Run = { "id": "run_..", "name": "Smoke", "status": "queued|running|passed|failed|error",
  "trigger": "manual|cli|schedule|api", "environmentId": "env_1", "environmentName": "Simulator",
  "startedAt": "...", "finishedAt": "...", "durationMs": 4200,
  "total": 6, "passed": 5, "failed": 1, "errors": 0, "skipped": 0, "coveragePct": 72.5 }

Result = { "id": "res_..", "runId": "run_..", "testId": "t_..", "testName": "..", "suite": "orders",
  "iteration": 1, "dataRow": { "CUST": "10001" } | null,
  "status": "passed|failed|error|running|queued", "durationMs": 900, "error": "msg|null",
  "failedStep": 4, "steps": StepResult[],
  "coverage": { "pct": 61.2, "executable": 120, "covered": 73 } | null }
```

## Dashboard
- `GET /api/dashboard/summary?days=30` →
```json
{ "kpis": { "totalTests": 12, "totalRuns": 40, "passRate": 91.5, "avgDurationMs": 3200,
            "coveragePct": 74.1, "flakyCount": 2, "lastRunStatus": "passed" },
  "trend": [ { "date": "2026-11-01", "runs": 3, "passed": 20, "failed": 2, "passRate": 90.9, "avgDurationMs": 2900 } ],
  "coverageTrend": [ { "date": "2026-11-01", "pct": 70.2 } ],
  "bySuite": [ { "suite": "orders", "passed": 30, "failed": 3, "tests": 4 } ],
  "topFailing": [ { "testId": "t_1", "testName": "..", "failures": 4, "lastError": ".." } ],
  "flaky": [ { "testId": "t_1", "testName": "..", "flips": 3 } ],
  "slowest": [ { "testId": "t_1", "testName": "..", "avgDurationMs": 5400 } ],
  "recentRuns": [ Run ] }
```

## Coverage
- `GET /api/coverage/programs` → `[{ program, library, sourceFile, executable }]`
- `GET /api/coverage/result/:resultId` → `CoverageReport`
- `POST /api/coverage/merge` body `{ resultIds?: [], runIds?: [], testIds?: [] }` → `CoverageReport`
  (testIds = latest result of each test)

```json
CoverageReport = {
  "totals": { "executable": 300, "covered": 210, "pct": 70.0 },
  "sources": [ { "resultId": "res_..", "testName": "..", "runId": "run_.." } ],
  "programs": [ { "program": "ORDINQ", "library": "ORDLIB", "sourceFile": "QRPGLESRC/ORDINQ.rpgle",
      "language": "RPGLE", "executable": 120, "covered": 80, "pct": 66.7,
      "lines": [ { "no": 1, "text": "**free", "executable": false, "hits": 0, "coveredBy": [] } ] } ] }
```
`coveredBy` = array of indexes into `sources`.

## Schedules
- `GET /api/schedules` → `[{ id, name, cron, suite, tags, testIds, environmentId, enabled, lastRunAt, nextRunAt }]`
- `POST /api/schedules`, `PUT /api/schedules/:id`, `DELETE /api/schedules/:id`
Cron is 5-field (`m h dom mon dow`).

## WebSocket `/ws`
Server → client broadcasts:
- `{ "type": "run.update", "run": Run }`
- `{ "type": "result.update", "runId", "result": Result }` (steps may be omitted while running)
- `{ "type": "step", "runId", "resultId", "step": StepResult }`

Recorder (client ↔ server, one session per socket):
- C→S `{ "type": "rec.start", "environmentId" }` → S→C `{ "type": "rec.started", "sessionId", "screen", "steps": [] }`
- C→S `{ "type": "rec.input", "fields": [ { "row", "col", "value" } ], "aid": "Enter|F1..F24|PageUp|PageDown|Help|Clear|Attn|SysReq", "cursor": { "row", "col" } }`
  → S→C `{ "type": "rec.screen", "screen", "steps" }` (after host responds)
- C→S `{ "type": "rec.assert", "kind": "text|field", "row", "col", "length", "text" }` → `rec.steps`
- C→S `{ "type": "rec.removeStep", "index" }` → `{ "type": "rec.steps", "steps" }`
- C→S `{ "type": "rec.stop", "save": { "name", "suite", "tags": [] } | null }` → `{ "type": "rec.saved", "testId" }` or `{ "type": "rec.stopped" }`
- S→C `{ "type": "error", "message" }`

Live terminal (no recording) uses the same messages with `rec.start` `{ "record": false }`.
