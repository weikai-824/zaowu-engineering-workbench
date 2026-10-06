"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { ThemeProvider } from "next-themes";

export type AppLocale = "zh-CN" | "en";

type LanguageContextValue = {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  toggleLocale: () => void;
  t: (key: keyof typeof interfaceCopy) => string;
};

const interfaceCopy = {
  brandTagline: { "zh-CN": "中国3D打印产品设计开发一站式工作站", en: "China's One-stop 3D Printing Product Design Workstation" },
  login: { "zh-CN": "登录", en: "Sign in" },
  demoAccount: { "zh-CN": "演示账户", en: "Demo account" },
  demoAccountName: { "zh-CN": "访客设计师", en: "Guest Designer" },
  demoAccountHint: { "zh-CN": "登录入口仅用于界面演示，未连接真实账户系统。", en: "UI demonstration only. No account service is connected." },
  themeLight: { "zh-CN": "切换到白天模式", en: "Switch to light mode" },
  themeDark: { "zh-CN": "切换到黑夜模式", en: "Switch to dark mode" },
  language: { "zh-CN": "切换界面语言", en: "Switch interface language" },
  workspaceState: { "zh-CN": "工程工作区 · 实机验证待完成", en: "Engineering workspace · Production validation pending" },
  navDesign: { "zh-CN": "设计工坊(非参数化建模)", en: "Design Studio (Non-parametric)" },
  navCad: { "zh-CN": "CAD 建模(参数化建模)", en: "CAD Modeling (Parametric)" },
  navProcesses: { "zh-CN": "工艺资料集设置", en: "Process Library" },
  navOutput: { "zh-CN": "输出结果", en: "Output Results" },
  navVersions: { "zh-CN": "项目版本", en: "Project Versions" },
  navConnections: { "zh-CN": "连接设置", en: "Connections" },
  unsaved: { "zh-CN": "有未保存修改", en: "Unsaved Changes" },
  synced: { "zh-CN": "已同步", en: "Synced" },
  notSaved: { "zh-CN": "尚未保存", en: "Not Saved" },
} as const;

