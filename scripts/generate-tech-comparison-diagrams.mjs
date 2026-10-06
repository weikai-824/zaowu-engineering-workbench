import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "output", "技术原理拆解图-最终版");
const WIRE = path.join(ROOT, "generated-images", "灰白色调的3D网格线框模型渲染图_一个消费电子产品外壳的三维_2026-09-24T16-30-31.png");
const PRINT = path.join(ROOT, "generated-images", "纪实摄影风格照片_一台现代桌面级3D打印机正在打印一个白色的_2026-09-24T16-30-33.png");

const C = {
  ink: "#151923",
  text: "#2A3140",
  gray: "#747B88",
  pale: "#F4F6F9",
  paleBlue: "#EEF4FF",
  paleRed: "#FFF1EF",
  line: "#D8DEE8",
  blue: "#1757C9",
  blue2: "#2F74E9",
  navy: "#17357A",
  red: "#D72A21",
  orange: "#E34B14",
  green: "#15835E",
};

const esc = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

function text(x, y, value, size = 18, options = {}) {
  const {
    fill = C.ink,
    weight = 500,
    anchor = "start",
    family = "Microsoft YaHei UI, Microsoft YaHei, Noto Sans CJK SC, sans-serif",
    opacity = 1,
    letterSpacing = 0,
  } = options;
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="${family}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" opacity="${opacity}" letter-spacing="${letterSpacing}">${esc(value)}</text>`;
}

function multi(x, y, lines, size = 18, options = {}) {
  const {
    fill = C.ink,
    weight = 500,
    anchor = "start",
    lineHeight = Math.round(size * 1.45),
    family = "Microsoft YaHei UI, Microsoft YaHei, Noto Sans CJK SC, sans-serif",
  } = options;
  const spans = lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${esc(line)}</tspan>`).join("");
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="${family}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}">${spans}</text>`;
}

function rich(x, y, spans, size = 42, weight = 800) {
  return `<text x="${x}" y="${y}" font-family="Microsoft YaHei UI, Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="${size}" font-weight="${weight}">${spans.map((span) => `<tspan fill="${span.fill || C.ink}">${esc(span.text)}</tspan>`).join("")}</text>`;
}

