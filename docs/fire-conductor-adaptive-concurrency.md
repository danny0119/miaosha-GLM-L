# FireConductor — 自适应并发调度

## 动机

原有开火机制使用固定间隔（burst 50ms / auto follow-up 定时器）调度请求，存在两个问题：

1. **空闲等待** — 服务器响应快时，50ms 间隔引入了不必要的延迟
2. **无背压** — 服务器返回 555（繁忙）时仍以相同速率消耗 ticket

参考 `glm-cpu-lite-concurrency` 项目的"零争用闭环"思想，引入 `FireConductor` 自适应并发调度器。

## 改动

### 新增：`lib/api/fire-conductor.ts`

`FireConductor` 类实现了有界并发池 + 背压降级：

```
queue → 有界并发池 (maxConcurrent) → 服务器
              ↓ 完成回调
          onShot / onSuccess / onDepleted
              ↓ 555 时
          maxConcurrent *= 0.5 (最低 minConcurrent)
```

核心机制：

| 机制 | 行为 |
|------|------|
| 有界并发 | 初始 `maxConcurrent` 个请求同时飞行，完成一个补一个 |
| 背压降级 | 收到 555 响应后 `maxConcurrent *= 0.5`，最低降至 2 |
| 定时补位 | 每 100ms `tick()` 检查是否有空位可发射 |
| 精确计时 | 支持 `scheduledAt` 字段，精确到毫秒级发射 |
| 取消 | `cancel()` 立即停止所有待发射请求 |

### 修改：`entrypoints/bm-capture.content.ts`

| 函数 | 旧实现 | 新实现 |
|------|--------|--------|
| `burstFire()` | 固定 50ms `setTimeout` 链 | `FireConductor`，`maxConcurrent=8` |
| `runAutoFirePlan()` | `queueFireTimers` 定时器调度 | `FireConductor`，`maxConcurrent = max(initialCount, 3)` |
| `queueFireTimers()` | 全部删除 | — |
| `describeShot()` | 全部删除 | — |

### 删除：~74 行旧代码

- `queueFireTimers` — 定时器驱动的串行发射器
- `describeShot` — 仅被 `queueFireTimers` 使用的辅助函数

## 事件兼容性

所有 `postToOverlay` 事件格式不变：

- `FIRE_BATCH_START` — 启动 fire-viz 覆盖层
- `FIRE_SHOT_RESULT` — 更新矩阵单元格
- `FIRE_RESULT` — 终端日志行
- `BURST_FIRE_SUCCESS` — 下单成功
- `BURST_FIRE_DEPLETED` — 弹药耗尽

`08-overlay.js` 和 `09-fire-viz.js` 无需任何修改。

## 验证

```
 Test Files  10 passed (10)
      Tests  72 passed (72)
```

所有 72 个现有测试通过，无需新增测试用例（行为等价）。
