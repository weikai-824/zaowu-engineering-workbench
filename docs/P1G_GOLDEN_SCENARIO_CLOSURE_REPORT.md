# P1-G Golden Scenario Closure Report

Status: Historical phase report; superseded by P1-H  
Date: 2026-09-15  
Current status entry: [`CURRENT_PROJECT_STATUS.md`](./CURRENT_PROJECT_STATUS.md)

P1-G remains the immutable record of the role-aware Golden Scenario closure at Revision 9. The signed CAD execution and Slice re-baseline are recorded in [`P1H_TRUSTED_CAD_EXECUTION_SLICE_REBASELINE_REPORT.md`](./P1H_TRUSTED_CAD_EXECUTION_SLICE_REBASELINE_REPORT.md).

## 1. Outcome

The fixed Golden Project now has an explicit and enforceable engineering chain:

`Tripo Visual Candidate (visual_reference) → CAD Engineering Asset (manufacturing) → fixed Offline Slice task → Slice Evidence import contract → traceable Engineering Package`

The project advanced from Revision 8 to Revision 9 only to persist the two engineering roles. No geometry, CAD design, CAD task, Slice task, or Tripo task was regenerated.

- Project: `91ad21c0-4143-4252-8969-00dc31047b82`
- Current Revision: `9`
- CAD Task: `6b559822-f45a-488e-83ba-7822e88850a9`
- CAD Part: `d9b8af65-dadb-4767-9120-2ab53d48da3a`
- CAD Asset: `234cb135-d64e-4dba-8ac6-f6845ebbc652`
- Offline Slice Task: `9d405a44-297b-4b1c-9064-8732f4f84a3a`

## 2. Visual / manufacturing boundary

- The Tripo Part is explicitly stored as `engineeringRole=visual_reference`.
- The CAD Part is explicitly stored as `engineeringRole=manufacturing`.
- Source/role consistency is validated by the project API. Tripo cannot be submitted as manufacturing; CAD cannot be submitted as visual reference.
- Visual Candidate is excluded from BOM, manufacturing plan, manufacturing assembly, manufacturing STL output, and actual Slice selection.
- Visual identity, source task, Asset ID, hash, historical checks, and optional reference GLB remain in `project.json`, `checks.json`, `references/visual-candidates.json`, and `traceability.json`.
- The CAD page no longer claims that no CAD entity exists after the CAD asset has been attached.

The current local R2 object for the historical visual candidate still returns 404. The UI now tolerates this only for `visual_reference`, preserves its metadata/evidence, and continues loading the CAD manufacturing model. A missing manufacturing asset still blocks loading/export.

## 3. Slice closure and evidence semantics

The fixed adapter remains Bambu Studio `02.08.02.60`, recipe `bambu-x1c-pla-basic-020-cool-reference-v1`. The existing task remains `prepared`, current (`stale=false`), and bound to the saved CAD Part mesh.

Windows runtime discovery checked PATH/common install roots, HKLM/HKCU uninstall records, and App Paths. No Bambu Studio or OrcaSlicer executable was found. Therefore:

- adapter: `configured`
- executable: `unavailable`
- executor: `not running`
- Slice task: `prepared / not_run / blocked`
- Slice result: absent
- physical validation: `not_run`
- production readiness: `false`

No substitute slicer or version was used and no result was fabricated.

When an authentic result is later imported, the PATCH route verifies the fixed manifest, saved Part → STL binding, 3MF embedded mesh, dimensions, triangle correspondence, G-code/layers/settings, and archive hash. It then atomically creates a new project Revision and a structured manufacturing Evidence record pointing to the Slice Task, manifest SHA-256, result SHA-256, Part, and measured Revision. If current engineering inputs have changed, that new evidence is `stale` rather than `passed`. Existing blockers and historical evidence are appended/preserved, never overwritten. Even a consistent result remains `unsigned_local_report`, `physicalValidation=not_run`, and `productionReady=false`.

## 4. Engineering Package

Validated artifact:

- Path: `work/validation/p1g/golden-engineering-package-v9.zip`
- Bytes: `926,153`
- SHA-256: `fad76c9f547793f87bb40d365e7be44f3886342d5840939f56b3b0ff5682c4c4`
- Files: `28` total; `27` payload files recorded and hash-verified by `traceability.json`

The package contains:

- `project.json`, `BOM.csv`, `manufacturing/plan.json`, parameter sheet, checks, geometry index, READMEs, and `traceability.json`.
- `cad-native/<CAD Task>/result.zip` plus expanded assembly STEP, Part STEP/BREP/STL, `design.json`, and `report.json`.
- `parts/<CAD Part>.stl` and manufacturing-only `assembly/assembly.glb`.
- the existing Slice Task manifest, manifest hash, input STL, and all three fixed expanded Bambu profiles.
- visual candidate metadata under `references/`; no visual manufacturing STL/BOM/plan entry.

Because the Slice task has no real result, the current package intentionally has no Slice result ZIP, 3MF, G-code, or result report. The exporter automatically includes and expands these artifacts—including 3MF-embedded G-code—only after a verified `offline_consistent` result exists.

## 5. Verification

- `npm run validate:p1g`: passed (role boundary, Slice selection rejection, Revision/Evidence append, stale handling, package boundary, reference retention, traceability).
- `npm run validate:p1g-real-package`: passed against the actual local Project/CAD Asset/Slice Task.
- `node validation/slice-geometry.cjs`: 39/39 passed; source unchanged.
- `npm run validate:golden-cad-design`: passed.
- `npx --no-install tsc --noEmit`: passed.
- changed-file ESLint: passed; Workbench retains two pre-existing `<img>` optimization warnings and has zero errors.
- `npm run build`: passed.

P1-G Tripo generation requests: **0**. New CAD tasks: **0**. New Slice tasks: **0**.

## 6. Remaining blockers

- Install and verify the exact Bambu Studio `02.08.02.60` executable matching the fixed executable/DLL fingerprints before running the existing Slice task.
- Import the authentic `offline-result.zip`; only then can Slice Evidence advance to `offline_consistent`.
- Physical print, first-article measurements, machine/material calibration, support/warpage evaluation, strength, wall thickness, fit/clearance, and production sign-off remain outside the current evidence and are not claimed.
- Repair or restore the historical Visual Candidate R2 object if visual rendering in the showcase is required; its metadata and evidence are already preserved.
