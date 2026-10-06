# 造物工程台：参考离线切片

这个脚本将工程台保存的单个零件任务交给本机 Bambu Studio，生成可以回存的结果包。它只做离线切片，不发送打印。

## 使用

1. 工程台“离线切片”页选择零件，下载任务 ZIP。
2. 安装 Python 3.10+，并使用已验证的 Bambu Studio 02.08.02.60。当前程序及核心 DLL 的 SHA-256 固定；更新 Bambu 后必须重新验证，不能直接删除校验。
3. 将本脚本保存为 run_offline.py，在命令行执行：

   `python run_offline.py task.zip`

   如需指定独立输出目录：`python run_offline.py task.zip --output-dir D:/AI3D/offline-runs`

4. 把命令输出路径中的 offline-result.zip 导入工程台对应任务。

脚本只使用 Python 标准库。默认软件路径为 `C:/Program Files/Bambu Studio/bambu-studio.exe`；可用 `--slicer` 指向同一已验证程序的其他安装位置。不会扫描软件目录、访问生产机台或寻找密钥。每次使用新的独立工作目录，不覆盖之前结果。

## 固定配置

X1 Carbon / 0.4 mm nozzle / Bambu PLA Basic / 0.20 mm Standard / Cool Plate，喷嘴 220 °C、平台 35 °C，壁圈 2、填充 15%，单色，支撑关闭。输入为毫米、Z-up；排版移动并落床，`--allow-rotations=0` 保持朝向。不得把这一组参考参数当作任意材料、设备或零件的通用最优参数。

单个 STL 不超过 20 MB、在线完整几何关联不超过 10 万三角面，各轴大于 0 且不超过 240 mm；单零件单盘。大型 ASCII STL（超过 8 MB）及 OBJ（超过 4 MB）需要先在工程执行器中转换；这些文本解析限制不等于打印机尺寸或模型能力。回传 ZIP 不超过 8 MB，解压内容有独立预算。这些是当前实现范围，不是打印设备的全部能力。

## 结果与证据

结果包含实际切片器导出的 sliced.3mf、effective-settings.json、slicer-result.json、process-log.txt，以及关联原任务的 report.json。

新任务在服务器根据保存参数或原始 STL/OBJ/静态 GLB 重建几何，按 STL Float32 编码约定与提交 STL 比较。导回时，网页重新读取保存的 STL，解析实际 3MF 的 build、component、mesh 和打印盘实例，对全部有向三角面建立一一对应，并核对原任务、文件指纹、18 项关键设置与 G-code 层数。结果归档不会把工程草稿或首件检查改成合格。重复的相同结果可再次导入；同一任务不能用不同结果覆盖，请创建新任务保留每次运行。

这是未经数字签名的本地报告。哈希用于核对文件一致性，不构成独立执行认证。几何对应容差为 0.00001 mm，允许整件排版平移、面顺序变化和循环顶点重排，不允许旋转、缩放、镜像、孔洞/内壳改变或反向面。只对当前固定 Bambu 方言做解释：未知结构、涂色/支撑属性、修改器或零件级打印覆盖明确拒绝。这个数值容差不是打印精度，也不是原始 CAD 精度证明。旧任务仍可归档其实际 STL 与 3MF 对应结果，但保存零件绑定标为 legacy_unverified，旧报告不会被自动升级。

完整网格对应没有证明 G-code 确由该网格生成；报告可由本地客户端重写，因此仍需可信常驻执行器、签名与生产首件验收。没有完整 OPC/3MF 重开编辑验收、强度校核、设备/材料实物绑定或实体打印验证。

## 来源

参考配置来自本机官方 Bambu Studio 02.08.02.60 安装资源；展开前的 17 个来源文件及其 SHA-256 见 source-provenance.json。上游源代码及配置版权、许可归原权利人所有：

- https://github.com/bambulab/BambuStudio
- https://github.com/bambulab/BambuStudio/wiki/Command-Line-Usage
- https://github.com/bambulab/BambuStudio/blob/master/LICENSE

程序调用策略依据官方 CLI；负布尔值采用 `--allow-rotations=0`，不是该版本不支持的 `--no-allow-rotations`。