const exactEnglish: Record<string, string> = {
  "正在打开工程工作区…": "Opening engineering workspace…",
  "设计工坊(非参数化建模)": "Design Studio (Non-parametric)",
  "CAD 建模(参数化建模)": "CAD Modeling (Parametric)",
  "工艺资料集设置": "Process Library",
  "输出结果": "Output Results",
  "项目版本": "Project Versions",
  "连接设置": "Connections",
  "产品需求": "Product Brief",
  "项目名称": "Project Name",
  "设计要求": "Design Requirements",
  "例如：整体约 155 × 100 × 35 mm，低矮横向圆角机身，哑光白色一体外壳，较小的纯黑无字显示窗嵌入顶面…": "Example: approximately 155 × 100 × 35 mm, a low-profile horizontal rounded enclosure, a seamless matte white shell, and a smaller blank black display inset into the top…",
  "外形比例由这里的长 × 宽 × 高决定；下面的尺寸只控制成品导入后的整体大小。": "Define the width × depth × height proportions here; the size below only scales the imported result.",
  "新项目": "New Project",
  "导入模型": "Import Model",
  "保存版本": "Save Version",
  "参数化底座": "Parametric Base",
  "可选": "Optional",
  "未启用": "Disabled",
  "需要承托或展示平台时再开启": "Enable when a support or display platform is needed",
  "设置": "Settings",
  "加入单张图片": "Add One Image",
  "加入多视图": "Add Multi-view",
  "生成三维方案": "Generate 3D Concepts",
  "应用领域": "Application",
  "文创与玩具": "Creative & Toys",
  "工业产品": "Industrial Product",
  "成品最长边 / mm": "Longest Finished Edge / mm",
  "应与设计要求中的最长边一致。": "Match the longest edge stated in the design requirements.",
  "优先工艺": "Preferred Process",
  "连接方式": "Assembly Method",
  "螺丝": "Screw",
  "胶接": "Adhesive",
  "一体": "One Piece",
  "计划数量": "Planned Quantity",
  "约束条件": "Constraints",
  "模型版本": "Model Version",
  "面数上限": "Face Limit",
  "方案数量": "Variants",
  "纹理质量": "Texture Quality",
  "纹理对齐": "Texture Alignment",
  "几何质量": "Geometry Quality",
  "标准": "Standard",
  "高清": "Detailed",
  "极高": "Extreme",
  "设置参数集": "Configure Profile",
  "调整参数集": "Adjust Profile",
  "多视图参考": "Multi-view Reference",
  "选择方案": "Choose Plan",
  "上传图片": "Upload Images",
  "检查确认": "Review",
  "上一步": "Back",
  "继续": "Continue",
  "重新开始": "Start Over",
  "确认使用": "Use These Views",
  "快速双视图": "Quick Two-view",
  "推荐三视图": "Recommended Three-view",
  "完整四视图": "Complete Four-view",
  "入门": "Starter",
  "推荐": "Recommended",
  "最佳": "Best",
  "正面": "Front",
  "背面": "Back",
  "左侧": "Left",
  "右侧": "Right",
  "CAD 工程建模": "CAD Engineering",
  "创建外壳参数设计": "Create Enclosure Design",
  "添加支架参数设计": "Add Bracket Design",
  "参数设计": "Parametric Designs",
  "文件交换方式": "File Exchange Workflow",
  "实体生成记录": "Solid Generation Records",
  "保存并自动建模": "Save & Build Automatically",
  "保存并下载建模任务": "Save & Download CAD Task",
  "编辑建模步骤": "Edit Modeling Steps",
  "下载 CAD 执行器": "Download CAD Executor",
  "安装与操作说明": "Installation & Guide",
  "工程参数 JSON": "Engineering Parameters JSON",
  "校验并应用到草稿": "Validate & Apply to Draft",
  "任务文件": "Task File",
  "导入结果": "Import Result",
  "加入当前设计": "Add to Current Design",
  "当前设计": "Current Design",
  "导出私有参数包": "Export Private Profile Pack",
  "企业私有": "Private",
  "设备照片待补充": "Equipment photo pending",
  "待保存": "Unsaved",
  "已保存": "Saved",
  "人工复审与工程判断": "Human Review & Engineering Assessment",
  "学习": "Learning",
  "学习闭环": "Learning Loop",
  "复审反馈": "Review Feedback",
  "工程判断": "Engineering Assessment",
  "经验沉淀": "Knowledge Capture",
  "下一轮优化": "Next Iteration",
  "本轮案例是否纳入经验": "Include This Case in Experience?",
  "纳入": "Include",
  "不纳入": "Exclude",
  "尚未选择": "Not Selected",
  "已选择纳入": "Selected: Include",
  "已选择不纳入": "Selected: Exclude",
  "由人工筛选高价值案例，纳入后沉淀为可复用经验并进入 Skill。": "Human reviewers select high-value cases, turn them into reusable experience, and add them to the Skill.",
  "筛选后再更新 Skill": "Update the Skill after screening",
  "工程草稿": "Engineering Draft",
  "尚未生产验证": "Production Not Validated",
  "导出本地工程结果": "Export Local Engineering Result",
  "结果导出历史": "Export History",
  "导出本地": "Export Locally",
  "版本锁定": "Version Locked",
  "来源追溯": "Source Traceability",
  "复审留痕": "Review Audit Trail",
  "可重复下载": "Repeatable Download",
  "再次下载": "Download Again",
  "暂无工程结果导出记录": "No engineering exports yet",
  "离线试切执行台": "Offline Slicing Console",
  "展开工作区": "Open Workspace",
  "本项目的离线任务": "Offline Tasks for This Project",
  "刷新记录": "Refresh Records",
  "任务包": "Task Pack",
  "结果包": "Result Pack",
  "连接适配器尚未接入，当前可先选择并查看规划状态。": "The adapter is not connected yet. You can select it to review its planned status.",
  "从 3DPrintHub Core 到工业建模、切片和 AI 服务，按制造链路查看当前能力与扩展方向。": "Review current capabilities and expansion paths across 3DPrintHub Core, industrial modeling, slicing, and AI services.",
  "版本": "Version",
  "统一项目、几何资产、工艺资料与执行证据的核心底座": "Core foundation for projects, geometry assets, process data, and execution evidence",
  "新项目目标": "Target for New Projects",
  "现有项目目标": "Target for Current Projects",
  "旧工程目标": "Legacy Project Target",
  "目标版本": "Target Version",
  "工业建模与切片工具连接器": "Industrial Modeling & Slicing Connectors",
  "单击选择工具，并对当前真实可用链路执行集成测试": "Select a tool and run an integration test on currently available paths",
  "建模与预处理": "Modeling & Preparation",
  "切片与制造": "Slicing & Production",
  "贴图与布线": "Texturing & Routing",
  "硬表面建模": "Hard-surface Modeling",
  "软表面建模": "Organic Modeling",
  "打印预处理": "Print Preparation",
  "FDM 切片": "FDM Slicing",
  "SLA 切片": "SLA Slicing",
  "金属 / 全彩切片": "Metal / Full-color Slicing",
  "按设备型号匹配": "Match by Device Model",
  "当前可用路径": "Currently Available Paths",
  "当前选择": "Current Selection",
  "工业工具链集成测试": "Industrial Toolchain Integration Test",
  "检查本机 CAD 状态、服务端任务通道、Bambu 离线链路，并标明尚未接入的工具。": "Checks local CAD status, server task channels, and the Bambu offline path, while identifying tools not yet connected.",
  "开始测试": "Run Test",
  "重新测试": "Test Again",
  "正在逐项检查连接链路": "Checking Connector Paths",
  "测试结果返回后会在这里按连接器展示。": "Results will appear here for each connector.",
  "集成测试结果": "Integration Test Results",
  "AI 连接器": "AI Connectors",
  "单击选择 AI 能力，并通过一次集成测试核对共享服务链路": "Select an AI capability and verify shared service paths with one integration test",
  "多模态输入识别": "Multimodal Input",
  "三维方案生成": "3D Concept Generation",
  "工艺选型推理": "Process Selection Reasoning",
  "扩展模型": "Expansion Model",
  "当前服务": "Current Service",
  "服务系列": "Service Family",
  "当前模型": "Current Model",
  "分析引擎": "Analysis Engine",
  "使用位置": "Used In",
  "AI 连接器集成测试": "AI Connector Integration Test",
  "验证通用 AI 最小响应、Tripo 模型与账户接口，以及工艺推理共享链路。通用 AI 探测会产生极少量 Token。": "Verifies the generic AI response, Tripo model and account APIs, and the shared process-reasoning path. The generic probe uses very few tokens.",
  "已通过": "Passed",
  "可用": "Available",
  "历史验证": "Previously Verified",
  "待接入": "Planned",
  "未通过": "Failed",
  "可测试": "Testable",
  "已配置": "Configured",
  "尚未配置": "Not Configured",
  "可查看": "Available",
  "单击已选中": "Selected",
  "当前已连接": "Connected Now",
  "历史已验证": "Previously Verified",
  "可本机配对": "Ready to Pair Locally",
  "当前可执行": "Executable Now",
  "可导入离线结果": "Offline Import Ready",
  "有未保存修改": "Unsaved Changes",
  "已同步": "Synced",
  "尚未保存": "Not Saved",
  "项目与版本": "Projects & Versions",
  "已保存项目": "Saved Projects",
  "版本记录": "Version History",
  "更多生成方式": "More Generation Options",
  "三维预览 · 实际尺寸": "3D Preview · Actual Scale",
  "制造件": "Manufacturing",
  "制造零件": "Manufacturing Parts",
  "参考件": "Reference",
  "对比": "Compare",
  "默认渲染": "Default Render",
  "未渲染": "Unrendered",
  "半透明": "Translucent",
  "爆炸图": "Exploded",
  "爆炸视图": "Exploded View",
  "俯视": "Top",
  "圈选修改区域": "Mark Revision Area",
  "主视图": "Main View",
  "侧面": "Side",
  "拖动旋转 · 滚轮缩放 · 点击定位 · 圈选标记改版区域": "Drag to rotate · Scroll to zoom · Click to focus · Mark an area for revision",
  "拖动旋转 · 点击零件 / 悬停卡片查看映射": "Drag to rotate · Click a part or hover a card to inspect its mapping",
  "生成返工计划": "Create Rework Plan",
  "零件与工程检查": "Parts & Engineering Checks",
  "零件名称": "Part Name",
  "工程选择依据": "Engineering Rationale",
  "方案取舍": "Design Trade-offs",
  "尚未配置机器、工艺与耗材参数集": "Machine, process, and material profile not configured",
  "熔融挤出": "Fused Deposition Modeling",
  "光固化": "Vat Photopolymerization",
  "聚合物粉末床": "Polymer Powder Bed",
  "金属粉末床": "Metal Powder Bed",
  "材料喷射": "Material Jetting",
  "本机自动建模": "Local Automatic CAD",
  "未连接本机": "Local Workstation Not Connected",
  "等待配对": "Waiting to Pair",
  "本机端口": "Local Port",
  "8 位配对码": "8-digit Pairing Code",
  "连接本机": "Connect Workstation",
  "下载完整执行器包": "Download Full Executor Pack",
  "安装与连接说明": "Setup & Connection Guide",
  "本机执行器": "Local Executor",
  "当前项目的执行记录": "Execution Records for This Project",
  "已计算并归档": "Calculated & Archived",
  "记录": "Record",
  "任务": "Task",
  "执行来源签名已核验；实机未验证": "Execution source signature verified; production not validated",
  "桌面智能环境监测终端 · 精密玻璃仪器": "Desktop Smart Environment Monitor · Precision Glass Instrument",
  "机身总宽 / mm": "Body Width / mm",
  "玻璃与后盖净宽 / mm": "Glass & Back-cover Width / mm",
  "机身肩线圆角 / mm": "Body Shoulder Radius / mm",
  "企业私有工艺库": "Private Enterprise Process Library",
  "稳定母版受控保存；项目调整不会覆盖原始参数集。": "Controlled master profiles are preserved; project changes never overwrite the source profiles.",
  "01 / 组合选择": "01 / PROFILE SELECTION",
  "机器 → 工艺 → 耗材": "Machine → Process → Material",
  "机器": "Machine",
  "工艺": "Process",
  "耗材": "Material",
  "选择机器": "Select Machine",
  "选择工艺": "Select Process",
  "选择耗材": "Select Material",
  "搜索机型、耗材或工艺": "Search machines, materials, or processes",
  "没有匹配机型。": "No matching machine.",
  "内部固化母版保持只读；当前编辑内容保存为项目副本，不会覆盖企业参数资产。": "The controlled master remains read-only. Edits are saved as a project copy and never overwrite enterprise assets.",
  "内部母版 · 可创建项目副本": "Controlled Master · Project Copy Available",
  "内部边界资料": "Controlled Boundary Data",
  "项目副本已保存": "Project Copy Saved",
  "质量": "Quality",
  "强度": "Strength",
  "速度": "Speed",
  "支撑": "Support",
  "其他": "Other",
  "保存后生成当前项目的受控参数副本，并进入版本记录。": "Saving creates a controlled project copy and records it in version history.",
  "保存项目参数副本": "Save Project Profile Copy",
  "保存目标组合": "Save Target Profile",
  "该工艺使用受控边界参数集": "This process uses a controlled boundary profile",
  "当前组合可绑定到项目；完整执行参数由对应设备工艺包管理，生产前仍需首件复核。": "This profile can be assigned to the project. Full execution parameters remain managed by the machine process pack and require first-article review.",
  "AI 私有工艺匹配": "AI Private Process Matching",
  "分析当前项目": "Analyze Current Project",
  "正在分析…": "Analyzing…",
  "先保存当前参数副本，再让 AI 读取。": "Save the current profile copy before AI analysis.",
  "AI 建议": "AI Recommendation",
  "规则初筛": "Rule-based Screening",
  "查看建议组合": "View Recommended Profile",
  "当前配置去向": "Where This Configuration Is Used",
  "进入 CAD 建模": "Open CAD Modeling",
  "用于当前零件": "Assign to Current Part",
  "参数集已绑定不等于切片成功或实机验证。": "An assigned profile does not prove successful slicing or production validation.",
  "私有参数依据与适用边界": "Private Parameter Basis & Boundaries",
  "内部参数": "Internal Parameter",
  "受控值": "Controlled Value",
  "使用边界": "Usage Boundaries",
  "将产品结构、制造资源与人工复审放在同一视图中，确认后生成可追溯的本地工程结果。": "Review product structure, manufacturing resources, and human decisions in one view, then generate a traceable local engineering result.",
  "未保存": "Not Saved",
  "工艺待定": "Process Pending",
  "工艺已指派": "Process Assigned",
  "零件制造映射": "Part Manufacturing Map",
  "逐件绑定设备、工艺、耗材与私有参数集": "Assign a machine, process, material, and private profile to each part",
  "制造设备": "Manufacturing Device",
  "适用耗材": "Material",
  "私有参数集": "Private Profile",
  "内部固化": "Controlled",
  "层高": "Layer Height",
  "目标壁厚": "Target Wall",
  "内部填充": "Infill",
  "启用支撑": "Supports",
  "关闭": "Off",
  "人工已复审": "Human Reviewed",
  "结构分解": "Structure Breakdown",
  "工艺映射": "Process Mapping",
  "人工复审": "Human Review",
  "结果导出": "Result Export",
  "逐件确认可打印性与承载、装配风险。这里记录的是人工意见，不代表已完成仿真、实机测试或生产验收。": "Review printability, load, and assembly risks for each part. These are human decisions, not completed simulation, machine testing, or production approval.",
  "易打印性": "Printability",
  "受力与装配": "Load & Assembly",
  "人工确认": "Approve",
  "需修改": "Revise",
  "记录打印朝向、支撑、薄壁、受力路径或装配间隙等判断依据…": "Record reasoning about orientation, supports, thin walls, load paths, or assembly clearances…",
  "先添加制造零件，才能进行人工复审。": "Add manufacturing parts before starting human review.",
  "复审通过后": "After Review Approval",
  "再生成工程结果": "Generate the Engineering Result",
  "当前结论": "Current Decision",
  "全部人工确认": "All Parts Approved",
  "等待逐件确认": "Awaiting Part Reviews",
  "等待制造零件": "Awaiting Manufacturing Parts",
  "保存复审记录": "Save Review Record",
  "复审已保存": "Review Saved",
  "生成含制造零件、工艺映射、已有检查与切片记录的工程包，并附上本次人工复审记录。每次导出独立归档，可反复下载。": "Generate an engineering package containing manufacturing parts, process mappings, checks, slicing records, and this review. Each export is archived independently.",
  "每条记录对应一次独立导出；重复下载不会更改原始文件。": "Each record is an independent export. Re-downloading never changes the original file.",
  "工程结果包": "Engineering Result Pack",
  "历史版本": "Historical Version",
  "当前配置": "Current Configuration",
  "正在读取导出记录…": "Loading Export Records…",
  "载入前自动保存当前修改；历史版本恢复为新的草稿。": "Current changes are saved before loading; a historical version is restored as a new draft.",
  "刷新": "Refresh",
  "还没有已保存项目，先在设计工坊保存版本。": "No saved projects yet. Save a version in the Design Studio first.",
  "选择保存在此浏览器；实际服务状态以连接诊断为准。": "The selection is stored in this browser; actual service status is determined by diagnostics.",
};

