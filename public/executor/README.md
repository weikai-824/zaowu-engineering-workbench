# 本机自动建模：安装与使用

这是“造物工程工作台”的 Windows CAD 执行模块。网页负责保存任务与版本，本机负责实体计算；结果由浏览器回传到登录的工作区。它不会发送打印指令，也不执行任意 Python 或系统命令。

## 1. 准备目录与依赖

使用 Windows x64 和 Python 3.12。将交付包解压后，保留 `cad`、`executor` 两个子目录，在解压根目录打开 PowerShell。若从网站逐个下载，请按同样目录放置：

```text
cad/run_cad.py
cad/requirements-windows-py312.txt
executor/local_cad_relay.py
executor/requirements-controller-windows-py312.txt
```

分别安装 CAD 和连接控制器，依赖文件已锁定 wheel 指纹：

```powershell
py -3.12 -m venv cad-env
.\cad-env\Scripts\python.exe -m pip install --require-hashes --only-binary=:all: -r .\cad\requirements-windows-py312.txt
py -3.12 -m venv relay-env
.\relay-env\Scripts\python.exe -m pip install --require-hashes --only-binary=:all: -r .\executor\requirements-controller-windows-py312.txt
```

CAD 依赖较大，首次安装需联网下载。已验证的 CAD 组合为 Python 3.12.14、CadQuery 2.8.0、OCP 7.9.3.1.1、CasADi 3.8.0、NLopt 2.9.0。其他操作系统和版本未验证。控制器锁定 cryptography 50.0.1，用于签名。

## 2. 启动并配对

在上述根目录执行命令，窗口需要保持运行。使用本机演示域名 `http://www.3dprinthub.cn` 时执行：

```powershell
.\relay-env\Scripts\python.exe .\executor\local_cad_relay.py --origin "http://127.0.0.1" --registration-origin "http://www.3dprinthub.cn" --state-dir .\executor-state --cad-python .\cad-env\Scripts\python.exe --cad-runner .\cad\run_cad.py --port 8837 --label "CAD 工作站"
```

本地域名入口会把专用同源路径转发到 `127.0.0.1:8837`：`--origin` 锁定代理到执行器的回环请求，`--registration-origin` 则把设备登记签名绑定到浏览器地址栏中的演示域名。不要把 `--origin` 改成非 HTTPS 的公网域名。若使用正式 HTTPS 部署，可省略 `--registration-origin`，并把 `--origin` 改为浏览器地址栏中的精确 HTTPS 来源，例如 `https://example.com`，不带尾斜杠。

启动窗口显示 `pairCode`（8 位数字）。在工程台“CAD 建模 → 本机自动建模”中输入端口 8837 和配对码，点击“连接本机”。配对码 10 分钟内有效、只用一次；连接会话最多 12 小时。

本地域名演示通过同源桥接访问这台电脑上的 `127.0.0.1:8837`，不依赖跨域本地网络权限。正式 HTTPS 部署会由浏览器直接连接回环地址，届时可能显示“访问本地网络”权限提示；如不允许，自动通道不能工作，仍可使用任务文件交换。

除上述本地域名桥接外，`--origin` 必须与地址栏的网站来源完全一致，不带尾斜杠，且通常不需要设置 `--registration-origin`。开发环境需改成对应的 HTTP 回环来源，例如 `http://localhost:5173`；生产、开发和本地域名演示请使用不同状态目录。这两个参数都不是任意网站白名单。

## 3. 生成模型

1. 在 CAD 页添加或编辑参数设计，保持需要固定的孔位、接口和尺寸处于锁定状态。
2. 点击“保存并自动建模”。任务冻结本次设计版本、参数源和执行器指纹。
3. 本机会自动生成每件 STEP、BREP、STL、装配 STEP，以及建模步骤和检查报告。
4. “已计算并归档”出现后，点击对应记录的“加入当前设计”。旧参数结果不能覆盖新参数设计。

自动回传只归档文件，加入设计仍由工程师执行一次明确操作，避免覆盖正在编辑的草稿。当前几何词汇是受控基础实体、布尔运算、整体圆角和声明的 Z 轴直孔；复杂曲面、通用装配约束、Magics 自动分件尚不在此模块范围。

## 4. 断线、取消和重试

- 保持工程台标签页打开才能领取任务和回传。切到工程台其他页签不会停止回传。
- 刷新网页后，点击“恢复本页连接”。12 小时令牌只放在该标签页的 sessionStorage；不会把工作区 Cookie、AI 密钥或本机长期私钥传给另一端。
- 关闭标签页会失去该会话记录。本机正在执行的任务仍可继续；再次连接可能需要重启本机执行器以获得新配对码。重启时，尚未完成的任务记为“中断”，已完成文件保留。
- “暂停回传”不停止本机计算。“取消回传”使旧领取失效，旧结果不再接受；要重新计算，请点“重试”。失败任务不会自动无限重试。
- 一台执行器一次计算一个任务。断线时保留当前领取，重连后恢复；没有自动把过期领取分配给另一台机器。永久离线时须取消该任务，再安排后续任务。
- 撤销执行器会拒绝此身份的后续结果。需要重新登记时，使用新的 `--state-dir` 创建新身份；旧目录保留用于查看历史，不要随意删除。

## 5. 输出与核验边界

控制器在本机保存 SQLite 任务台账和文件，每次尝试都有固定编号。Ed25519 私钥由 Windows 当前用户 DPAPI 加密保存。任务和模型文件本身不加密、不自动清理，团队需管理磁盘容量和本机访问权限。

云端核验登记身份、领取编号、签名、输入及结果指纹，随后核对 CAD 文件清单和 STL 尺寸。它没有独立重跑 CAD。签名属于软件密钥来源证明，不能证明本机绝对可信，不能替代壁厚、载荷、配合、支撑、材料校准、实际打印或首件验收。

每个 CAD 子进程限时 180 秒，外层控制器限时 210 秒，并管理 Windows 进程组；没有内存硬配额。创建子进程后立即赋属进程组仍有很短的时间窗口，不构成硬件隔离保证。在线压缩结果上限 8 MB、展开上限 24 MB，每件 STL 最多 10 万三角面。

## 6. 常见问题

| 提示 | 处理方式 |
|---|---|
| Failed to fetch / 无法连接本机 | 检查窗口是否运行、端口、浏览器本地网络权限，以及启动 origin 是否与页面一致。 |
| 配对码失效或已使用 | 刷新后优先用“恢复本页连接”；否则重启执行器获取新码。 |
| Installed runner hash does not match | 下载与当前工作台匹配的 `cad/run_cad.py`；不要自行改写它或转换换行。 |
| Required compatible solver wheels | 按 CAD 锁文件安装到指定 cad-env，并确认 `--cad-python` 指向它。 |
| CAD build failed / 无有效实体 | 修改建模步骤；服务器不会把失败报告当成模型。 |
| 参数已变化 | 保存新参数并创建新任务；历史结果仍保留。 |

所有这些记录都是工程开发阶段证据。真实 AI/Tripo 调用、打印设备联调及“节约 90% 人工”仍需分别验证。
