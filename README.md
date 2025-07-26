# Momentum - 心理学驱动的专注力应用

基于链式时延协议（CTDP）理论的自控力训练工具，通过"神圣座位原理"、"下必为例原理"和"线性时延原理"帮助用户建立强大的习惯链条。

## 🎯 核心理念

Momentum基于Edmond在知乎上提出的链式时延协议（Chained Time-Delay Protocol, CTDP）理论，通过数学模型解决自制力问题：

```
I = ∫₀^∞ V(τ)·W(τ)dτ
```

其中：
- `V(τ)` 是未来价值函数
- `W(τ)` 是权重贴现函数

## 🔬 三大核心原理

### 1. 神圣座位原理
通过指定特定的触发动作（如"戴上降噪耳机"、"坐到书房书桌前"），创建一个"神圣座位"。一旦触发这个动作，就必须以最好的状态完成专注任务。每次成功完成任务，链条记录增长（#1 → #2 → #3...），形成强大的心理约束力。

### 2. 下必为例原理
当面临疑似违规行为时，只能选择：
- **判定失败**：链条清零，从#1重新开始
- **判定允许**：该行为永久加入例外规则，未来必须一律允许

这种"判例法"机制防止破窗效应，让规则边界收敛到最理性的状态。

### 3. 线性时延原理
通过"预约链"解决启动困难：
- 设定预约信号（如"打响指"）
- 预约后必须在指定时间内开始主任务
- 利用时间延迟降低启动阻力

## ✨ 主要功能

### 🔗 双链系统
- **主链（任务链）**：记录实际完成的专注任务，形成连续记录
- **辅助链（预约链）**：通过预约机制降低启动门槛

### 📊 智能统计
- 连续记录追踪（主链 #N，预约链 #N）
- 成功率统计和历史记录
- 失败原因分析

### 🎮 沉浸式专注模式
- 全屏专注界面，最小化干扰
- 实时倒计时和进度显示
- 暂停/恢复功能

### ⚖️ 规则判定系统
- 中断时的智能判定界面
- 例外规则管理
- 自动规则收敛

### 📱 现代化界面
- 响应式设计，支持所有设备
- 暗色主题，护眼舒适
- 直观的卡片式布局

## 🚀 快速开始

### 环境要求
- Node.js 18+ 
- npm 或 yarn

### 安装步骤

1. **克隆项目**
```bash
git clone https://github.com/yourusername/momentum.git
cd momentum
```

2. **安装依赖**
```bash
npm install
```

3. **启动开发服务器**
```bash
npm run dev
```

4. **构建生产版本**
```bash
npm run build
```

5. **预览生产版本**
```bash
npm run preview
```

## 📖 使用指南

### 创建第一条链

1. 点击"创建第一条链"或"新建链"
2. 设置链名称（如"学习Python"）
3. 选择神圣座位触发动作（如"戴上降噪耳机"）
4. 设定任务时长（推荐25-45分钟）
5. 配置预约链设置：
   - 预约信号（如"打响指"）
   - 预约时长（推荐15分钟）
   - 预约完成条件（通常与主链触发器相同）

### 使用预约功能

1. 在任务卡片上点击"预约"
2. 执行预约信号（如打响指）
3. 在预约时间内完成预约条件
4. 自动进入专注模式

### 直接开始任务

1. 点击"开始任务"
2. 执行神圣座位触发动作
3. 进入全屏专注模式
4. 专注完成设定时长

### 处理中断情况

当需要中断任务时：
1. 点击"中断/规则判定"
2. 描述具体行为
3. 选择处理方式：
   - **判定失败**：链条清零
   - **判定允许**：加入例外规则

## 🏗️ 技术架构

### 前端技术栈
- **React 18** - 用户界面框架
- **TypeScript** - 类型安全
- **Tailwind CSS** - 样式框架
- **Lucide React** - 图标库
- **Vite** - 构建工具

### 核心组件
```
src/
├── components/
│   ├── Dashboard.tsx      # 主仪表板
│   ├── ChainEditor.tsx    # 链条编辑器
│   ├── ChainCard.tsx      # 任务卡片
│   ├── FocusMode.tsx      # 专注模式
│   ├── ChainDetail.tsx    # 链条详情
│   └── AuxiliaryJudgment.tsx # 辅助链判定
├── types/
│   └── index.ts           # 类型定义
├── utils/
│   ├── storage.ts         # 本地存储
│   └── time.ts           # 时间工具
└── App.tsx               # 主应用
```

### 数据结构

```typescript
interface Chain {
  id: string;
  name: string;
  trigger: string;                    // 神圣座位触发动作
  duration: number;                   // 任务时长（分钟）
  description: string;
  currentStreak: number;              // 主链连续记录
  auxiliaryStreak: number;            // 辅助链连续记录
  totalCompletions: number;           // 总完成次数
  totalFailures: number;              // 总失败次数
  auxiliaryFailures: number;          // 辅助链失败次数
  exceptions: string[];               // 主链例外规则
  auxiliaryExceptions: string[];      // 辅助链例外规则
  auxiliarySignal: string;            // 预约信号
  auxiliaryDuration: number;          // 预约时长
  auxiliaryCompletionTrigger: string; // 预约完成条件
  createdAt: Date;
  lastCompletedAt?: Date;
}
```

## 🔧 自定义配置

### 修改预设选项

在 `src/components/ChainEditor.tsx` 中可以自定义：

```typescript
// 触发动作模板
const TRIGGER_TEMPLATES = [
  { icon: Headphones, text: '戴上降噪耳机', color: 'text-blue-400' },
  { icon: Code, text: '打开编程软件', color: 'text-green-400' },
  // 添加更多选项...
];

// 时长预设
const DURATION_PRESETS = [25, 30, 45, 60, 90, 120];
```

### 主题定制

项目使用Tailwind CSS，可以在 `tailwind.config.js` 中自定义主题：

```javascript
module.exports = {
  theme: {
    extend: {
      colors: {
        // 自定义颜色
      }
    }
  }
}
```

## 📊 数据管理

### 本地存储
应用使用localStorage存储所有数据：
- `momentum_chains` - 链条数据
- `momentum_scheduled_sessions` - 预约会话
- `momentum_active_session` - 活跃会话
- `momentum_completion_history` - 完成历史

### 数据导出/导入
```javascript
// 导出数据
const exportData = () => {
  const data = {
    chains: storage.getChains(),
    history: storage.getCompletionHistory()
  };
  return JSON.stringify(data);
};

// 导入数据
const importData = (jsonData) => {
  const data = JSON.parse(jsonData);
  storage.saveChains(data.chains);
  storage.saveCompletionHistory(data.history);
};
```

## 🤝 贡献指南

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 📞 联系方式

如有问题或建议，发送邮件至：kenx@andrew.cmu.edu