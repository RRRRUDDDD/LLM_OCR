# LLM OCR

基于多模态大语言模型的智能文字识别工具。通过 Vision API 从图片中提取文字，支持流式输出、LaTeX 公式渲染、PDF 处理、多格式导出。纯浏览器端运行，无需后端服务。

## 特性

- **LLM 驱动识别** — 使用多模态大模型进行文字识别，非传统 OCR 引擎
- **流式实时输出** — 通过 SSE 流式返回识别结果，逐字显示
- **多图批量处理** — 支持同时上传多张图片，基于 p-queue 任务队列自动管理并发
- **PDF 支持** — 上传 PDF 文件后自动逐页提取，每页独立处理
- **智能重试** — 429 / 5xx / 网络错误自动指数退避重试，尊重 `Retry-After` 响应头
- **队列满感知** — 检测服务端队列饱和后智能退避，最多重试 10 次
- **健康监控** — 根据 API 响应状态跟踪可用性（正常 / 降级 / 不可用），任务队列自动暂停和恢复
- **请求超时保护** — 每个请求 90 秒超时，防止队列死锁
- **IndexedDB 持久化** — OCR 结果通过 Dexie.js 存入浏览器数据库，刷新页面不丢失，兼容 WebKit/Safari
- **EXIF 方向修正** — 自动检测并修正手机拍照的旋转方向
- **逐图状态追踪** — 缩略图条显示每张图片的独立状态徽章（排队中 / 处理中 / 完成 / 错误）
- **LaTeX 公式渲染** — 识别结果中的数学公式通过 KaTeX 实时渲染
- **客户端图片压缩** — Web Worker + OffscreenCanvas 后台压缩，不阻塞主线程；不支持时自动回退

## 演示网站

https://ocr.yoshinagakoi.eu.org/

## 技术栈

| 类别 | 技术 | 用途 |
|------|------|------|
| 框架 | React 18 | UI 组件 |
| 构建 | Vite 6 | 开发服务器与打包 |
| 状态管理 | Context + useReducer | 页面中心化状态模型 |
| 持久化 | Dexie.js (IndexedDB) | 崩溃恢复存储 |
| 任务队列 | p-queue | 并发 OCR 处理 |
| 事件总线 | mitt | 服务层与 UI 层解耦通信 |
| PDF 处理 | pdfjs-dist | PDF 页面提取 |
| 文档导出 | docx, file-saver | Word 文档生成与下载 |
| 数学渲染 | KaTeX | LaTeX 公式渲染 |

## 项目结构

```
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
|   +-- queueManager.ts          # p-queue 任务队列 + AbortController
|   +-- healthCheck.ts           # API 健康状态追踪
|   +-- pdfService.ts            # PDF 页面提取
|   +-- exportService.ts         # Markdown / 纯文本导出
|   +-- docxService.ts           # Word 文档导出
+-- components/
|   +-- UploadZone.tsx           # 上传区
|   +-- ImagePreview.tsx         # 图片预览与导航
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

打开应用后，点击右上角设置图标配置 API 密钥即可使用。

## 配置说明

所有配置通过应用内设置弹窗管理，保存在浏览器 localStorage 中：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| API 地址 | `https://api.openai.com/v1` | 支持 OpenAI 兼容格式和 Gemini Native 格式 |
| API 密钥 | 空 | 必填，对应 API 提供商的密钥 |
| 模型名称 | `gpt-5.4` | 任意支持视觉能力的模型 |
| Prompt | 内置 OCR 转录提示词 | 可自定义 |

### 支持的 API 提供商

应用根据 API 地址自动选择请求格式：

| 提供商 | API 地址 | 格式 |
|--------|---------|------|
| OpenAI | `https://api.openai.com/v1` | OpenAI chat/completions |
| DeepSeek | `https://api.deepseek.com/v1` | OpenAI 兼容 |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | OpenAI 兼容 |
| Gemini (OpenAI 模式) | `https://generativelanguage.googleapis.com/v1beta/openai` | OpenAI 兼容 |
| Gemini (原生) | `https://generativelanguage.googleapis.com/v1beta` | Gemini streamGenerateContent |
| 其他兼容服务 | `https://your-proxy.com/v1` | OpenAI chat/completions |

## 架构概览

```
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
    |                         |
    v                         |
fetchWithSmartRetry      healthChecker
    |
    v
LLM Vision API（SSE 流式响应）
    |
    v
IndexedDB (Dexie.js) <--- 持久化存储
```

## 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `←` / `→` | 切换图片 |
| `Escape` | 关闭弹窗 |
| `Ctrl+V` | 粘贴剪贴板图片 |
| `Tab` / `Shift+Tab` | 焦点导航 |

## 注意事项

- **并发控制**：任务队列默认最大并发数为 3，遇到限流时智能退避
- **图片压缩**：超过 2048px 分辨率或 1MB 大小时自动压缩后再上传，优先转为 WebP，不支持时回退到 JPEG
- **代码分割**：PDF 服务、导出服务、DOCX 生成器均为懒加载，首次使用时才下载
- **URL 协议**：仅支持 `https:` / `http:` / `data:` 协议，不支持本地 `file:` 路径
- **跨域限制**：通过 URL 加载图片受浏览器 CORS 策略约束，若目标服务器未开放跨域则会失败，建议直接上传文件

## 部署

项目已配置 Vercel 部署，推送到 GitHub 后可直接关联 Vercel 自动部署。

```bash
# 或使用 Vercel CLI
vercel --prod
```

## 许可证

MIT

## 致谢
本项目已在 [Linux do](https://linux.do/) 社区 发布，感谢社区的支持与反馈。
