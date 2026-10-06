# P1-H Trusted CAD Execution & Slice Re-baseline Report

Status: CAD execution provenance closed; Slice re-baselined and blocked at exact runtime  
Date: 2026-09-15  
Current status entry: [`CURRENT_PROJECT_STATUS.md`](./CURRENT_PROJECT_STATUS.md)

## 1. Outcome

The Golden Project now uses the repository's existing trusted local CAD execution path end to end:

`registered device → queued run → lease → attempt → heartbeat → pinned runner → CAD result hash → canonical receipt → Ed25519 signature → server verification → CAD archive/attach → new Revision → Slice re-baseline → Engineering Package proof`

No second execution protocol, fake device, fake lease, fake receipt, fake signature, fake result, substitute slicer, Tripo request, CAD parameter change, LangGraph work, or physical/production claim was introduced.

## 2. Required closure facts

1. New current Revision: `11` (`10` attached the signed CAD Asset; `11` persisted fresh current checks).
2. New CAD Task ID: `de4d3dfa-4b58-4c97-a458-d05b2342c81f`.
3. CAD Design ID: `23144fff-8966-46de-ab3d-7d30c06634e4`; unchanged design SHA-256 `fb6c546a95d664b0f437c51e711deaa89e90f76ff46860a66e0087bcc62dd1ba`.
4. CAD result ZIP SHA-256: `1018b478ed8991f3ad5f807c95e9073e89f435bb85973e97eee6ef061084dbcc` (`62,084` bytes).
5. CAD manufacturing Asset: `f19432b7-e0e9-4959-9b9d-c516a27fd657`; STL SHA-256 `16ac5e815a2fdd1ca4f53b4cd83c17a4930743b576ebf0f3e18706f5aca0764f`.
6. Execution Device ID: `aacf9aa4-42d1-43e5-a796-7bd39cb104eb`.
7. Execution Run ID: `9fa64900-f45b-4187-b1c3-ac007bf83393`; attempt `1`; lease `169be901-62fc-45d8-9dc8-caad26a1a748`; status `succeeded`.
8. Signature verification: `registered_device_signature_verified`. Internal `report.json` remains `unsigned_local_report`.
9. Engineering Package: `work/validation/p1h/golden-engineering-package-v11.zip`; `1,113,876` bytes; SHA-256 `a6e35d991ba07abd5d3925773d2e59c924fba04f5c32efa1953f3bd77314b37a`.
10. Packaged execution proof: `cad-native/de4d3dfa-4b58-4c97-a458-d05b2342c81f/execution-proof.json`.
11. New Slice Task ID: `c5bf7afe-b31a-4069-a603-61abb84ef53e`.
12. New Slice manifest SHA-256: `ccfbc21d7db11051842a8f7879d5b1e1fd2e2e022a13bcc77fa3aa9015ccf63b`.
13. New Slice input STL SHA-256: `fdd38f628b3ab2f4f82a334499ce0167b02edf5ffdbac17968e3d39208e9cee2`.
14. Old Slice is stale because the current manufacturing Part now points to a new signed CAD Task and new Asset; these source identities change `engineeringFingerprint`. The old task remains bound to historical unsigned CAD Task `6b559822-f45a-488e-83ba-7822e88850a9` / Asset `234cb135-d64e-4dba-8ac6-f6845ebbc652` and is retained as history.
15. Required Slice runtime: Bambu Studio `02.08.02.60`; executable/DLL remain unavailable, so no slicing was executed.
16. `physicalValidation=not_run`.
17. `productionReady=false`.
18. Remaining checks: self-intersection/shell nesting, local wall thickness/weak structures, strength, full interface/assembly tolerance, support/warping, exact Bambu runtime and authentic 3MF/G-code, actual machine/material-lot calibration, first-piece dimensional/functional validation, manufacturing review, and production sign-off.

## 3. CAD execution chain