const textRules: Array<[RegExp, string]> = [
  [/^(\s*)选择 (\d+) 张图片(\s*)$/, "$1Select $2 Images$3"],
  [/^(\s*)多视图 (\d+) 张(\s*)$/, "$1Multi-view · $2 Images$3"],
  [/^(\s*)已就绪 · (\d+) 张视图(\s*)$/, "$1Ready · $2 Views$3"],
  [/^(\s*)(\d+)\/([0-9]+) 已确认(\s*)$/, "$1$2/$3 Confirmed$4"],
  [/^(\s*)(\d+) 项通过 · (\d+) 项可用或已验证 · (\d+) 项待接入(.*)$/, "$1$2 passed · $3 available or verified · $4 planned$5"],
  [/^(\s*)目标版本 (.*)$/, "$1Target Version $2"],
  [/^(\s*)已启用 · (.*)$/, "$1Enabled · $2"],
  [/^(\s*)(\d+) 套私有工艺组合 · (\d+) 项内部参数。按机器、工艺、耗材选择并生成项目参数副本。(\s*)$/, "$1$2 private profiles · $3 internal parameters. Select a machine, process, and material to create a project copy.$4"],
  [/^(\s*)(\d+) 款机器 · (\d+) 套受控组合(\s*)$/, "$1$2 machines · $3 controlled profiles$4"],
  [/^(\s*)(\d+) 项内部参数(\s*)$/, "$1$2 internal parameters$3"],
  [/^(\s*)(\d+) 项项目设置(\s*)$/, "$1$2 project settings$3"],
  [/^(\s*)(\d+) 个零件 · 工程草稿(\s*)$/, "$1$2 parts · Engineering draft$3"],
  [/^(\s*)每格 (.*)$/, "$1Grid $2"],
  [/^(\s*)(\d+)\/(\d+) 已绑定(\s*)$/, "$1$2/$3 Assigned$4"],
  [/^(\s*)层高 (.*)$/, "$1Layer Height $2"],
  [/^(\s*)目标壁厚 (.*)$/, "$1Target Wall $2"],
  [/^(\s*)内部填充 (.*)$/, "$1Infill $2"],
  [/^(\s*)启用支撑 (.*)$/, "$1Supports $2"],
];

