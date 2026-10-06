# 可重复的本地验证

需要 Node.js 24 及项目锁文件安装的依赖。在项目根目录执行：

```text
node validation/glb-fixtures.cjs
node validation/tripo-submit.cjs
node validation/tripo-webhook.cjs
```

顺序不能颠倒：第一步生成第二步使用的测试 GLB。生成文件与结果写入 Git 忽略的 `work/validation/`。

- GLB：19 个合成样例，包括实际顶点尺寸、共享网格实例、内嵌贴图、异常几何、外部资源及未支持扩展。
- Tripo：27 项提交、回执与回收状态测试；执行项目真实 TypeScript 和 SQLite 事务，替换供应商网络与 R2 为测试实现。任何检查未通过时返回非零退出码。
- 不读取真实密钥、不调用真实供应商、不写生产数据库、不操作打印机。
- 不能用此测试证明真实 Tripo API 可用、浏览器贴图解码正确、Cloudflare D1/R2 线上联调通过或产品可制造。真实账户和实机验收需另外执行。

## 网格拓扑诊断

```text
node validation/topology.cjs
node --max-old-space-size=320 validation/topology-budget.cjs vertex
node --max-old-space-size=320 validation/topology-budget.cjs edge
```

第一条运行 33 个几何、数值容差及输入快照案例。后两条独立验证不同顶点和边预算超限，需先执行第一条生成被测模块。均在本地运行，不访问真实账户；结果在 work/validation/topology-review/。

分析器用于三角网格拓扑，未检测自交、壳内外关系、壁厚、装配干涉或制造性能。30 万三角面、30 万不同顶点及 60 万边是当前浏览器任务的处理预算，不是所有模型都能在任意设备上完成的性能保证。浏览器有 45 秒超时保护；上述 Node 测试不代替真实浏览器验收。

## STL 与切片工程完整几何关联

```text
node validation/slice-geometry.cjs
```

运行 39 个实际校验器案例，输入为随源码附带的合成 100 mm 底座历史任务及其真实 Bambu 离线结果；包含三角重排/平移、孔和绕向变化、隐藏修改器、打印覆盖、重复 XML 几何容器与数字/编码解释差异。失败返回非零退出码；输出到 `work/validation/slice-geometry/`。

测试使用既有真实文件和修改后的反例，不调用 Bambu、不联网、不访问真实账户、不打印，也没有验证刀路推导或实体产品。历史样例的 `savedPartBinding` 为 `legacy_unverified`；本轮新任务的服务器原资产重建、真实切片与 HTTP 回传证据在另行交付的“几何关联-核验记录.json”中。