- Task input SHA-256: `035db36dd9717707f445ebdc9b3ff3e489b555186e30328b27824b338afbf0b6`.
- Pinned `public/cad/run_cad.py` SHA-256: `d51c2a236f57f785007ef3625b693141c62aea1b69a4310bf92622b2c644f1f7`.
- Runtime: Python `3.12.14`, CadQuery `2.8.0`, OCP `7.9.3.1.1`, NLopt `2.9.0`, CasADi `3.8.0`; relay signing dependency cryptography `50.0.1` installed from the repository's hash-locked controller requirements.
- The relay generated and retained a current-user DPAPI-protected Ed25519 identity. Only device ID, public key, canonical receipt and signature enter D1/evidence; no private key enters the package.
- The server matched receipt run/job/device/attempt/lease/input/runner/result fields, result bytes and registered public key before atomically marking run and attempt succeeded and archiving the CAD result.
- Re-downloading `execution-proof.json` revalidates its receipt contract, result hash and signature.

The proof limitation is explicit: a software-key signature is not hardware attestation, independent CAD recomputation, printability evidence, physical validation, or production approval.

## 4. CAD asset and current checks

The unchanged design produced the same deterministic manufacturing STL content as the historical run, while the result ZIP hash changed because the new report/archive carries a new execution occurrence. The current Asset is a new immutable record and the old Asset remains present.

- Dimensions: `140 × 100 × 60 mm`.
- Triangles: `2,140`.
- CAD kernel validity and STEP round-trip: passed.
- Declared straight-Z interface gauges: `4/4` passed.
- Assembly overlap pairs: `0`.
- Current mesh topology: boundary edges `0`, non-manifold edges `0`, non-manifold vertices `0`, winding conflicts `0`.
- Build-space precheck: passed against the existing X1C reference profile.

Self-intersection, nested shells, local wall thickness, strength and complete assembly/fit remain `not_run` or limited in scope.

## 5. Slice re-baseline

The new task uses the same fixed recipe and exact engine declaration. Its normalized browser-generated Slice STL has a different byte hash from the source CAD Asset STL, but the existing server contract recomputed the saved Part and accepted only a complete oriented-triangle bijection; byte identity was not falsely claimed.

The old task is `prepared / stale=true`. The new task is `prepared / stale=false / not_run / blocked`, with no result, 3MF or G-code. No Orca or substitute runtime was used and this phase intentionally stopped before actual Bambu slicing.

## 6. Engineering Package and traceability

The package has `35` files; `34` payload files are recorded and SHA-verified through `traceability.json`. Its current CAD section contains result ZIP, expanded STEP/BREP/STL/report and `execution-proof.json`. `cad-native/index.json` and `traceability.json` both link the proof to CAD Task, device, run, input SHA, runner SHA and result SHA.

Both Slice tasks remain visible in `slicing/index.json`: the old one is historical/stale and the new one is current/prepared. Neither has a result directory. Visual Candidate remains only under `references/` and the CAD Part remains the sole manufacturing Part.

## 7. History and idempotence

- Old CAD Task, old CAD Asset, old Slice Task and all project Revisions remain stored.
- Repeating the signed result upload returned the same summary without creating another Asset.
- Repeating attach returned Revision `11` without creating a new Revision.
- Re-enqueueing the completed CAD Task returned `409`.
- Claim after completion returned no run.
- D1 counts after closure are one active device, one run and one attempt for this P1-H path.
- A proof checked against a tampered artifact hash was rejected.

## 8. Evidence

- `work/validation/p1h/closure.json`
- `work/validation/p1h/execution-proof.json`
- `work/validation/p1h/run-state.json`
- `work/validation/p1h/de4d3dfa-4b58-4c97-a458-d05b2342c81f-cad-result.zip`
- `work/validation/p1h/golden-engineering-package-v11.zip`
- `validation/p1h-closure.cjs`

P1-H Tripo API requests: **0**. New CAD Tasks: **1**. New Slice Tasks: **1**.
