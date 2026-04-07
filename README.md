# LLM OCR

基于多模态大语言模型的浏览器端 OCR 工具。通过 Vision API 或文件上传式 OCR API 从图片 / PDF 中提取文字，支持流式输出、LaTeX 公式渲染、PDF 处理和多格式导出，全程无需自建后端服务。

## 特性

- **LLM 驱动识别** — 基于多模态大模型完成识别，而非传统 OCR 引擎
- **多 Provider 支持** — 支持 `OpenAI Compatible`、`Gemini Native`、`DeepSeek-OCR API`
- **流式实时输出** — OpenAI / Gemini 路径通过 SSE 流式返回识别结果，逐字显示
- **多图批量处理** — 支持同时上传多张图片，基于 p-queue 任务队列自动管理并发
- **PDF 支持** — OpenAI / Gemini 路径自动逐页提取；DeepSeek-OCR 路径直接上传原始 PDF 文件
- **智能重试** — 429 / 5xx / 网络错误自动指数退避重试，尊重 `Retry-After` 响应头
- **队列满感知** — 检测服务端队列饱和后智能退避，最多重试 10 次
- **健康监控** — 根据 API 响应状态跟踪可用性（正常 / 降级 / 不可用），任务队列自动暂停和恢复
- **请求超时保护** — 每个请求 90 秒超时，防止队列死锁
- **IndexedDB 持久化** — 通过 Dexie.js 存入浏览器数据库，刷新页面后仍可恢复，兼容 WebKit / Safari
- **恢复优化** — 历史数据恢复时按需加载大图，并使用小型 LRU 缓存 object URL，避免一次性占满内存
- **缩略图持久化** — 缩略图持久化保存，缺失时后台受控并发补齐
- **EXIF 方向修正** — 自动检测并修正手机拍照的旋转方向
- **逐图状态追踪** — 缩略图条显示每张图片的独立状态徽章（排队中 / 处理中 / 完成 / 错误）
- **LaTeX 公式渲染** — 识别结果中的数学公式通过 KaTeX 实时渲染
- **客户端图片压缩** — Web Worker + OffscreenCanvas 后台压缩，不阻塞主线程；不支持时自动回退
- **批量持久化写入** — OCR 状态写入经缓冲后批量落库，减少高频 IndexedDB 压力

## 演示网站

https://ocr.yoshinagakoi.eu.org/

## 技术栈

| 类别 | 技术 | 用途 |
|------|------|------|
| 框架 | React 18 | UI 组件 |
| 构建 | Vite 6 | 开发服务器与打包 |
| 状态管理 | Context + useReducer | 页面中心化状态模型 |
| 持久化 | Dexie.js (IndexedDB) | 本地恢复与结果存储 |
| 任务队列 | p-queue | OCR 并发调度 |
| 事件总线 | mitt | 服务层与 UI 层解耦通信 |
| PDF 处理 | pdfjs-dist | PDF 页面提取 |
| 文档导出 | docx, file-saver | Word 文档生成与下载 |
| 数学渲染 | KaTeX | 数学公式渲染 |

## 项目结构

```text
src/
+-- index.tsx                    # 入口
+-- App.tsx                      # 主组件
+-- App.css                      # 全局样式与主题变量
+-- bootstrap.ts                 # 服务连接
+-- stores/
|   +-- pagesStore.tsx           # 页面状态
+-- db/
|   +-- index.ts                 # Dexie.js IndexedDB
+-- events/
|   +-- ocrEvents.ts             # 事件总线，OCR 生命周期事件
+-- services/
|   +-- ocrService.ts            # OCR 处理
|   +-- pagePersistence.ts       # OCR 状态批量持久化缓冲
|   +-- queueManager.ts          # p-queue 任务队列 + AbortController
|   +-- healthCheck.ts           # API 健康状态追踪
|   +-- pdfService.ts            # PDF 页面提取
|   +-- exportService.ts         # Markdown / 纯文本导出
|   +-- docxService.ts           # Word 文档导出
+-- components/
|   +-- UploadZone.tsx           # 上传区
|   +-- ImagePreview.tsx         # 图片 / PDF 预览与导航
|   +-- ImageModal.tsx           # 图片大图弹窗
|   +-- ResultPanel.tsx          # 识别结果 + 复制/导出下拉菜单
|   +-- SettingsDialog.tsx       # API 配置弹窗
|   +-- PageThumbnail.tsx        # 带状态徽章的缩略图
|   +-- HealthIndicator.tsx      # 顶栏健康状态指示器
|   +-- QueueStatus.tsx          # 队列任务计数器
|   +-- KaTeXLine.tsx            # LaTeX 行渲染器
|   +-- ErrorBoundary.tsx        # React 错误边界
+-- hooks/
|   +-- useSnackbar.ts           # 消息提示 hook
|   +-- useFocusTrap.ts          # 弹窗焦点陷阱 hook
+-- utils/
|   +-- compressImage.ts         # 图片压缩
|   +-- compressWorker.ts        # Web Worker 压缩脚本
|   +-- createThumbnail.ts       # 缩略图生成
|   +-- fetchImageFromUrl.ts     # URL 图片加载
|   +-- clientId.ts              # 持久化客户端 UUID
|   +-- exifFix.ts               # EXIF 方向自动修正
|   +-- browser.ts               # 浏览器检测
|   +-- fileAdditionQueue.ts     # 文件添加序列化
|   +-- logger.ts                # consola 带标签日志
+-- types/
|   +-- *.ts / *.d.ts            # API、页面、队列、事件等类型定义
+-- i18n/
    +-- index.ts                 # i18next 初始化 + 语言自动检测
    +-- locales/
        +-- zh-CN.ts             # 中文翻译
        +-- en.ts                # 英文翻译
tests/
+-- e2e/
    +-- fixtures/base-test.ts    # Playwright 基础 fixture
    +-- pages/AppPage.ts         # Page Object Model
    +-- specs/app.spec.ts        # 核心 UI 测试
    +-- specs/bootstrap.spec.ts  # 启动与恢复测试
    +-- specs/compress.spec.ts   # 大图压缩回归测试
    +-- specs/persistence.spec.ts # 持久化事务测试
    +-- specs/persistence-buffer.spec.ts # 批量写库缓冲测试
    +-- specs/providers.spec.ts  # Provider 请求构造测试
    +-- specs/streaming.spec.ts  # 流式进度节流测试
```

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 生产构建
npm run build

