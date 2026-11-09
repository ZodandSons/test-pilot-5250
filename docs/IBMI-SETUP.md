# Connecting TestPilot 5250 to a real IBM i

## 1. Telnet / TN5250
- Port 23 (plain) or 992 (TLS: `"tls": true`). The client sends terminal type `IBM-3179-2` (24×80).
- Every test session gets a unique **device name** (`devicePrefix` + random, 10 characters max) through NEW-ENVIRON. Allow virtual devices to be auto-created (`QAUTOVRT`), or pre-create devices that match the prefix.
- Use a dedicated test user profile with a fixed initial program or menu (`INLPGM`/`INLMNU`), and its own library list. Disable "Display sign-on information" (`DSPSGNINF *NO`) so sign-on goes straight to the menu. The `signon` step also presses Enter past most informational screens.
- Make sure `QINACTITV` and `QDSCJOBITV` suit your test session length. Sessions are disconnected when a test ends.

## 2. Code coverage with CODECOV
IBM's headless code coverage command is `QDEVTOOLS/CODECOV`. It ships with **5770WDS option 60** on IBM i 7.4+ (IBM's PTFs bring it to earlier releases), and it is free of charge.

1. Compile programs under test with source debug views. For example:
   `CRTBNDRPG PGM(ORDLIB/ORDINQ) SRCFILE(ORDLIB/QRPGLESRC) DBGVIEW(*SOURCE)`
   (for CL: `CRTBNDCL ... DBGVIEW(*SOURCE)`).
2. The test user needs authority to `QDEVTOOLS/CODECOV`, the programs, and the output IFS directory (default `/home/<user>`).
3. In the environment, set `"coverageAdapter": "codecov"`. When a test step issues `command: "CALL ORDINQ"`, it is sent as:
   ```
   QDEVTOOLS/CODECOV CMD(CALL ORDINQ) MODULE((ORDINQ *PGM *ALL)) CCVIEW(*SOURCE) TESTID(TPxxxx)
   ```
   The modules come from the test's `coverage.programs`. CODECOV runs the program in the **interactive job**, so the 5250 screens behave exactly as they normally do. When the program ends, CODECOV shows `Created code coverage result file (/home/USER/....cczip)`. The adapter reads that path from the screen.
4. The adapter fetches the `.cczip`:
   - `"transport": "sftp"` (default): needs `npm i ssh2` and SSH on the IBM i (`STRTCPSVR *SSHD`).
     Options: `sshHost`, `sshPort`, `sshUser`, `sshPassword` or `sshKeyFile`.
   - `"transport": "mount"`: the IFS is mounted locally. Set `mountPath` (local) and `ifsRoot` (IFS path it maps to).
5. Set `codecov.sourceDir` to a local checkout of your sources (`QRPGLESRC/ORDINQ.rpgle` …) if the `.cczip` does not include source text.

> ⚠️ IBM does not document the `.cczip` format. `parseCczip()` (in `packages/core/src/coverage.js`) handles Cobertura-style and generic line/hit XML. Validate it against one of your files before you rely on the numbers, and adjust if needed. Community reports also show CODECOV leaving out source coverage when the job CCSID is 65535 and source names contain special characters. If results come back empty, run the job with `CHGJOB CCSID(37)`. Confirm the `TESTID` keyword with `F4` on your release.

Programs started from a menu option, rather than an explicit `CALL`, are not wrapped. Either call the program in the test, or point the menu option at a small CL wrapper that calls `CODECOV` when a data area or environment variable is set.

## 3. Recommended test data practices
- Reset test data before suites (for example a `CALL RSTTSTDTA` step, or a scheduled job), or use data-driven rows that create their own records.
- Keep tests independent: each one signs on, does its work and exits. Sessions run in parallel, so don't share records that tests change.