function roundRect(x, y, w, h, options = {}) {
  const { fill = "#FFFFFF", stroke = C.line, sw = 1, r = 12, shadow = false, opacity = 1, dash = "" } = options;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="${opacity}"${shadow ? ' filter="url(#shadow)"' : ""}${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
}

function line(x1, y1, x2, y2, options = {}) {
  const { stroke = C.line, sw = 2, dash = "", arrow = false, opacity = 1 } = options;
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}" opacity="${opacity}"${dash ? ` stroke-dasharray="${dash}"` : ""}${arrow ? ' marker-end="url(#arrowBlue)"' : ""}/>`;
}

function pill(x, y, w, label, options = {}) {
  const { fill = C.paleBlue, color = C.blue, stroke = "none", size = 14 } = options;
  return `${roundRect(x, y, w, 32, { fill, stroke, r: 16 })}${text(x + w / 2, y + 22, label, size, { fill: color, weight: 700, anchor: "middle" })}`;
}

function numberDot(x, y, n, color = C.blue) {
  return `<circle cx="${x}" cy="${y}" r="20" fill="${color}"/>${text(x, y + 7, String(n).padStart(2, "0"), 14, { fill: "#fff", weight: 800, anchor: "middle" })}`;
}

function arrow(x1, y1, x2, y2, color = C.blue, sw = 3, dash = "") {
  return `<path d="M ${x1} ${y1} L ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ""} marker-end="url(#arrowBlue)"/>`;
}

function panel(x, y, w, h, titleValue, subtitle, kind = "left") {
  const color = kind === "left" ? C.gray : C.blue;
  const labelFill = kind === "left" ? "#EFF1F4" : C.paleBlue;
  return [
    roundRect(x, y, w, h, { fill: "#FFFFFF", stroke: C.line, r: 6, shadow: true }),
    `<rect x="${x}" y="${y}" width="7" height="78" fill="${kind === "left" ? "#AEB4BE" : C.blue}"/>`,
    text(x + 28, y + 38, titleValue, 22, { fill: color, weight: 800 }),
    text(x + 28, y + 64, subtitle, 13, { fill: C.gray, weight: 500 }),
    pill(x + w - 194, y + 22, 166, kind === "left" ? "传统工作流" : "尖锋防务-3DPrintHub", { fill: labelFill, color, size: 11 }),
  ].join("");
}

function metricColumn(items, note) {
  const x = 1392;
  let y = 286;
  const content = [];
  content.push(text(x, 228, "关键提升", 18, { fill: C.gray, weight: 700, letterSpacing: 2 }));
  content.push(line(x, 242, 1827, 242, { stroke: C.line, sw: 1 }));
  for (const item of items) {
    content.push(`<path d="M ${x} ${y - 12} l 13 8 l -13 8 z" fill="${C.blue}"/>`);
    content.push(text(x + 28, y, item.kicker, 17, { fill: C.blue, weight: 800 }));
    content.push(multi(x + 28, y + 38, item.lines, item.size || 32, { fill: item.color || C.red, weight: 900, lineHeight: item.lineHeight || 39 }));
    y += item.height || 164;
  }
  content.push(roundRect(1388, 816, 444, 94, { fill: "#F8F9FB", stroke: C.line, r: 4 }));
  content.push(text(1414, 848, "边界说明", 14, { fill: C.gray, weight: 800 }));
  content.push(multi(1414, 875, note, 14, { fill: C.gray, weight: 500, lineHeight: 22 }));
  return content.join("");
}

function base({ index, eyebrow, titleSvg, subtitle, body, metrics, footer }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="7" stdDeviation="8" flood-color="#17357A" flood-opacity="0.11"/>
    </filter>
    <marker id="arrowBlue" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/>
    </marker>
    <linearGradient id="blueGrad" x1="0" x2="1">
      <stop offset="0" stop-color="#17357A"/>
      <stop offset="1" stop-color="#2F74E9"/>
    </linearGradient>
    <linearGradient id="darkGrad" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#222A38"/>
      <stop offset="1" stop-color="#10141C"/>
    </linearGradient>
    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
      <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#E8EBF1" stroke-width="1"/>
    </pattern>
    <clipPath id="clipWide"><rect x="0" y="0" width="530" height="210" rx="10"/></clipPath>
    <clipPath id="clipPrint"><rect x="0" y="0" width="518" height="150" rx="10"/></clipPath>
  </defs>
  <rect width="1920" height="1080" fill="#FFFFFF"/>
  <rect x="0" y="0" width="1920" height="1080" fill="url(#grid)" opacity="0.23"/>
  <rect x="0" y="0" width="1920" height="164" fill="#FFFFFF" opacity="0.95"/>
  <rect x="54" y="40" width="6" height="36" fill="${C.red}"/>
  ${text(76, 69, `技术突破 ${String(index).padStart(2, "0")}`, 25, { fill: C.ink, weight: 900 })}
  ${text(76, 101, eyebrow, 14, { fill: C.gray, weight: 700, letterSpacing: 1.5 })}
  ${titleSvg}
  ${text(366, 116, subtitle, 17, { fill: C.gray, weight: 500 })}
  <line x1="366" y1="139" x2="1865" y2="139" stroke="${C.blue}" stroke-width="2"/>
  ${body}
  ${metrics}
  <line x1="54" y1="1023" x2="1865" y2="1023" stroke="${C.line}" stroke-width="1"/>
  ${text(54, 1052, footer, 13, { fill: "#8B919C", weight: 500 })}
  ${text(1865, 1052, "尖锋防务-3DPrintHub", 12, { fill: "#A2A8B2", weight: 700, anchor: "end", letterSpacing: 1 })}
</svg>`;
}

function slide1(wireData, printData) {
  const leftX = 54, rightX = 714, py = 178, pw = 615, ph = 734;
  let body = panel(leftX, py, pw, ph, "普通 AI / 单点建模软件", "通常在“生成一张图或一个网格”处结束", "left");
  body += panel(rightX, py, pw, ph, "尖锋防务-3DPrintHub", "把模糊需求送入可检查、可回退的工程链", "right");

  body += pill(80, 277, 150, "自然语言 / 参考图", { fill: "#EFF1F4", color: C.gray });
  body += arrow(230, 293, 304, 293, "#AEB4BE", 3);
  body += `<circle cx="360" cy="293" r="52" fill="#EFF1F4" stroke="#C8CDD5" stroke-width="2"/>`;
  body += text(360, 304, "AI", 29, { fill: "#7B828D", weight: 900, anchor: "middle" });
  body += arrow(415, 293, 498, 293, "#AEB4BE", 3);
  body += pill(500, 277, 128, "图 / 网格", { fill: "#EFF1F4", color: C.gray });
  body += `<g transform="translate(96 363)" clip-path="url(#clipWide)"><image href="${wireData}" x="0" y="0" width="530" height="210" preserveAspectRatio="xMidYMid slice"/></g>`;
  body += roundRect(92, 596, 535, 157, { fill: C.paleRed, stroke: "#F2BBB6", r: 6, dash: "8 7" });
  body += text(112, 629, "交给工程端时，关键问题重新开始", 18, { fill: C.red, weight: 800 });
  body += pill(112, 651, 112, "尺寸未知", { fill: "#fff", color: C.red, stroke: "#F2BBB6", size: 13 });
  body += pill(238, 651, 112, "材料未知", { fill: "#fff", color: C.red, stroke: "#F2BBB6", size: 13 });
  body += pill(364, 651, 112, "工艺断档", { fill: "#fff", color: C.red, stroke: "#F2BBB6", size: 13 });
  body += pill(490, 651, 112, "版本失联", { fill: "#fff", color: C.red, stroke: "#F2BBB6", size: 13 });
  body += text(360, 793, "“看起来像”  ≠  “可以制造”", 24, { fill: C.gray, weight: 900, anchor: "middle" });

  const steps = [
    ["01", "说出需求", "文本 / 图像 / 圈选"],
    ["02", "AI 拆方案", "结构化计划与风险"],
    ["03", "规则卡边界", "Schema / 白名单 / 预算"],
    ["04", "工具真实执行", "CAD / 几何 / 切片"],
    ["05", "人工确认留档", "Revision / Hash / 工程包"],
  ];
  steps.forEach((step, i) => {
    const positions = [[742, 270], [927, 270], [1112, 270], [1112, 410], [927, 410]];
    const [x, y] = positions[i];
    body += roundRect(x, y, 164, 104, { fill: i === 2 ? C.paleBlue : "#FFFFFF", stroke: i === 2 ? C.blue : C.line, sw: i === 2 ? 2 : 1, r: 8 });
    body += text(x + 16, y + 27, step[0], 14, { fill: i === 2 ? C.red : C.blue, weight: 900 });
    body += text(x + 16, y + 55, step[1], 17, { fill: C.ink, weight: 800 });
    body += text(x + 16, y + 82, step[2], 12, { fill: C.gray, weight: 500 });
    if (i === 0 || i === 1) body += arrow(x + 166, y + 52, x + 182, y + 52, C.blue, 2);
    if (i === 3) body += arrow(x - 2, y + 52, x - 18, y + 52, C.blue, 2);
  });
  body += arrow(1235, 375, 1235, 406, C.blue, 2);
  body += `<g transform="translate(758 563)" clip-path="url(#clipPrint)"><image href="${printData}" x="0" y="0" width="518" height="150" preserveAspectRatio="xMidYMid slice"/></g>`;
  body += `<rect x="758" y="672" width="518" height="41" fill="#12255C" opacity="0.90"/>`;
  body += text(780, 699, "真实工具层：CAD 实体 → 切片结果 → 工程证据", 15, { fill: "#fff", weight: 700 });
  body += roundRect(758, 737, 518, 72, { fill: C.paleBlue, stroke: "#B8D0FF", r: 6 });
  body += text(780, 765, "最终交付不是一张效果图，而是能追溯来源的工程资产", 16, { fill: C.navy, weight: 800 });
  body += text(780, 791, "AI 提建议；确定性工具产出；工程师做最终判断。", 13, { fill: C.gray, weight: 500 });

  return base({
    index: 1,
    eyebrow: "技术原理示意图",
    titleSvg: rich(366, 72, [
      { text: "把“会生成”推进到", fill: C.blue },
      { text: "“能交付”", fill: C.red },
    ], 43),
    subtitle: "从一句模糊需求，到一个真正能继续加工的零件——中间每一步都必须留下证据。",
    body,
    metrics: metricColumn([
      { kicker: "输出形态", lines: ["从外观模型", "到工程资产"], height: 170 },
      { kicker: "核心机制", lines: ["5 段", "受控闭环"], height: 170 },
      { kicker: "生效边界", lines: ["人工签核", "才执行"], height: 160 },
    ], ["数字检查不等于物理验证；", "当前未打样、未量产放行。"]),
    footer: "依据：README / PRODUCT_BASELINE / 当前 Rev31 工程记录　·　对比对象为传统单点、文件串联工作流，非特定厂商",
  });
}

function slide2() {
  const leftX = 54, rightX = 714, py = 178, pw = 615, ph = 734;
  let body = panel(leftX, py, pw, ph, "传统多软件串联", "需求、建模、工艺、切片、版本散落在不同文件里", "left");
  body += panel(rightX, py, pw, ph, "尖锋防务-3DPrintHub", "六个主模块围绕同一个项目与 Revision 协同", "right");

  const apps = [
    ["聊天 / 文档", "需求"], ["文生 3D", "外观"], ["CAD 软件", "结构"],
    ["Excel / 资料夹", "工艺"], ["切片软件", "制造"], ["网盘 / 邮件", "交付"],
  ];
  apps.forEach((item, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 90 + col * 270, y = 272 + row * 150;
    body += roundRect(x, y, 235, 105, { fill: "#F7F8FA", stroke: "#D5D9E0", r: 8 });
    body += `<rect x="${x + 16}" y="${y + 18}" width="48" height="48" rx="10" fill="#E7E9ED"/>`;
    body += text(x + 40, y + 50, String(i + 1).padStart(2, "0"), 15, { fill: "#8C929C", weight: 900, anchor: "middle" });
    body += text(x + 82, y + 43, item[0], 17, { fill: C.text, weight: 800 });
    body += text(x + 82, y + 69, item[1] + "孤岛", 13, { fill: C.gray, weight: 500 });
  });
  body += arrow(325, 324, 360, 324, "#B7BCC5", 2, "7 6");
  body += arrow(207, 377, 207, 417, "#B7BCC5", 2, "7 6");
  body += arrow(478, 377, 478, 417, "#B7BCC5", 2, "7 6");
  body += arrow(325, 474, 360, 474, "#B7BCC5", 2, "7 6");
  body += arrow(207, 527, 207, 567, "#B7BCC5", 2, "7 6");
  body += arrow(478, 527, 478, 567, "#B7BCC5", 2, "7 6");
  body += roundRect(92, 729, 534, 102, { fill: C.paleRed, stroke: "#F1B7B2", r: 6 });
  body += text(115, 761, "STL_final_v3_真的最终版.zip", 18, { fill: C.red, weight: 800 });
  body += text(115, 793, "谁改过？对应哪台机器？检查是否仍有效？", 15, { fill: C.gray, weight: 600 });

  const cx = 1021, cy = 526;
  body += `<circle cx="${cx}" cy="${cy}" r="104" fill="url(#blueGrad)" filter="url(#shadow)"/>`;
  body += text(cx, cy - 18, "同一项目", 24, { fill: "#fff", weight: 900, anchor: "middle" });
  body += text(cx, cy + 18, "+ Revision", 22, { fill: "#fff", weight: 800, anchor: "middle" });
  body += pill(cx - 62, cy + 41, 124, "身份 · 版本 · 证据", { fill: "#FFFFFF", color: C.blue, size: 11 });
  const modules = [
    [1021, 284, "01", "设计工坊", "需求 / 模型 / Agent"],
    [796, 376, "02", "CAD 建模", "实体 / 装配 / 接口"],
    [1244, 376, "03", "工艺资料集", "机器 / 工艺 / 耗材"],
    [796, 676, "04", "离线切片", "3MF / G-code / 设置"],
    [1244, 676, "05", "项目与版本", "Revision / 恢复 / 历史"],
    [1021, 798, "06", "连接设置", "AI / Tripo / 本机执行器"],
  ];
  modules.forEach(([x, y, n, titleValue, sub]) => {
    const w = x === 1021 ? 244 : 215;
    const xx = x - w / 2;
    body += roundRect(xx, y - 49, w, 98, { fill: "#FFFFFF", stroke: C.blue, sw: 1.5, r: 8 });
    body += text(xx + 17, y - 17, n, 13, { fill: C.red, weight: 900 });
    body += text(xx + 17, y + 11, titleValue, 17, { fill: C.ink, weight: 800 });
    body += text(xx + 17, y + 34, sub, 11, { fill: C.gray, weight: 500 });
    const dx = cx - x, dy = cy - y;
    const len = Math.hypot(dx, dy);
    const x1 = x + (dx / len) * 58;
    const y1 = y + (dy / len) * 58;
    const x2 = cx - (dx / len) * 111;
    const y2 = cy - (dy / len) * 111;
    body += line(x1, y1, x2, y2, { stroke: "#78A2EC", sw: 2, dash: "6 5" });
  });
  body += pill(815, 866, 412, "工程包导出贯穿全部模块：零件 + 工艺 + 检查 + 版本", { fill: C.paleBlue, color: C.navy, size: 12 });

  return base({
    index: 2,
    eyebrow: "整个工作站包含哪些模块",
    titleSvg: rich(366, 72, [
      { text: "把 6 个软件孤岛，收进", fill: C.blue },
      { text: " 1 个工程工作站", fill: C.red },
    ], 43),
    subtitle: "不是把按钮搬到同一页，而是让需求、零件、工艺、切片和证据围绕同一工程身份流动。",
    body,
    metrics: metricColumn([
      { kicker: "工作台组成", lines: ["6 个", "主模块"], height: 164 },
      { kicker: "协同主线", lines: ["1 条", "版本链"], height: 164 },
      { kicker: "数据关系", lines: ["同一零件", "贯穿全链"], height: 164 },
    ], ["模块数量按当前主导航统计；", "不把未完成能力包装为现有功能。"]),
    footer: "依据：workbench.tsx 当前主导航　·　design / cad / processes / slicing / versions / connections　·　非特定软件逐项测评",
  });
}

function slide3() {
  const leftX = 54, rightX = 714, py = 178, pw = 615, ph = 734;
  let body = panel(leftX, py, pw, ph, "黑箱式 AI Agent", "模型直接碰业务数据与执行器，权限边界难说明", "left");
  body += panel(rightX, py, pw, ph, "尖锋防务-3DPrintHub · 受控 Agent", "四层分工，越往下权限越收紧", "right");

  body += roundRect(90, 268, 540, 430, { fill: "url(#darkGrad)", stroke: "#303746", r: 14, shadow: true });
  body += `<circle cx="360" cy="446" r="92" fill="#303A4B" stroke="#5F6B7D" stroke-width="2"/>`;
  body += text(360, 437, "AI", 42, { fill: "#FFFFFF", weight: 900, anchor: "middle" });
  body += text(360, 472, "全权操作", 16, { fill: "#C7CED9", weight: 600, anchor: "middle" });
  const targets = [
    [165, 330, "DB", "业务数据库"], [555, 330, "CAD", "本机执行器"],
    [165, 610, "FILE", "文件与版本"], [555, 610, "3D", "模型与切片"],
  ];
  targets.forEach(([x, y, icon, label]) => {
    body += `<circle cx="${x}" cy="${y}" r="46" fill="#1B212D" stroke="#697586" stroke-width="1.5"/>`;
    body += text(x, y + 7, icon, 17, { fill: "#D8DDE5", weight: 900, anchor: "middle" });
    body += text(x, y + 72, label, 13, { fill: "#B7C0CC", weight: 600, anchor: "middle" });
    body += arrow(360, 446, x, y, "#B6BEC9", 2);
  });
  body += pill(108, 735, 140, "可能越权", { fill: C.paleRed, color: C.red, stroke: "#F1B7B2" });
  body += pill(288, 735, 140, "可能重复执行", { fill: C.paleRed, color: C.red, stroke: "#F1B7B2" });
  body += pill(468, 735, 140, "结果难追溯", { fill: C.paleRed, color: C.red, stroke: "#F1B7B2" });
  body += text(360, 815, "模型说了算，系统只能事后猜发生了什么", 20, { fill: C.gray, weight: 800, anchor: "middle" });

  const layers = [
    [263, "L1", "界面层", "三维圈选 · 需求输入 · 人工审批 · 时间线", "TypeScript / Vinext", "#FFFFFF", C.line],
    [385, "L2", "编排层", "Planner → Executor → Verifier → Replanner", "Python / LangGraph", "#FFFFFF", C.line],
    [507, "L3", "工具网关层", "Schema 校验 · 白名单 · 幂等键 · 预算", "Tool Gateway", C.paleBlue, C.blue],
    [699, "L4", "真实能力层", "D1/R2 · Tripo · 本机 CAD · 工程校验", "Deterministic tools", "#F7F8FA", C.line],
  ];
  layers.forEach(([y, l, name, desc, tech, fill, stroke], i) => {
    const h = i === 2 ? 165 : 96;
    body += roundRect(744, y, 555, h, { fill, stroke, sw: i === 2 ? 2 : 1, r: 7 });
    body += text(766, y + 32, l, 14, { fill: i === 2 ? C.red : C.blue, weight: 900 });
    body += text(813, y + 34, name, 20, { fill: C.ink, weight: 900 });
    body += text(813, y + 65, desc, 14, { fill: C.text, weight: 600 });
    body += text(1278, y + 33, tech, 12, { fill: "#9AA0AA", weight: 600, anchor: "end" });
    if (i < layers.length - 1) body += arrow(1021, y + h + 4, 1021, y + h + 20, C.blue, 2);
  });
  const tools = ["应用设计变更", "创建 CAD 任务", "启动执行", "查询状态", "附加结果", "验证版本"];
  tools.forEach((label, i) => {
    const x = 759 + (i % 3) * 177, y = 596 + Math.floor(i / 3) * 40;
    body += pill(x, y, 165, `${i + 1}. ${label}`, { fill: "#FFFFFF", color: C.navy, stroke: "#B9CFFF", size: 11 });
  });
  body += roundRect(744, 805, 555, 60, { fill: C.paleRed, stroke: "#F1B7B2", r: 6 });
  body += text(766, 842, "人工批准前：0 次工程副作用　｜　白名单之外：一律拒绝", 15, { fill: C.red, weight: 800 });

  return base({
    index: 3,
    eyebrow: "技术实现原理解释图",
    titleSvg: rich(366, 72, [
      { text: "AI 手上没有钥匙，", fill: C.blue },
      { text: "它只能申请", fill: C.red },
    ], 43),
    subtitle: "AI 负责提出结构化计划；只有通过规则、人工门禁和白名单的动作，才能触达真实工程工具。",
    body,
    metrics: metricColumn([
      { kicker: "职责边界", lines: ["4 层", "逐级隔离"], height: 164 },
      { kicker: "可执行范围", lines: ["6 个", "白名单动作"], height: 164 },
      { kicker: "数据权限", lines: ["AI 无权", "直接写库"], height: 164 },
    ], ["AI 输出只是一份计划；", "几何与制造结论由确定性工具产生。"]),
    footer: "依据：Agent Service / Tool Gateway / RepairAction / ToolName　·　当前白名单 CAD 返工流程含 6 个确定性动作",
  });
}

function slide4() {
  const leftX = 54, rightX = 714, py = 178, pw = 615, ph = 734;
  let body = panel(leftX, py, pw, ph, "传统需求传递", "每换一个软件，就靠人重新解释一次", "left");
  body += panel(rightX, py, pw, ph, "尖锋防务-3DPrintHub · 需求传导", "同一份结构化约束随项目版本向下游传递", "right");

  const oldStages = [
    [270, "聊天截图", "“做得轻一点”"], [402, "需求文档", "缺少目标零件"],
    [534, "CAD 文件", "单位 / 接口丢失"], [666, "切片配置", "材料靠口头补"],
  ];
  oldStages.forEach(([y, titleValue, sub], i) => {
    body += roundRect(102, y, 478, 86, { fill: "#F7F8FA", stroke: "#D7DBE2", r: 8 });
    body += `<circle cx="142" cy="${y + 43}" r="24" fill="#E6E8EC"/>`;
    body += text(142, y + 49, String(i + 1), 14, { fill: "#838A95", weight: 900, anchor: "middle" });
    body += text(182, y + 35, titleValue, 17, { fill: C.text, weight: 800 });
    body += text(182, y + 61, sub, 13, { fill: C.gray, weight: 500 });
    if (i < oldStages.length - 1) {
      body += arrow(341, y + 88, 341, y + 124, "#B7BCC5", 2, "6 5");
      body += pill(432, y + 93, 135, ["语义损耗", "版本分叉", "参数漏传"][i], { fill: C.paleRed, color: C.red, stroke: "#F2B9B4", size: 12 });
    }
  });
  body += roundRect(102, 807, 478, 52, { fill: C.paleRed, stroke: "#F1B7B2", r: 6 });
  body += text(341, 840, "下游拿到的是文件，不是完整设计意图", 16, { fill: C.red, weight: 800, anchor: "middle" });

  body += roundRect(751, 263, 539, 118, { fill: C.paleBlue, stroke: "#AAC8FF", r: 8 });
  body += text(773, 293, "一次输入，组成“结构化需求包”", 18, { fill: C.navy, weight: 900 });
  const inputs = ["文字要求", "参考图", "三维圈选", "目标零件", "当前 Revision"];
  inputs.forEach((label, i) => body += pill(771 + (i % 3) * 164, 317 + Math.floor(i / 3) * 38, 148, label, { fill: "#FFFFFF", color: C.blue, stroke: "#BBD1FA", size: 12 }));
  body += arrow(1021, 385, 1021, 424, C.blue, 2);
  body += `<rect x="765" y="421" width="512" height="45" rx="22" fill="${C.navy}"/>`;
  body += text(1021, 450, "共同主键：project · part · revision · input hash · 约束", 13, { fill: "#FFFFFF", weight: 700, anchor: "middle" });
  const stages = [
    [770, 514, "01", "结构化计划", "动作 / 风险 / 检查"],
    [943, 514, "02", "CAD 设计", "参数 / 接口 / 来源"],
    [1116, 514, "03", "工艺绑定", "机器 / 工艺 / 耗材"],
    [770, 679, "04", "切片验证", "输入 / 设置 / 结果"],
    [943, 679, "05", "工程检查", "拓扑 / 装配 / 证据"],
    [1116, 679, "06", "工程包", "文件 / Hash / 历史"],
  ];
  stages.forEach(([x, y, n, titleValue, sub], i) => {
    body += roundRect(x, y, 152, 112, { fill: i === 5 ? C.paleBlue : "#FFFFFF", stroke: i === 5 ? C.blue : C.line, sw: i === 5 ? 2 : 1, r: 8 });
    body += text(x + 15, y + 27, n, 13, { fill: i === 5 ? C.red : C.blue, weight: 900 });
    body += text(x + 15, y + 57, titleValue, 16, { fill: C.ink, weight: 800 });
    body += text(x + 15, y + 84, sub, 11, { fill: C.gray, weight: 500 });
    if (i === 0 || i === 1 || i === 3 || i === 4) body += arrow(x + 154, y + 55, x + 169, y + 55, C.blue, 2);
  });
  body += arrow(1268, 626, 1268, 674, C.blue, 2);
  body += roundRect(765, 823, 512, 46, { fill: "#F8F9FB", stroke: C.line, r: 6 });
  body += text(1021, 852, "输入一变 → 旧检查自动转为 stale / historical，不覆盖历史", 13, { fill: C.gray, weight: 700, anchor: "middle" });

  return base({
    index: 4,
    eyebrow: "需求传导示意图",
    titleSvg: rich(366, 72, [
      { text: "需求只说一次，", fill: C.blue },
      { text: "后续每一步都带着同一份约束", fill: C.red },
    ], 40),
    subtitle: "需求不是一段会丢失的文字，而是绑定零件、版本、来源和检查状态的工程输入。",
    body,
    metrics: metricColumn([
      { kicker: "输入汇聚", lines: ["5 类输入", "合成一包"], height: 164 },
      { kicker: "贯穿标识", lines: ["Revision", "+ Hash"], height: 164 },
      { kicker: "变更机制", lines: ["旧结果", "自动失效"], height: 164 },
    ], ["“失效”表示需重新检查；", "系统保留历史，不伪造新结论。"]),
    footer: "依据：design-feedback-v1 / project revision / part identity / engineering package　·　需求传导为现有合同与状态的示意表达",
  });
}

function slide5(printData) {
  const leftX = 54, rightX = 714, py = 178, pw = 615, ph = 734;
  let body = panel(leftX, py, pw, ph, "传统返工流程", "人找人、文件找文件；失败后从头再来", "left");
  body += panel(rightX, py, pw, ph, "尖锋防务-3DPrintHub · 用户闭环", "一条 Run 从意图走到新工程版本", "right");

  const lanes = [["用户", 280], ["设计", 430], ["制造", 580]];
  lanes.forEach(([label, y]) => {
    body += text(95, y, label, 15, { fill: C.gray, weight: 800 });
    body += line(154, y - 6, 625, y - 6, { stroke: "#E0E3E8", sw: 1 });
  });
  const old = [
    [174, 244, "1", "说需求"], [392, 244, "2", "发截图"],
    [250, 394, "3", "改 CAD"], [488, 394, "4", "导 STL"],
    [192, 544, "5", "重新切片"], [436, 544, "6", "回传确认"],
  ];
  old.forEach(([x, y, n, label]) => {
    body += roundRect(x, y, 132, 66, { fill: "#F7F8FA", stroke: "#D5D9E0", r: 33 });
    body += `<circle cx="${x + 28}" cy="${y + 33}" r="18" fill="#E5E7EB"/>`;
    body += text(x + 28, y + 39, n, 12, { fill: "#7D848E", weight: 900, anchor: "middle" });
    body += text(x + 54, y + 40, label, 15, { fill: C.text, weight: 700 });
  });
  body += arrow(306, 277, 392, 277, "#B2B7C0", 2, "6 5");
  body += arrow(458, 310, 316, 393, "#B2B7C0", 2, "6 5");
  body += arrow(382, 427, 488, 427, "#B2B7C0", 2, "6 5");
  body += arrow(554, 460, 290, 543, "#B2B7C0", 2, "6 5");
  body += arrow(324, 577, 436, 577, "#B2B7C0", 2, "6 5");
  body += `<path d="M 502 610 C 630 660 620 338 530 313" fill="none" stroke="${C.red}" stroke-width="3" stroke-dasharray="9 7" marker-end="url(#arrowBlue)"/>`;
  body += pill(399, 661, 178, "信息不全 → 整轮返工", { fill: C.paleRed, color: C.red, stroke: "#F1B7B2", size: 13 });
  body += roundRect(92, 737, 534, 100, { fill: "#F8F9FB", stroke: C.line, r: 6 });
  body += text(114, 769, "常见摩擦", 14, { fill: C.gray, weight: 800 });
  body += text(114, 800, "等回复 · 找版本 · 重复操作 · 无法解释结果来源", 16, { fill: C.text, weight: 700 });

  const flow = [
    [747, 272, "01", "三维圈选 + 描述", "选中目标零件和区域"],
    [932, 272, "02", "Planner 拆方案", "缺信息先澄清"],
    [1117, 272, "03", "人工批准", "批准前不执行"],
    [747, 465, "04", "CAD 真实执行", "白名单工具 + 幂等"],
    [932, 465, "05", "Verifier 核验", "Hash / 来源 / 检查"],
    [1117, 465, "06", "新版本 + 工程包", "结果回到原工作台"],
  ];
  flow.forEach(([x, y, n, titleValue, sub], i) => {
    body += roundRect(x, y, 166, 118, { fill: i === 2 ? C.paleRed : (i === 5 ? C.paleBlue : "#FFFFFF"), stroke: i === 2 ? "#EB9F98" : (i === 5 ? C.blue : C.line), sw: (i === 2 || i === 5) ? 2 : 1, r: 9 });
    body += numberDot(x + 27, y + 29, Number(n), i === 2 ? C.red : C.blue);
    body += text(x + 16, y + 72, titleValue, 15, { fill: C.ink, weight: 800 });
    body += text(x + 16, y + 98, sub, 11, { fill: C.gray, weight: 500 });
    if (i === 0 || i === 1 || i === 3 || i === 4) body += arrow(x + 168, y + 58, x + 182, y + 58, C.blue, 2);
  });
  body += arrow(1283, 391, 1283, 459, C.blue, 2);
  body += `<path d="M 1008 586 C 1008 642 893 646 893 592" fill="none" stroke="${C.red}" stroke-width="2.5" stroke-dasharray="7 6" marker-end="url(#arrowBlue)"/>`;
  body += text(952, 672, "失败分类 → Replanner", 12, { fill: C.red, weight: 800, anchor: "middle" });
  body += `<g transform="translate(758 701)" clip-path="url(#clipPrint)"><image href="${printData}" x="0" y="0" width="518" height="150" preserveAspectRatio="xMidYMid slice"/></g>`;
  body += `<rect x="758" y="809" width="518" height="42" fill="#10245A" opacity="0.92"/>`;
  body += text(777, 836, "Checkpoint：刷新或等待后仍继续同一个 Run，不重复制造副作用", 12, { fill: "#FFFFFF", weight: 700 });

  return base({
    index: 5,
    eyebrow: "用户使用流程图",
    titleSvg: rich(366, 72, [
      { text: "从一句修改要求，到", fill: C.blue },
      { text: "一个可追溯的新版本", fill: C.red },
    ], 42),
    subtitle: "用户只需表达意图、确认计划和查看结果；等待、恢复、执行、核验由同一条工程 Run 管理。",
    body,
    metrics: metricColumn([
      { kicker: "用户主流程", lines: ["6 步", "形成闭环"], height: 164 },
      { kicker: "恢复能力", lines: ["刷新仍是", "同一 Run"], height: 164 },
      { kicker: "执行安全", lines: ["幂等避免", "重复副作用"], height: 164 },
    ], ["首个闭环限定为受控参数化 CAD 返工；", "不宣称任意网格都能自动改模。"]),
    footer: "依据：Planner → Approval → Executor → Verifier → Revision　·　同一 Run 可等待、恢复、重规划并保留事件时间线",
  });
}

async function dataUri(file) {
  const data = await fs.readFile(file);
  return `data:image/png;base64,${data.toString("base64")}`;
}

await fs.mkdir(OUT, { recursive: true });
const [wireData, printData] = await Promise.all([dataUri(WIRE), dataUri(PRINT)]);
const slides = [
  ["图01-技术原理对比图", slide1(wireData, printData)],
  ["图02-工作站模块对比图", slide2()],
  ["图03-受控Agent技术对比图", slide3()],
  ["图04-需求传导对比图", slide4()],
  ["图05-用户使用流程对比图", slide5(printData)],
];

for (const [name, svg] of slides) {
  const svgPath = path.join(OUT, `${name}.svg`);
  const pngPath = path.join(OUT, `${name}@2x.png`);
  await fs.writeFile(svgPath, svg, "utf8");
  await sharp(Buffer.from(svg))
    .resize(3840, 2160, { fit: "fill" })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .withMetadata({ density: 192 })
    .toFile(pngPath);
  console.log(pngPath);
}