# 类型检查
npm run typecheck

# 预览构建产物
npm run preview

# 运行 E2E 测试
npx playwright install
npm run test:e2e

# 打开 Playwright UI
npm run test:e2e:ui
```

启动后，点击右上角设置图标，选择 Provider 并填写对应的 API 配置即可开始识别。

## 配置说明

所有配置均通过应用内设置弹窗管理，并保存在浏览器 `localStorage` 中。

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| Provider | `openai_compatible` | 请求协议类型 |
| API 地址 | `https://api.openai.com/v1` | 会随 Provider 自动切换默认值 |
| API 密钥 | 空 | 必填，对应 API 提供商的密钥 |
| 模型名称 | `gpt-5.4` | OpenAI / Gemini 路径使用；DeepSeek-OCR 不需要 |
| OCR 语言 | `auto` | 仅 DeepSeek-OCR 路径可选 |
| Prompt | 内置 OCR 转录提示词 | 支持自定义 |

### 支持的 API 提供商

应用通过设置页中的 Provider 显式选择请求协议：

| Provider | 默认 API 地址 | 请求格式 |
|----------|---------------|----------|
| OpenAI Compatible | `https://api.openai.com/v1` | `chat/completions` + `image_url` + stream |
| Gemini Native | `https://generativelanguage.googleapis.com/v1beta` | `streamGenerateContent` |
| DeepSeek-OCR API | `https://api.deepseek-ocr.ai/v1/ocr` | `multipart/form-data` 文件直传 |

#### OpenAI Compatible

适用于支持视觉输入的 OpenAI 兼容服务，例如：

- OpenAI 官方接口
- 通义千问兼容接口
- Gemini OpenAI 兼容模式
- 其他兼容 `chat/completions + image_url` 的代理服务

#### Gemini Native

适用于 Gemini 原生流式接口，例如 `gemini-2.5-flash` 一类模型。

#### DeepSeek-OCR API

适合文件上传式 OCR 场景，特点如下：

- 图片直接上传原始文件
- PDF 直接上传原始 PDF 文件
- 返回结果为非流式文本
- 不需要模型名

## 架构概览

```text
用户操作
    |
    v
App.tsx（UI 层）
    |
    v
fileAdditionQueue -----> pagesStore（Context + Reducer）
    |                         ^
    v                         |（事件监听）
queueManager (p-queue)        |
    |                    ocrEvents（mitt 事件总线）
    v                         ^
ocrService -------------------|
    |
    v
Provider-specific request
    |
    v
IndexedDB (Dexie.js) <--- pagePersistence（批量持久化缓冲）
```

## 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `←` / `→` | 切换图片 |
| `Escape` | 关闭弹窗 |
| `Ctrl+V` | 粘贴剪贴板图片 |
| `Tab` / `Shift+Tab` | 焦点导航 |

## 注意事项

- **并发控制**：任务队列默认最大并发数为 3，遇到限流时会自动退避
- **图片压缩**：OpenAI / Gemini 路径下，超过 2048px 分辨率或 1MB 时自动压缩后再上传；DeepSeek-OCR 路径直传原始文件
- **PDF 行为**：OpenAI / Gemini 路径会拆页后逐页识别；DeepSeek-OCR 路径会直接上传整份 PDF 文件
- **代码分割**：PDF 服务、导出服务、DOCX 生成器均为懒加载，首次使用时才下载
- **URL 协议**：仅支持 `https:` / `http:` / `data:` 协议，不支持本地 `file:` 路径
- **跨域限制**：通过 URL 加载图片受浏览器 CORS 策略约束；若目标服务器未开放跨域，建议直接上传文件

## 测试

```bash
npm run typecheck
npm run test:e2e
```

当前 E2E 主要覆盖：

- 启动与设置
- Provider 请求构造
- 图片压缩
- 流式输出节流
- 持久化事务与批量写库缓冲
- 历史数据恢复
- PDF 占位预览
- Provider 配置草稿保留

## 部署

项目已配置 Vercel 部署，推送到 GitHub 后可直接关联 Vercel 自动发布。

```bash
# 或使用 Vercel CLI
vercel --prod
```

## 许可证

MIT

## 致谢

本项目已在 [Linux do](https://linux.do/) 社区发布，感谢社区的支持与反馈。
