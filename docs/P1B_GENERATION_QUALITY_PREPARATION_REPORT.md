# P1-B Generation Quality Preparation Report

> Status: Historical stage report. 当前项目状态以 [`CURRENT_PROJECT_STATUS.md`](./CURRENT_PROJECT_STATUS.md) 为准。

日期：2026-09-15  
范围：Tripo generation prompt 职责边界、High Quality payload preview、Candidate 质量对比结构。  
限制：本阶段没有调用真实 Tripo API，没有提交新任务，没有上传文件，没有消耗 credits。

## 1. Prompt 与工程约束

`lib/tripo-submit.ts` 现在提供两个明确入口：

- `visualGenerationPrompt(input)`：只清理并返回用户提供的视觉/生成描述；不再追加项目尺寸、数量、工艺、设备、材料、公差、连接或生产备注。
- `engineeringConstraints(input, projectBody)`：输出 `tripo-engineering-constraints-v1` 结构，保存项目级 title/domain/targetSizeMm/quantity/connection/preferredProcess，以及 generation manufacturing 的全部字段。

实际 job request 同时记录 `visualPrompt`、`engineeringConstraints` 和原始规范化输入；provider body 的 `prompt` 只来自 `visualGenerationPrompt()`。`buildTripoPayload()` 已移除外部 prompt 注入口，避免调用方绕过边界。Dry Run response 也返回同一份视觉 prompt 和约束快照。

本轮没有修改项目 `brief` 字段的含义，也没有凭正则猜测用户自由文本中的工程信息。结构化字段由约束快照完整追踪；自由文本作为用户明确提供的生成描述原样保留。

## 2. 两个实验配置

Golden Baseline 保持可复现：Text-to-3D、`v3.1-20260211`、`face_limit=10000`、`texture=true`、`pbr=true`、`texture_quality=standard`、`geometry_quality` 不发送、`auto_size=true`。

High Quality Validation 只通过 Dry Run 构造：

```json
{
  "model": "v3.1-20260211",
  "texture": true,
  "pbr": true,
  "export_uv": true,
  "texture_quality": "detailed",
  "auto_size": false,
  "face_limit": 80000,
  "geometry_quality": "detailed",
  "model_seed": 20260915,
  "image_seed": 20260916,
  "texture_seed": 20260917,
  "negative_prompt": "low-poly; disconnected shells; floating parts; thin unsupported walls; decorative scene elements"
}
```

两种配置均为 `POST /generation/text-to-model` 的 payload preview；preview 返回 `dryRun=true`、`submit=false`、`networkRequests=[]`。

## 3. Candidate 对比能力

`lib/candidate-quality-comparison.ts` 增加 `compareCandidateQuality()`，消费已有 `QualityBaseline`，不重新实现网格算法。输出包含 Golden / High Quality 两侧的：

- triangles
- dimensionsMm
- boundaryEdges
- nonManifoldEdges
- nonManifoldVertices
- topology verdict
- stage gate

缺少候选时对应侧为 `not_run`，数值和 verdict 为 `null`，不会伪造 High Quality 结果。`validation/candidate-quality-comparison.cjs` 覆盖了当前尚无 High Quality Candidate 的情况。

## 4. 验证

- `npm run validate:tripo-preview`：2/2
- `npm run validate:candidate-comparison`：通过，缺失候选严格为 `not_run`
- `npm run validate:quality-baseline`：2/2
- `node validation/tripo-submit.cjs`：40/40，mock provider/R2
- `npx --no-install tsc --noEmit`：通过

本报告没有把 Dry Run 当成真实生成质量证据；在获得人工批准并明确允许消耗 credits 前，不会产生新的 Tripo Candidate。
