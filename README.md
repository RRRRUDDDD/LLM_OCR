# LLM OCR

基于多模态大语言模型的智能文字识别工具。通过 Vision API 从图片中提取文字，支持流式输出、LaTeX 公式渲染、批量处理。

## 功能特性

- **LLM 驱动识别** — 使用多模态大模型进行文字识别，非传统 OCR 引擎
- **多 API 格式适配** — 自动识别 Gemini Native API 与 OpenAI 兼容格式，无需手动切换
- **流式实时输出** — 通过 SSE 流式返回识别结果，逐字显示
- **多图批量处理** — 支持同时上传多张图片，自适应并发控制
- **多种输入方式** — 文件选择、拖拽上传、剪贴板粘贴、URL 链接输入
- **客户端图片压缩** — Web Worker + OffscreenCanvas 后台线程压缩，不阻塞主线程；不支持时自动回退主线程 Canvas 压缩
- **LaTeX 公式渲染** — 识别结果中的数学公式通过 KaTeX 实时渲染
- **智能重试机制** — 429/5xx/网络错误自动指数退避重试，支持 Retry-After
- **键盘快捷操作** — 左右箭头切换图片、Escape 关闭弹窗、Tab 键完整导航
- **深色模式** — 自动跟随系统主题切换
- **无障碍支持** — 焦点管理、ARIA 标签、prefers-reduced-motion 动效降级

## 演示网站
https://ocr.yoshinagakoi.eu.org/

## 技术栈

| 类别 | 技术 | 版本 |
|------|------|------|
| 框架 | React | 18.2 |
| 构建 | Vite | 6.2 |
| 数学渲染 | KaTeX | 0.16 |

## 项目结构

```
src/
├── index.jsx                   # 入口
├── App.jsx                     # 主组件
├── App.css                     # 全局样式
├── components/
│   ├── UploadZone.jsx          # 上传区
│   ├── ImagePreview.jsx        # 图片预览 + 导航
│   ├── ImageModal.jsx          # 图片大图弹窗
│   ├── ResultPanel.jsx         # 识别结果面板
│   ├── SettingsDialog.jsx      # API 配置弹窗
│   ├── KaTeXLine.jsx           # LaTeX 渲染
│   └── ErrorBoundary.jsx       # 错误边界
├── hooks/
│   ├── useOcrApi.js            # OCR 核心逻辑
│   ├── useImageManager.js      # 图片列表状态管理
│   ├── useSnackbar.js          # 消息提示
│   └── useFocusTrap.js         # 焦点陷阱
└── utils/
    ├── compressImage.js        # 图片压缩
    ├── compressWorker.js       # Web Worker 压缩脚本
    └── fetchImageFromUrl.js    # URL 图片加载
```

## 快速开始

```bash
# 安装依赖（推荐 yarn）
yarn install
# 或
npm install

# 启动开发服务器
yarn dev
# 或
npm run dev

# 生产构建
yarn build
# 或
npm run build

# 预览构建产物
yarn preview
# 或
npm run preview
```

打开应用后，点击右上角设置图标配置 API 密钥即可使用。

## 配置说明

所有配置通过应用内设置弹窗管理，保存在浏览器 localStorage 中：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| API 地址 | `https://generativelanguage.googleapis.com/v1beta` | 支持 Gemini Native 和 OpenAI 兼容格式，自动识别 |
| API 密钥 | — | 必填，Google Gemini 或兼容 API 的密钥 |
| 模型名称 | `gemini-2.5-flash` | 支持任意兼容模型 |
| Prompt | 内置 OCR 转录提示词 | 可自定义 |

### API 格式自动适配

应用会根据 API 地址自动选择请求格式：

- **Gemini Native**：地址包含 `googleapis.com` 且不包含 `/openai` → 使用 `streamGenerateContent` 格式
- **OpenAI 兼容**：其他地址 → 使用 `chat/completions` 格式

## 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `←` / `→` | 切换图片（无弹窗时生效） |
| `Escape` | 关闭弹窗 |
| `Tab` / `Shift+Tab` | 焦点导航 |

## 注意事项

- **并发限制**：批量处理默认最大并发数为 5，遇到 429 限流时自动减半，成功后逐步恢复
- **图片压缩**：同时超过 2048px 分辨率或 1 MB 大小时执行压缩，否则直接上传
- **URL 协议**：仅支持 `https:` / `http:` / `data:` 协议，不支持本地 `file:` 路径
- **跨域限制**：通过 URL 加载图片受浏览器 CORS 策略约束，若图片服务器未开放跨域则会失败，建议直接上传文件

## 部署

项目已配置 Vercel 部署，推送到 GitHub 后可直接关联 Vercel 自动部署。

```bash
# 或使用 Vercel CLI
vercel --prod
```
