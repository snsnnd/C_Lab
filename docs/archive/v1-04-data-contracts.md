# 04 · 数据模型、事件协议与课程包

> 历史协议草案，已由 [轻量数据协议](../04-data-contracts.md) 替代。不要据此为首版实现完整调试服务。

以下是 v0 协议草案，用于实施对齐；实际开发需补充 JSON Schema 和兼容性测试。

## 1. 核心实体

| 实体 | 关键字段 |
|---|---|
| ProjectRevision | `projectId`、文件列表、内容哈希、保存时间 |
| Run | `runId`、`revisionHash`、`buildProfile`、stdin、环境、状态、能力清单 |
| SourceLocation | 相对文件路径、行列/区间、可选符号；无法确定列时允许为空 |
| Type | 稳定 typeId、类型种类、大小、目标类型、字段/偏移 |
| Frame | frameId、函数符号、调用深度、可用的源码位置 |
| Object | objectId、frameId/分配代次、类型、地址、生命周期、值状态 |
| Event | runId、序号、类别、源位置、证据来源、payload |
| Snapshot | seq、可见帧、对象、输出游标、当前停点 |
| Lesson | 课程标识、前置知识、源码、输入、视图配置和验收条件 |

整数值使用带类型的十进制/十六进制字符串承载，避免 JavaScript 对 64 位整数的精度损失。字节缓冲使用明确编码，不能把任意 C 字符串字节默认当作有效 UTF-8。

## 2. 事件信封示例

```json
{
  "schemaVersion": "0.1",
  "runId": "run-example-001",
  "revisionHash": "sha256:<source-and-config-hash>",
  "seq": 27,
  "kind": "object.updated",
  "source": { "file": "main.c", "line": 9, "column": null },
  "evidence": {
    "origin": "debugger",
    "granularity": "stop-delta"
  },
  "payload": {
    "objectId": "frame-1:local-sum:life-1",
    "before": { "status": "known", "typeId": "int32", "value": "3" },
    "after": { "status": "known", "typeId": "int32", "value": "6" }
  }
}
```

此例表达“到本停点时发现 sum 从 3 变为 6”，不表达“第 9 行唯一执行了一次写入”。变量的初始化有效性尚未确认时，不得使用 `known` 伪装语义确定。

`seq` 在同一次运行严格递增，是回放顺序依据；时间戳仅用于性能和输出观察，不用来推导 C 表达式求值顺序。

### 事件种类与保证

| 类别 | 作用 | 能力要求 |
|---|---|---|
| `run.started / run.finished` | 运行元数据和终态 | 所有运行 |
| `compile.diagnostic` | 警告或错误，含原始消息 | 编译器适配 |
| `execution.stopped` | 当前停留位置及原因 | L2 |
| `snapshot.available` | 可索引的完整状态 | L2 |
| `object.discovered / updated / expired` | 对象发现、状态变化、生命周期结束 | L2，部分结束原因可能未知 |
| `frames.changed` | 当前帧集合 | L2，不等同于完整调用事件日志 |
| `stdout.chunk / stderr.chunk` | 分流输出及流内序号 | L1；精确源码对应可能未知 |
| `branch.observed` | 有证据的分支结果 | L3 专项能力 |
| `call.enter / call.return` | 已捕获的调用/返回 | 入口/返回跟踪能力 |
| `heap.allocated / heap.freed` | 已跟踪的堆生命周期 | 分配跟踪能力 |
| `runtime.diagnostic` | 异常、Sanitizer 报告等 | 对应诊断运行 |
| `trace.truncated` | 轨迹达到限额 | 所有采集模式 |

事件可带教学解释引用，但展示语言不参与回放状态计算。采样未观测到的读取不能生成 `memory.read` 假事件。

## 3. 内存对象与指针

### 对象身份

- 局部对象：运行 ID + 调用帧 ID + 符号/词法作用域 + 生命周期代次。
- 全局对象：运行 ID + 模块 + 符号。
- 堆对象：运行 ID + 分配序号；地址复用后必须产生新身份。
- 子对象：父对象 ID + 字段路径或索引。

不能仅用变量名：递归、同名局部变量和不同文件的静态变量会冲突。不能仅用地址：释放后地址可能再次分配。

### 值状态

`known`、`unknown`、`uninitialized`（有分析依据）、`out-of-scope`、`freed`、`unavailable`、`truncated`。

