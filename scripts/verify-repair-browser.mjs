import { chromium } from "playwright-core";

const projectId = process.env.REPAIR_TEST_PROJECT_ID;
const pairingCode = process.env.REPAIR_TEST_PAIR_CODE;
if (!projectId || !/^\d{8}$/.test(pairingCode ?? "") || process.env.REPAIR_TEST_APPROVE !== "1") {
  throw new Error("Set REPAIR_TEST_PROJECT_ID, REPAIR_TEST_PAIR_CODE and REPAIR_TEST_APPROVE=1 before running.");
}

const url = `http://www.3dprinthub.cn/?project=${projectId}`;
const baseline = await (await fetch(`http://127.0.0.1:8787/api/projects?id=${projectId}`)).json();
const browser = await chromium.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
  args: ["--no-sandbox", "--no-proxy-server", "--host-resolver-rules=MAP www.3dprinthub.cn 127.0.0.1", "--disable-features=HttpsUpgrades"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("response", (response) => {
  if (/__local-cad-executor\/(?:pair|status)|\/api\/execution\/(?:devices|runs)/.test(response.url())) {
    console.log("network", response.status(), new URL(response.url()).pathname);
  }
});
const shots = ".sites-runtime";

try {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator(".nav-project-title").getByText(baseline.title).waitFor({ timeout: 30000 });
  await page.locator(".part-row").filter({ hasText: "warm-white sculpted lower shell" }).click();
  await page.locator(".repair-executor-setup summary").click();
  await page.getByRole("textbox", { name: "本机执行器配对码" }).fill(pairingCode);
  await page.getByRole("button", { name: "连接本机", exact: true }).click();
  try {
    await page.locator(".repair-executor-setup[data-connected]").waitFor({ timeout: 20000 });
  } catch (error) {
    console.error("pairing panel", await page.locator(".repair-executor-setup").innerText());
    console.error("toasts", await page.locator("[data-sonner-toast]").allInnerTexts());
    await page.screenshot({ path: `${shots}/repair-e2e-pairing-failed.png` });
    throw error;
  }
  console.log("paired local CAD executor");

  await page.getByRole("button", { name: "圈选修改区域" }).click();
  const center = [760, 535];
  const rx = 88;
  const ry = 42;
  await page.mouse.move(center[0] + rx, center[1]);
  await page.mouse.down();
  for (let index = 1; index <= 32; index++) {
    const angle = (2 * Math.PI * index) / 32;
    await page.mouse.move(center[0] + rx * Math.cos(angle), center[1] + ry * Math.sin(angle));
  }
  await page.mouse.up();
  await page.getByText("修改区域已标记").waitFor({ timeout: 10000 });
  const target = await page.locator(".design-feedback-anchor-copy").innerText();
  if (!target.includes("白色外壳")) throw new Error(`Wrong circle target: ${target}`);
  await page.screenshot({ path: `${shots}/repair-e2e-selection.png` });
  console.log("selection", target.replaceAll("\n", " · "));

  await page.locator("#edit-request").fill("将白色机身总宽从 136 mm 调整为 137 mm，四个 M3 安装孔和 USB-C 接口的位置、尺寸保持不变；其余零件不修改。");
  await page.getByRole("button", { name: "生成返工计划" }).click();
  await page.locator(".agent-inspector").waitFor({ timeout: 90000 });
  let action = "";
  for (let retry = 0; retry < 90; retry++) {
    action = await page.locator(".agent-run-header h3").innerText();
    if (["等待人工审批", "等待补充信息", "任务失败"].includes(action)) break;
    await page.waitForTimeout(1000);
  }
  if (action === "等待补充信息") {
    const answers = page.locator(".agent-approval label textarea");
    for (let index = 0; index < await answers.count(); index++) {
      await answers.nth(index).fill("当前白色机身总宽 136 mm，目标 137 mm；四个 M3 安装孔中心、孔径和前侧 USB-C 接口的位置与尺寸都保持原值，其余零件不变。");
    }
    await page.getByRole("button", { name: "提交并重规划" }).click();
    await page.getByRole("button", { name: "批准并执行" }).waitFor({ timeout: 90000 });
  } else if (action !== "等待人工审批") {
    throw new Error(`Planner did not reach approval: ${action}`);
  }
  const planText = await page.locator(".agent-plan").innerText();
  if (!planText.includes("outer_width") || !planText.includes("137")) throw new Error(`Unexpected plan: ${planText.slice(0, 1000)}`);
  await page.screenshot({ path: `${shots}/repair-e2e-approval.png` });
  console.log("approval reached", planText.slice(0, 220).replaceAll("\n", " "));

  await page.getByRole("button", { name: "批准并执行" }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${shots}/repair-e2e-executing.png` });
  let finalStatus = "";
  for (let retry = 0; retry < 180; retry++) {
    finalStatus = await page.locator(".agent-run-header h3").innerText();
    if (["返工完成", "任务失败", "已取消"].includes(finalStatus)) break;
    await page.waitForTimeout(1000);
  }
  await page.screenshot({ path: `${shots}/repair-e2e-final.png` });
  if (finalStatus !== "返工完成") throw new Error(`Repair did not succeed: ${finalStatus}`);
  const updated = await (await fetch(`http://127.0.0.1:8787/api/projects?id=${projectId}`)).json();
  const width = updated.cadDesigns?.[0]?.parameters?.outer_width?.value;
  if (width !== 137 || updated.revision < baseline.revision + 2) throw new Error(`Unexpected result v${updated.revision} width ${width}`);
  console.log(JSON.stringify({ status: finalStatus, projectId, baselineRevision: baseline.revision, finalRevision: updated.revision, width, parts: updated.parts.length }));
} finally {
  await browser.close();
}
