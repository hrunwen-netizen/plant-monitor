/**
 * 主监控脚本 — 植物自动监控工具
 *
 * 用法:
 *   node src/monitor.js          # 正常运行（读取config.json）
 *   node src/monitor.js --once   # 只运行一次然后退出
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const { loadState, saveState, shouldNotify, log, productKey, saveResults, saveHistory } = require('./utils');
const { checkPlant } = require('./checker');
const { addToCart } = require('./cart');
const { sendNotifications } = require('./notifier');

// 加载配置
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, '..', 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (e) {
    log('ERROR', `无法加载配置文件: ${e.message}`);
    process.exit(1);
  }

  log('ERROR', `配置文件不存在: ${CONFIG_PATH}`);
  log('INFO', '请复制 config.example.json 为 config.json 并填入你的配置');
  process.exit(1);
}

/**
 * 从环境变量覆盖敏感配置（用于 GitHub Actions Secrets）
 */
function applyEnvOverrides(config) {
  // PushPlus
  if (process.env.PUSHPLUS_TOKEN) {
    config.notifications.pushplus.token = process.env.PUSHPLUS_TOKEN;
    config.notifications.pushplus.enabled = true;
  }

  // Email SMTP
  if (process.env.EMAIL_SMTP_USER) {
    config.notifications.email.smtp.user = process.env.EMAIL_SMTP_USER;
  }
  if (process.env.EMAIL_SMTP_PASS) {
    config.notifications.email.smtp.pass = process.env.EMAIL_SMTP_PASS;
  }
  if (process.env.EMAIL_TO) {
    config.notifications.email.to = process.env.EMAIL_TO;
  }

  return config;
}

/**
 * 运行一次完整的监控周期
 */
async function runOnce(config) {
  const startTime = Date.now();
  log('INFO', '========================================');
  log('INFO', '🌿 植物监控 — 开始新一轮检查');
  log('INFO', `检查 ${config.plants.filter(p => p.enabled).length} 个植物品种`);
  log('INFO', '========================================');

  const state = loadState();
  const notifications = [];
  const cartResults = [];

  // 启动浏览器
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
  } catch (e) {
    log('ERROR', `浏览器启动失败: ${e.message}`);
    log('ERROR', '请确保已安装 Playwright 浏览器: npx playwright install chromium');
    process.exit(1);
  }

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  try {
    // 遍历所有植物
    const allResults = [];

    for (const plant of config.plants) {
      if (!plant.enabled) continue;

      // 检查植物
      const result = await checkPlant(page, plant);
      const key = productKey(plant);

      if (result.skipped) continue;

      // 收集结果
      allResults.push({
        name: plant.name,
        type: plant.type,
        url: plant.type === 'url' ? plant.url : null,
        keywords: plant.type === 'keyword' ? plant.keywords : null,
        status: result.notifyStatus || result.status,
        price: result.price,
        error: result.error,
        lastChecked: new Date().toISOString(),
      });

      // 判断是否应该通知
      const notifyStatus = result.notifyStatus || result.status;
      if (shouldNotify(key, notifyStatus, state)) {
        // 构建通知条目
        if (result.type === 'url') {
          notifications.push({
            name: plant.name,
            url: plant.url,
            price: result.price,
            status: notifyStatus,
          });
        } else if (result.type === 'keyword' && result.products) {
          for (const prod of result.products) {
            notifications.push({
              name: prod.name || plant.name,
              url: prod.url,
              price: prod.price,
              status: prod.status || notifyStatus,
            });
          }
        }
      }

      // 自动加购（如果启用）
      if (config.monitor.autoAddToCart && result.available && plant.type === 'url') {
        const cartResult = await addToCart(page, plant);
        cartResults.push(cartResult);

        // 加购成功或部分成功，也加入通知提醒
        if (cartResult.success || cartResult.partialSuccess) {
          // 检查是否已经在通知列表中
          const alreadyNotified = notifications.some(n => n.name === plant.name);
          if (!alreadyNotified) {
            notifications.push({
              name: plant.name + (cartResult.success ? ' [已自动加购]' : ' [加购未确认]'),
              url: plant.url,
              price: result.price,
              status: cartResult.success ? 'added_to_cart' : 'cart_uncertain',
              cartMessage: cartResult.message || cartResult.error,
            });
          }
        }
      }
    }

    // 保存状态
    saveResults(allResults);
    saveState(state);

    // 发送通知
    if (notifications.length > 0) {
      log('INFO', `发现 ${notifications.length} 个可购买产品，发送通知...`);
      await sendNotifications(config.notifications, notifications);
    } else {
      log('INFO', '本次检查没有新的可购买产品。一切正常。');
    }

  } catch (error) {
    log('ERROR', `监控过程中发生错误: ${error.message}`);
    console.error(error.stack);
  } finally {
    await browser.close();
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log('INFO', `本轮检查完成，耗时 ${elapsed}s`);
  log('INFO', '========================================\n');

  return { notifications, cartResults, elapsed };
}

/**
 * 主函数
 */
async function main() {
  const config = applyEnvOverrides(loadConfig());

  // 检查是否只运行一次
  const onceMode = process.argv.includes('--once');

  log('INFO', `植物监控启动 — ${onceMode ? '单次运行模式' : '持续运行模式'}`);

  if (onceMode) {
    await runOnce(config);
    log('INFO', '单次运行完成，退出。');
    return;
  }

  // 默认持续运行模式
  const intervalMinutes = config.monitor.checkIntervalMinutes || 15;
  const intervalMs = intervalMinutes * 60 * 1000;
  log('INFO', `检查间隔: ${intervalMinutes} 分钟`);

  // 首次立即运行
  await runOnce(config);

  // 定时循环
  setInterval(async () => {
    // 重新加载配置（支持热更新）
    const freshConfig = applyEnvOverrides(loadConfig());
    await runOnce(freshConfig);
  }, intervalMs);
}

// 启动
main().catch((err) => {
  log('ERROR', `程序异常退出: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