其中 `unknown` 表示语义/有效性未知，`unavailable` 表示工具无法取得。`optimized-out` 可作为 unavailable 原因，为未来优化构建预留。

### 指针显示

记录地址字符串、指针类型、可选目标对象 ID、字节偏移和解析状态。区分：

- 空指针；
- 已知对象内部；
- 尾后地址；
- 已释放对象的历史地址；
- 未解析地址；
- 函数地址/符号。

“地址落入已知对象范围”只是关系匹配，不是完整的 C 指针来源和访问合法性证明。前端不得主动要求后端无限追踪地址图。

## 4. 拟定本地 API

| 方法和路径 | 作用 |
|---|---|
| `GET /api/health` | 服务、运行器与工具链状态 |
| `GET /api/capabilities` | 标准、目标平台、可视化能力和限制 |
| `GET /api/lessons` | 课程索引 |
| `GET /api/lessons/{id}` | 课程包元数据与素材入口 |
| `POST /api/projects` | 创建或导入本地项目 |
| `PUT /api/projects/{id}/files` | 保存受控文件集，返回 revisionHash |
| `POST /api/runs` | 提交指定源码版本、stdin 和受控构建档位 |
| `GET /api/runs/{id}` | 查询状态、能力、诊断和摘要 |
| `GET /api/runs/{id}/events` | SSE 流，支持断线续接 |
| `GET /api/runs/{id}/trace?fromSeq=...` | 分页获取已保存轨迹 |
| `POST /api/runs/{id}/cancel` | 幂等取消任务 |
| `GET /api/runs/{id}/snapshots/{seq}` | 获取指定快照或最近基准快照 |

运行请求传项目版本与配置，不传宿主路径、shell 命令或任意编译参数。提交返回 `202` 和 runId；资源占满返回清晰的 busy 状态，不无限排队。

SSE 使用序号作为事件 ID，续接按 `Last-Event-ID`；保留期已过则返回需要重新载入的错误。前端按 runId 和 seq 去重，缺失事件先补齐再回放。使用同源会话机制，令牌不放在 URL 中。

## 5. 状态机

运行主状态：

`created → validating → compiling → collecting → completed`

分支终态：`compile_failed / runtime_failed / timed_out / cancelled / infrastructure_failed / rejected`。

达到轨迹限额时停止采集/执行并记录 `finishReason=trace_limit`，显著标记不完整，不能展示为完整正常退出。

前端播放状态独立为 `idle / buffering / paused / playing / ended`。采集完成不意味着播放完成，用户暂停播放也不等于暂停沙箱进程。

首版的“下一步”默认消费已记录事件；真正交互式暂停进程并继续执行属于另一个模式，需要后续单独设计。

## 6. 课程包草案

```text
lessons/07-array-sum/
  lesson.json
  README.zh-CN.md
  teacher-notes.md
  starter/main.c
  variants/off-by-one/main.c
  assets/
  assertions.json
```

`lesson.json` 至少定义：

- `schemaVersion`、`id`、`title`、`objectives`、`prerequisites`。
- `projectFiles`、`entryFunction`、默认 stdin、工具链档位。
- `requiredCapabilities`：声明需要哪些能力，不支持时给出替代视图。
- `visualization`：首选视图、关注符号、标注和提问点。
- `steps`：教学步骤，通过符号/源锚点关联；避免只绑定会随编辑漂移的固定行号。
- `referenceCases`：输入、期望输出、语义轨迹条件。
- `notes`：平台相关说明、UB 提醒、模型与实测边界。

用户自由编辑后，锚点解析失败应显示“课程专属标注已失效”，保留通用可视化，不强行套用旧讲解。

课程包是数据，不允许随包执行任意 Python/JS 插件。需要新图示时通过受测试的内置组件注册。

## 7. 持久化与导出

- 项目源码与运行快照分开保存；每次运行保留不可变输入。
- 运行清单记录编译器/调试器版本、目标三元组、ABI 信息、flags、镜像 digest 和协议版本。
- 原始地址可用于单次运行查看，跨运行对比按对象角色与语义状态归一化。
- 默认导出源码、课程版本、stdin 和运行配置；轨迹作为可选附件，避免文件膨胀。
- 清理旧轨迹时保留用户项目，界面告知清理策略；具体容量由实际测量决定。
- 预录轨迹记录生成环境和源码哈希，离线查看始终标注“参考回放”。
