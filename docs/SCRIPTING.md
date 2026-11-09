# Test scripting reference

Tests are **YAML** (`*.yaml`) or **JavaScript** (`*.test.js`). Both run on the same step engine, so every
action is recorded with its status, duration and a snapshot of the 5250 screen.

## YAML test file

```yaml
name: Cancel an open order          # required
suite: orders                       # grouping for dashboards/JUnit (default: "default")
tags: [regression, orders]          # filter with --tags / schedules
description: Optional text
retries: 1                          # re-run on failure (marks the test flaky if a retry passes)
timeout: 15000                      # default step timeout in ms
coverage:                           # false disables coverage collection for this test
  programs: [ORDINQ]                # programs/modules to measure (CODECOV MODULE list)
variables: { STATUS: OPEN }         # initial ${vars.X}
data:                               # data-driven: one iteration per row
  file: ../data/orders.csv          # CSV (header row) or .json array, relative to this file
  # or inline:  data: [ { CUST: "10001" }, { CUST: "10002" } ]
steps:
  - signon: {}
  - ...
```

### Field locators
Steps that act on a field accept one of:
- `label: Customer number`: the text to the left of the field (dot leaders and `:` are stripped). Matching is exact first, then prefix, then substring, and is case-insensitive.
- `row: 5, col: 31`: any position inside the field (1-based).
- `index: 0`: the nth unprotected input field on the screen.

### Actions

| Action | Short form | Arguments |
|---|---|---|
| `signon` | – | `user`, `password` (defaults: environment), `program`, `menu`, `library`. Fails on CPF11xx sign-on errors. |
| `command` | `command: "CALL ORDINQ"` | `value`, optional `label`/`row`+`col` of the command line, `key` (default Enter). Finds the `===>` command line automatically. With the CODECOV adapter, `CALL` commands are wrapped for coverage. |
| `fill` | – | locator + `value`. Monocase fields are upper-cased. Protected fields and over-long values fail. |
| `press` | `press: Enter` | `key`: `Enter`, `F1`–`F24`, `PageUp`, `PageDown`, `Help`, `Clear`, `Print`, `Attn`, `SysReq`. Optional `times`. Waits until the keyboard unlocks. |
| `waitFor` | `waitFor: "Order Detail"` | `text` or `regex`, optional `row`/`col`, `timeout`, `gone: true` (wait for the text to disappear). |
| `assertText` | `assertText: "ACME"` | `text` or `regex`, optional `row` (row contains), `row`+`col` (exact text at that position), `ignoreCase`. |
| `assertNotText` | `assertNotText: "not found"` | same as `assertText`. |
| `assertField` | – | locator + `equals` / `contains` / `matches` (regex). |
| `assertCursor` | – | `row`, `col`. |
| `setVar` | – | `name` + `value`, or `row`,`col`,`length` (capture screen text), or `label` (capture field value). |
| `wait` | `wait: 500` | `ms`. |
| `screenshot` | `screenshot: after-save` | Named checkpoint. Every step already captures the screen. |
| `coverageStart` / `coverageStop` | – | Manual coverage control for adapters that support it. |

Any step can also have `name:` (a custom description in reports) and `continueOnFailure: true`.

### Variables
`${...}` works in any string argument:
- `${env.user}`, `${env.password}`, `${env.LIB}`: environment fields and environment `variables`, then process env.
- `${data.CUST}`: the current data row.
- `${vars.ORDER}`: values captured with `setVar` or declared in `variables`.
- `${secrets.NAME}`: a process environment variable, so CI secrets never sit in files.
- `${NAME}`: searched in vars, then data, then env.

An unresolved variable fails the step. It never silently types an empty value.

## JavaScript tests

```js
export default {
  name: 'Customer inquiry shows credit status',
  suite: 'customers',
  tags: ['smoke'],
  coverage: { programs: ['CUSTINQ'] },
  data: [{ CUST: '10003', STATUS: 'CREDIT HOLD' }],
  async run(t) {
    await t.signon();
    await t.command('2');
    await t.fill('Customer number', t.data.CUST);      // label string or { row, col } / { index }
    await t.press('Enter');
    await t.assertText(t.data.STATUS, { row: 10 });
    await t.step('Balance is formatted', () => {
      t.expect(t.read(8, 31, 14).trim()).toMatch(/^\d{1,3}(,\d{3})*\.\d{2}$/);
    });
  },
};
```

`t` API: `signon(opts)`, `command(value, opts)`, `fill(loc, value)`, `press(key, opts)`, `waitFor(text, opts)`,
`assertText(text, opts)`, `assertNotText`, `assertField(loc, equals)`, `assertCursor(row, col)`,
`setVar(name, opts)`, `wait(ms)`, `step(name, fn)`, `read(row, col, len)`, `text()`, `screen` (JSON),
`expect(x).toBe/toContain/toMatch/toBeTruthy`, plus `env`, `data` and `vars`.

## Environments (CLI `--env file.json`)

```json
{ "name": "QA", "host": "qa400", "port": 992, "tls": true,
  "user": "${TP_USER}", "password": "${TP_PASSWORD}", "devicePrefix": "TP",
  "coverageAdapter": "codecov", "codecov": { "transport": "sftp", "sourceDir": "./src" },
  "variables": { "LIB": "ORDLIBQA" } }
```
`${NAME}` placeholders in an env file are replaced from process env when the file is loaded.

## CI example (GitHub Actions)

```yaml
- run: npm ci
- run: npx tp5250 run tests --env env.qa.json --tags smoke --report out --server ${{ vars.TP_SERVER }}
  env: { TP_USER: ${{ secrets.IBMI_USER }}, TP_PASSWORD: ${{ secrets.IBMI_PASSWORD }} }
- uses: mikepenz/action-junit-report@v4
  if: always()
  with: { report_paths: out/junit.xml }
```
