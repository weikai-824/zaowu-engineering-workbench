# P1-F CAD Runtime & Real Engineering Asset Report

Status: Historical phase report; superseded by P1-G  
Date: 2026-09-15  
Current status entry: [`CURRENT_PROJECT_STATUS.md`](./CURRENT_PROJECT_STATUS.md)

P1-F remains the immutable record of the real CAD runtime and asset run. Use [`P1G_GOLDEN_SCENARIO_CLOSURE_REPORT.md`](./P1G_GOLDEN_SCENARIO_CLOSURE_REPORT.md) for the current Golden Scenario state.

## 1. Runtime

- Conda distribution: `<conda-root>`
- Environment: `zaowu-cad`
- Python executable: `<conda-root>\envs\zaowu-cad\python.exe`
- Python: `3.12.14`
- CadQuery: `2.8.0`
- OCP: `7.9.3.1.1`
- NLopt: `2.9.0`
- CasADi: `3.8.0`

Runtime is genuinely usable. The smoke test imported CadQuery/OCP, created a filleted solid, exported STEP/BREP/STL, and successfully re-imported the STEP with one valid solid. The repository's `public/cad/run_cad.py` then executed the actual Golden CAD task; no machine-specific absolute path was added to business code. The relay already accepts an explicit `--cad-python` executable.

## 2. Original P1-E CAD Task

The existing and only CAD task was executed; no replacement task was created.

- Project: `91ad21c0-4143-4252-8969-00dc31047b82`
- CAD task: `6b559822-f45a-488e-83ba-7822e88850a9`
- CAD design: `23144fff-8966-46de-ab3d-7d30c06634e4`
- Task revision: `3`
- Design SHA-256: `fb6c546a95d664b0f437c51e711deaa89e90f76ff46860a66e0087bcc62dd1ba`
- Executor: `controlled-cad-v2`
- CAD artifact filesystem timestamp: `2026-09-15 12:42:02–12:42:03 Asia/Shanghai`
- Result ZIP: `work/validation/p1f-cad/cad-result-v1.zip`, 62,084 bytes
- Result ZIP SHA-256: `c997b2b3a5a8e7cadca7482cc496c6870ea34622dce7e76cb4e52f0f74443d66`

The result contains `assembly.step`, the part STEP/BREP/STL, `design.json`, and `report.json`. The result was archived through `/api/cad/jobs`, validated by `readCadResult`, stored in R2/D1, and attached through the existing CAD route. The project advanced through Revision 4 (attach), Revision 5 (CAD checks), Revision 6 (reference profile binding), Revision 7 (fresh CAD checks), and Revision 8 (slice blocker evidence).

Archive timestamp: `2026-09-15T04:44:51.746Z` (`12:44:51.746` Asia/Shanghai). The offline Slice task was created at `2026-09-15T04:50:39.336Z`; the current project Revision 8 was last updated at `2026-09-15T04:51:21.929Z`.

## 3. CAD Asset, geometry, topology, and quality

- CAD Part: `d9b8af65-dadb-4767-9120-2ab53d48da3a`
- CAD Asset: `234cb135-d64e-4dba-8ac6-f6845ebbc652`
- STL bytes: `107,084`
- STL SHA-256: `16ac5e815a2fdd1ca4f53b4cd83c17a4930743b576ebf0f3e18706f5aca0764f`
- Dimensions: `140 × 100 × 60 mm`
- Triangles: `2,140`
- Kernel volume: `205,843.68146928205 mm³`
- Feature count: `19`
- Kernel validity: passed
- STEP round-trip: `valid_volume_checked`
- Interface gauges: `4/4 passed`; declared scope is the four straight Z bores only
- Assembly interference: `0` detected pairs
- CAD STL topology: passed; boundary edges `0`, non-manifold edges `0`, non-manifold vertices `0`, winding conflicts `0`
- Build-space precheck: passed against the existing X1C reference profile after binding `fdm-x1c-pla-basic-reference`

The current engineering evidence remains intentionally limited: `verification=unsigned_local_report`, `productionReady=false`, and `physicalValidation=not_run`. Strength, wall thickness, assembly clearance, thread fit, support strategy, printability, and actual machine calibration remain not checked. A passing CAD kernel/topology result is not a physical manufacturing acceptance.

## 4. Asset / Part / Revision / Evidence

The CAD result is not an orphan file. The existing route chain created the Asset and attached a CAD-sourced Part with the source CAD job, design ID, design hash, logical part ID, STL hash, dimensions, and unit scale. The current project records passed CAD kernel/result evidence and passed CAD geometry/topology/build-space evidence while keeping the P1-D Visual Candidate separate as `visual_reference`.

P1-D Visual Candidate evidence was not overwritten. Its historical topology result remains `topology_issues` and its current project state is `stale`; P1-F did not use a CAD result to claim the visual mesh passed. The local R2 object for the P1-D derived asset returned 404 during this round, so visual recheck is explicitly `not_run` and is a separate follow-up.

## 5. Slice status

Offline Slice job `9d405a44-297b-4b1c-9064-8732f4f84a3a` was created for the CAD Part using recipe `bambu-x1c-pla-basic-reference-v1` / Bambu Studio `02.08.02.60` / X1 Carbon / PLA Basic. The server recomputed and matched the saved CAD mesh completely: `2140/2140` triangles, maximum coordinate error `0`, source and target dimensions `140 × 100 × 60 mm`.

No Bambu Studio or Orca Slicer executable was found in PATH or the checked standard install paths. Therefore the job remains `prepared`, the project evidence is `not_run / blocked`, and no slicing result or G-code was fabricated.

## 6. Documentation baseline closure

- Added [`CURRENT_PROJECT_STATUS.md`](./CURRENT_PROJECT_STATUS.md) as the unique current-state entry.
- Added this P1-F report.
- Marked `TAKEOVER_REPORT.md` historical/superseded for current-state decisions.
- Marked P1-A through P1-D as historical stage reports; marked P1-E explicitly superseded by P1-F.
- Updated `PRODUCT_BASELINE.md` to point current code facts to `CURRENT_PROJECT_STATUS.md`.
- Historical reports and real evidence files were not deleted.

## 7. Tripo and remaining Golden Scenario gap

P1-F real Tripo generation requests: **0**. No new task, retry, upload, query, or credit consumption occurred in this round. The historical P1-C generation remains the only real generation in that earlier phase.

The Golden Scenario is now through a real deterministic CAD engineering asset and a prepared offline slicing task. It is not a complete manufacturing deliverable yet: the fixed slicer runtime/result is missing, and wall-thickness/self-intersection/fit/strength/support/printability checks, physical first-piece measurement, machine/material calibration, and production sign-off remain.

## 8. Verification run

- CAD runtime smoke test: passed.
- P1-F API-backed CAD validation: passed; current project Revision 8, CAD job `attached`, Slice job `prepared`.
- `npm run validate:golden-cad-design`: passed.
- `npm run validate:quality-baseline`: 2/2 passed.
- `npm run validate:candidate-comparison`: passed without fabricating a candidate.
- `npm run validate:tripo-preview`: 2/2 passed; preview only, no network request.
- `node validation/slice-geometry.cjs`: 39/39 passed.
- `npx --no-install tsc --noEmit`: passed.
- `npm run build`: passed after stopping the local Worker that had held `dist`; the first build attempt failed only with Windows `EPERM` because that process was still running.
- `npx --no-install eslint validation/p1f-cad.cjs`: passed.
- Full `npm run lint`: still fails on repository-wide legacy and generated-code findings; no P1-F source-file finding was introduced. This remains a repository baseline issue, not a CAD runtime failure.
