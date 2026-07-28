# 🌿 植物自动监控工具

自动监控 [wistuba.com](https://wistuba.com) 上的植物产品上架情况，第一时间通过**微信**和**邮件**通知你。

## ✨ 功能

- 🌐 **可视化管理面板**：网页上添加/删除/修改植物，无需编辑配置文件
- 🔍 **两种监控模式**：粘贴产品URL精确监控 / 输入关键词模糊搜索
- 📱 **双通道通知**：PushPlus 微信推送 + QQ邮箱
- 🤖 **自动加购**（可选）：检测到上架自动加入购物车
- ☁️ **免费云端运行**：通过 GitHub Actions 24小时自动运行，无需服务器
- 🔄 **智能去重**：同个产品不会重复通知（24小时内）

## 🚀 快速开始

### 第一步：Fork 本项目到你的 GitHub

1. 点击本仓库右上角 **Fork** 按钮
2. Fork 到你自己的 GitHub 账号下

### 第二步：启用 GitHub Pages（网页管理面板）

1. 在你 Fork 的仓库中，进入 **Settings → Pages**
2. **Source** 选择 **GitHub Actions**
3. 回到 **Actions** 标签页，点击 **"I understand my workflows, go ahead and enable them"**
4. 等待 **"🌐 部署管理面板到 GitHub Pages"** 运行完成
5. 管理面板地址：`https://你的用户名.github.io/plant-monitor/`

### 第三步：创建 GitHub Token（网页编辑需要）

1. 打开 [github.com/settings/tokens](https://github.com/settings/tokens/new?scopes=repo&description=plant-monitor-web)
2. 选择 **repo** 权限
3. 点击 **Generate token**
4. **复制 Token**（只显示一次！）

### 第四步：打开管理面板

访问 `https://你的用户名.github.io/plant-monitor/`，在 **设置** 中填入：
- GitHub 用户名、仓库名、Token
- PushPlus Token

然后就可以在网页上管理植物清单了！

### 第五步：配置 GitHub Secrets

在你 Fork 的仓库中，进入 **Settings → Secrets and variables → Actions**，添加以下 Secrets：

| Secret 名称 | 值 | 说明 |
|-------------|-----|------|
| `PUSHPLUS_TOKEN` | `你的PushPlus Token` | 微信推送 |
| `EMAIL_SMTP_USER` | `你的QQ邮箱@qq.com` | 发件邮箱 |
| `EMAIL_SMTP_PASS` | `QQ邮箱授权码` | 不是QQ密码！ |
| `EMAIL_TO` | `接收通知的邮箱` | 可以和发件邮箱相同 |

> 💡 也可以不配置 Secrets，直接在管理面板中设置通知信息。

## 📋 配置说明

### 植物配置

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 植物名称（用于通知显示） |
| `type` | `"url"` 或 `"keyword"` | 监控模式 |
| `url` | string | type=url 时必填，产品页完整URL |
| `keywords` | string[] | type=keyword 时必填，搜索关键词列表 |
| `maxPrice` | number | 最高预算（欧元），超过不通知 |
| `enabled` | boolean | 是否启用监控 |

### 监控设置

```json
{
  "monitor": {
    "checkIntervalMinutes": 15,  // 检查间隔（分钟）
    "autoAddToCart": false,      // 是否自动加入购物车（实验功能）
    "cartNotifyOnly": true       // 加购失败是否仍然通知
  }
}
```

### 通知设置

```json
{
  "notifications": {
    "pushplus": {
      "enabled": true,
      "token": "从环境变量读取，这里留空即可"
    },
    "email": {
      "enabled": true,
      "smtp": {
        "host": "smtp.qq.com",
        "port": 465,
        "user": "",
        "pass": ""
      },
      "to": ""
    }
  }
}
```

## 🏠 本地运行

```bash
# 安装依赖
npm install

# 安装浏览器
npx playwright install chromium

# 运行一次
node src/monitor.js --once

# 持续运行（每15分钟）
node src/monitor.js
```

## 🔒 安全说明

- PushPlus Token、邮箱密码等敏感信息通过 **GitHub Secrets** 加密存储，即使仓库公开也不会泄露
- Actions 日志中的敏感信息会自动打码
- 建议使用 **公开仓库**，享受无限免费 Actions 分钟数

## 💰 费用

| 服务 | 费用 |
|------|------|
| GitHub Actions | **免费**（公开仓库无限分钟） |
| PushPlus | **免费** |
| QQ邮箱 SMTP | **免费** |
| wistuba.com 网站 | 植物本身的价格 😄 |

## ❓ 常见问题

**Q: 会不会频繁发通知打扰我？**
A: 不会。同个产品状态没变化就不会重复通知，即使可购买也最多24小时通知一次。

**Q: 自动加购可靠吗？**
A: 这是实验功能（默认关闭）。Shopware 网站可能有 CSRF 保护，加购可能失败。失败时会降级为普通通知。

**Q: 怎么添加更多植物？**
A: 打开管理面板网页，点击"添加植物"，粘贴 wistuba.com 的产品链接即可，或编辑 `config.json`。

**Q: 我想换关键词怎么办？**
A: 在管理面板中直接编辑，或修改 `config.json`。

**Q: 怎么知道程序在正常运行？**
A: 在 GitHub 仓库的 Actions 标签页可以看到每次运行的日志。

**Q: 以后想做自动付款怎么办？**
A: 建议在设置中将仓库转为**私有**。自动填地址到付款页是可行的，完全自动付款有法律和技术风险。