function translatePresentationText(value: string) {
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  const core = value.slice(leading.length, value.length - trailing.length);
  const exact = exactEnglish[core];
  if (exact) return `${leading}${exact}${trailing}`;
  for (const [pattern, replacement] of textRules) {
    if (pattern.test(value)) return value.replace(pattern, replacement);
  }
  return value;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);
const originalText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
const localizedAttributes = ["placeholder", "title", "aria-label"];
const localeStorageKey = "3dprinthub.locale";
const localeChangeEvent = "3dprinthub:locale-change";

function storedLocale(): AppLocale {
  return window.localStorage.getItem(localeStorageKey) === "en" ? "en" : "zh-CN";
}

function subscribeLocale(onStoreChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === localeStorageKey) onStoreChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(localeChangeEvent, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(localeChangeEvent, onStoreChange);
  };
}

function shouldSkip(node: Node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return !!element?.closest("script, style, code, pre, [data-no-translate]");
}

function localizeNode(node: Node, locale: AppLocale) {
  if (shouldSkip(node)) return;
  if (node.nodeType === Node.TEXT_NODE) {
    const textNode = node as Text;
    const current = textNode.nodeValue ?? "";
    if (!current.trim()) return;
    if (locale === "en") {
      const previous = originalText.get(textNode);
      if (!previous || (current !== previous && current !== translatePresentationText(previous))) originalText.set(textNode, current);
      const translated = translatePresentationText(originalText.get(textNode) ?? current);
      if (translated !== current) textNode.nodeValue = translated;
    } else {
      const source = originalText.get(textNode);
      if (source && current !== source) textNode.nodeValue = source;
    }
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const element = node as Element;
  let stored = originalAttributes.get(element);
  for (const attribute of localizedAttributes) {
    const current = element.getAttribute(attribute);
    if (!current) continue;
    if (locale === "en") {
      stored ??= new Map<string, string>();
      const previous = stored.get(attribute);
      if (!previous || (current !== previous && current !== translatePresentationText(previous))) stored.set(attribute, current);
      const translated = translatePresentationText(stored.get(attribute) ?? current);
      if (translated !== current) element.setAttribute(attribute, translated);
    } else {
      const source = stored?.get(attribute);
      if (source && current !== source) element.setAttribute(attribute, source);
    }
  }
  if (stored) originalAttributes.set(element, stored);
  for (const child of Array.from(element.childNodes)) localizeNode(child, locale);
}

function PresentationLocalizer({ locale }: { locale: AppLocale }) {
  useEffect(() => {
    const root = document.body;
    localizeNode(root, locale);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") localizeNode(mutation.target, locale);
        if (mutation.type === "attributes") localizeNode(mutation.target, locale);
        mutation.addedNodes.forEach((node) => localizeNode(node, locale));
      }
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: localizedAttributes });
    return () => observer.disconnect();
  }, [locale]);
  return null;
}

function LanguageProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore<AppLocale>(subscribeLocale, storedLocale, () => "zh-CN");
  const setLocale = useCallback((next: AppLocale) => {
    window.localStorage.setItem(localeStorageKey, next);
    window.dispatchEvent(new Event(localeChangeEvent));
  }, []);
  const toggleLocale = useCallback(() => setLocale(storedLocale() === "zh-CN" ? "en" : "zh-CN"), [setLocale]);
  const t = useCallback((key: keyof typeof interfaceCopy) => interfaceCopy[key][locale], [locale]);
  const value = useMemo(() => ({ locale, setLocale, toggleLocale, t }), [locale, setLocale, toggleLocale, t]);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
  }, [locale]);
  return <LanguageContext.Provider value={value}>{children}<PresentationLocalizer locale={locale} /></LanguageContext.Provider>;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange><LanguageProvider>{children}</LanguageProvider></ThemeProvider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used inside AppProviders");
  return context;
}
