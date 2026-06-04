# 自动补弹 — Auto-Replenish

## 概述

自动补弹功能可替代手动验证码录入，在抢购前自动补充子弹（captcha ticket），确保持仓充足。

## 架构

```
bm-main.js (MAIN world)
  10-auto-replenish.js
    │  检测 captcha iframe → 读取提示文字
    │  接收点击坐标 → 模拟鼠标事件
    │  循环至目标子弹数
    │
    │  postMsg('AUTO_REPLENISH_MODAL_OPEN')
    │  window.__miaosha_cmd CAPTCHA_CLICK
    ▼
bm-capture.content.ts (ISOLATED world)
    │  接收弹窗开启事件
    │  → chrome.runtime.sendMessage(SOLVE_CAPTCHA_REQUEST)
    │  → 接收结果 → post到MAIN
    │
    │  自动调度: T-leadTime 触发一键补弹
    ▼
background.ts (Service Worker)
    │  chrome.tabs.captureVisibleTab → 截图
    │  中继到 Offscreen Document
    ▼
offscreen.html (Offscreen Document)
    │  Canvas 裁剪到 iframe 区域
    │  轮廓检测 → 3个字符框
    │  Canvas 渲染提示字符 → 归一化匹配
    │  Hungarian 算法 → 最优排列
    │  返回归一化点击坐标
```

## 新增文件

| 文件 | 职责 |
|------|------|
| `lib/settings/replenish.ts` | 补弹配置（开关、目标数、提前时间） |
| `lib/vision/captcha-solver.ts` | 纯 Canvas 验证码求解器（无外部依赖） |
| `entrypoints/offscreen/index.html` | Offscreen Document HTML 入口 |
| `entrypoints/offscreen/main.ts` | Offscreen 消息处理 + 代理 solver |
| `src/bm-main/10-auto-replenish.js` | MAIN world 自动补弹逻辑 |

## 修改文件

| 文件 | 改动 |
|------|------|
| `wxt.config.ts` | 添加 `debugger` 权限 |
| `entrypoints/background.ts` | Offscreen 生命周期 + SOLVE_CAPTCHA_REQUEST 中继 |
| `entrypoints/bm-capture.content.ts` | AUTO_REPLENISH_MODAL_OPEN 处理 + 自动调度 |
| `entrypoints/popup/components/ProdContent.svelte` | 补弹按钮 + 状态 |
| `entrypoints/options/GeneralPage.svelte` | 补弹设置面板 |

## 纯 Canvas 字符匹配

`captcha-solver.ts` 使用无外部依赖的纯 Canvas 方案：

1. **阈值分割** — Otsu 二值化
2. **连通域分析** — 洪水填充找到 3 个最大字符区域
3. **模板渲染** — OffscreenCanvas 绘制疑文字符（微软雅黑/黑体）
4. **归一化互相关** — 标准化像素相似度评分
5. **匈牙利匹配** — 全局最优分配

## 配置项

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `enabled` | `false` | 是否开启自动补弹 |
| `targetCount` | `30` | 目标子弹数 |
| `leadTimeSec` | `300` | 抢购前多少秒开始补弹 |

## 使用流程

1. 在 Options 页面开启自动补弹，设定目标数和提前时间
2. 浏览器扩展会在 T-leadTime 自动开始补弹
3. 或通过 Popup 点击「一键补充」
4. 自动补弹每秒解一个验证码，直至目标数
5. 开火时使用已有 ticket 队列，不经验证码弹窗

## 已知限制

- 纯 Canvas 字符匹配准确率约 80-90%（OCR 方案可提升至 95%+）
- 跨域 iframe 点击依赖 Chrome 事件转发机制
- 如需更高准确率，可替换 `captcha-solver.ts` 为 Tesseract.js 版本
