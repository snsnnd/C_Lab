# 07 · 开源项目调研与复用决策

核实日期：2026-10-07。证据来自官方项目页面、README、package.json 和许可证文件；**本轮没有下载构建或运行功能测试**。“待验证”不能在开发时直接改写成“支持”。

## 1. 结论

最值得先试的是 **Codecast**。它的产品定位就是 C 教学，已有步进执行相关底座；但完整平台部署不轻，必须先验证本地精简使用和离线改代码的能力。

**不要从零写底层引擎，也不要把找到一个开源仓库理解为所有需求都已经解决。**

## 2. 对比

| 项目 | 已核实定位/能力 | 许可依据 | 本项目用途 | 主要限制 |
|---|---|---|---|---|
| [Codecast](https://github.com/France-ioi/codecast) | C 教学平台，在线编码/录课；依赖 persistent-c，提供离线打包脚本 | 主仓库 MIT | 第一优先：试用、精简或二次开发 | c-to-json、包凭据、录课存储和本地部署需验证 |
| [persistent-c](https://github.com/France-ioi/persistent-c) | JavaScript C 逐步求值器，使用不可变数据结构 | 主仓库 MIT | 了解 Codecast 引擎边界，必要时薄适配 | 是引擎而非完整产品；缺少顶层 README，源码输入链路需核实 |
| [JSCPP](https://github.com/felixhao28/JSCPP) | 浏览器/Node 的 C++ 子集解释器，变量、数组、指针、流程、函数和调试 API | MIT | 局部单文件实验备选 | 不等于标准 C；不支持多文件；存在语义需核对项 |
| [React Flow](https://github.com/xyflow/xyflow) | React 节点、连线、缩放与交互库 | 开源核心 MIT | 模块依赖、接口替换、可交互关系图 | 不解释 C，也不会自动推断架构 |
| [Mermaid](https://github.com/mermaid-js/mermaid) | 文本生成流程、状态、时序等图 | 官方 README 标明 MIT | 讲义与静态架构图 | 不是逐步骤程序动画引擎 |
| [Motion](https://github.com/motiondivision/motion) | UI 动画库 | 开源仓库 MIT | 图元出现、位移和过渡 | 不提供 C 运行数据；付费扩展另计 |

## 3. Codecast：为什么最匹配，为什么还需试验

### 确认事实

- 官方仓库描述为 “Codecast C learning platform”。
- 官方提供 [生产试用入口](https://codecast.france-ioi.org/v5/) 与 [开发试用入口](https://codecast.france-ioi.org/next/)。本轮只核实链接来自 README，没有实际测试页面行为。
- 本轮读取的 package.json 标记版本 7.7.0，含 React、Ace、Node/Express 和 `@france-ioi/persistent-c` 依赖。这是读取时的分支状态，不当作已验证发布版本。
- README 要求取得 `c-to-json`，提供 Linux 二进制下载方式。
- 完整部署说明含 MySQL、S3、Git 子模块和 GitHub Packages 凭据。
- 存在 `build-lib`、`pack-offline` 脚本；离线章节还提到 archive-builder。

### 值得复用的部分

现有代码编辑、执行/步进工作流、C 状态展示思路与播放器。自有开发集中在中文教学内容、课程组织、投屏和架构实验。

### 不能由 README 直接推出的结论

- 不能确认它离线包支持任意新 C 源码转换。
- 不能确认移除录课后可以完全省去数据库/存储配置。
- 不能确认全部结构体、枚举、函数指针和多文件课程都兼容。
- 不能确认当前 Linux 转换工具能直接用于 Windows/macOS。
- 主仓库 MIT 不自动覆盖所有工具、资源、子模块和分发二进制，选定提交后需记录依赖许可证。

复用决策：先给 2–3 个工作日验证预算，跑通课程关键样本；优先用完整底座减少内部拆解，不先深挖解析器。

## 4. JSCPP：轻量，但只能谨慎局部采用

### 已核实

- 官方定义为 JavaScript 编写的简单 C++ 解释器。
- 提供 `run`、debug 模式、下一步、变量查询和 Web Worker 示例。
- README 的支持清单包含数组、指针、分支、循环、函数和作用域。
- README 明确列出 **multiple files support 未实现**。
- changelog 将部分函数指针参数支持标为实验性；不能据此保证所有回调用法。

### 与基础 C 教学相关的问题

- C 与 C++ 并不等价；需要用课程中的 `.c` 例子做实际兼容性测试。
- README 将无符号溢出描述为未定义行为并默认报错，而标准 C 的无符号算术遵循模运算。这个文档/配置差异足以要求专项验证，不能直接教给学生。
- 标准库是部分实现，基础输入输出也必须逐例确认。
- 当前代码在现代 Node/浏览器上的安装和构建情况没有在本轮测试。

复用决策：保留备选，仅使用已经通过验证的课程子集；不为“省底层开发”而承担修复完整语言语义的新项目。

## 4b. 最终选定的组合

| 组件 | 角色 | 许可 |
|---|---|---|
| [tree-sitter-c](https://github.com/tree-sitter/tree-sitter-c) | 解析 C 语法树，含 struct/enum/函数指针/typedef | MIT |
| [web-tree-sitter](https://github.com/tree-sitter/tree-sitter) | 在 Web Worker 中运行解析器 | MIT |
| 本项目 `src/engine/c/*` | 类型系统、字节内存、逐步求值器、标准库 | 项目自有 |

实测：tree-sitter-c 对含 `struct`、`enum`、`typedef`、函数指针与自引用结构体指针的示例**零错误解析**。

用自研求值器而不是「找到一个解释器」，是因为**没有现成的浏览器内 C 引擎同时具备这四项能力**。求值器使用扁平字节内存，输出与 `gcc -std=c17` 逐行对照一致。

## 5. Python Tutor / C Tutor：可立即体验的参考，不当作已确认开源底座

[Python Tutor 官网](https://pythontutor.com/) 明确提供 C/C++ 的变量、指针、数据结构和调用帧可视化，可通过 [C Tutor](https://pythontutor.com/c.html) 体验这种教学形式。

但本轮尝试访问历史上常被引用的 `pgbovine/OnlinePythonTutor` 仓库地址返回 404，未核实到与当前服务对应、许可及本地部署链路均清晰的完整 C 版本。

因此：

- 可用作课堂工具体验和交互参考。
- 不列入“已经确认能 fork 后离线分发”的清单。
- 不默认嵌入第三方页面，也不自动把学生源码上传至该服务。
- 404 只说明本轮这个地址不可用，不等于断言不存在历史开源版本或其他可用仓库。

## 6. 可以直接省下的工作

| 能复用的通用能力 | 我们需要做的产品内容 |
|---|---|
| 编辑器、执行器、步进能力 | 中文课程、课时顺序、误区说明 |
| 节点、连线、缩放 | 模块职责、接口含义、重构场景 |
| 图元位移和透明度过渡 | 动作时机、因果解释、提问停点 |
| 文本生成流程/时序图 | 与源码对应的真实课堂案例 |

美术重点是**统一的教学图形语言与分镜**，不是从零画一套重型素材。

## 7. 一手来源

1. [Codecast README](https://github.com/France-ioi/codecast#readme)
2. [Codecast package.json](https://github.com/France-ioi/codecast/blob/master/package.json)
3. [Codecast LICENSE](https://github.com/France-ioi/codecast/blob/master/LICENSE)
4. [persistent-c 仓库](https://github.com/France-ioi/persistent-c) 与 [LICENSE](https://github.com/France-ioi/persistent-c/blob/master/LICENSE)
5. [JSCPP README](https://github.com/felixhao28/JSCPP#readme) 与 [LICENSE](https://github.com/felixhao28/JSCPP/blob/master/LICENSE)
6. [xyflow README](https://github.com/xyflow/xyflow#readme)
7. [Mermaid README](https://github.com/mermaid-js/mermaid#readme)
8. [Motion LICENSE](https://github.com/motiondivision/motion/blob/main/LICENSE.md)
9. [Python Tutor 官网](https://pythontutor.com/)

实施时锁定具体提交和依赖版本；本次对比分支文档不构成版本兼容性保证。
