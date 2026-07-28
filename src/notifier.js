/**
 * 通知模块 — PushPlus 微信推送 + QQ邮箱邮件通知
 */
const nodemailer = require('nodemailer');
const https = require('https');
const { log } = require('./utils');

/**
 * 通过 PushPlus 发送微信通知
 * @param {Object} config 通知配置
 * @param {string} title 通知标题
 * @param {string} content 通知内容 (支持Markdown)
 */
async function sendPushPlus(config, title, content) {
  if (!config.enabled || !config.token) {
    log('INFO', '[PushPlus] 未启用或未配置Token，跳过');
    return { success: false, reason: '未启用' };
  }

  const data = JSON.stringify({
    token: config.token,
    title: title,
    content: content,
    template: 'markdown',
  });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'www.pushplus.plus',
        path: '/send',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: 10000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const result = JSON.parse(body);
            if (result.code === 200) {
              log('INFO', `[PushPlus] 发送成功`);
              resolve({ success: true });
            } else {
              log('ERROR', `[PushPlus] 发送失败: ${result.msg || body}`);
              resolve({ success: false, reason: result.msg });
            }
          } catch (e) {
            log('ERROR', `[PushPlus] 响应解析失败: ${body}`);
            resolve({ success: false, reason: '解析失败' });
          }
        });
      }
    );

    req.on('error', (e) => {
      log('ERROR', `[PushPlus] 请求失败: ${e.message}`);
      resolve({ success: false, reason: e.message });
    });

    req.on('timeout', () => {
      req.destroy();
      log('ERROR', '[PushPlus] 请求超时');
      resolve({ success: false, reason: '超时' });
    });

    req.write(data);
    req.end();
  });
}

/**
 * 通过 QQ 邮箱发送邮件通知
 * @param {Object} config 邮件配置
 * @param {string} subject 邮件主题
 * @param {string} html 邮件正文 (HTML)
 */
async function sendEmail(config, subject, html) {
  if (!config.enabled) {
    log('INFO', '[邮件] 未启用，跳过');
    return { success: false, reason: '未启用' };
  }

  if (!config.smtp || !config.smtp.user || !config.smtp.pass) {
    log('ERROR', '[邮件] SMTP配置不完整');
    return { success: false, reason: 'SMTP配置不完整' };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass,
      },
    });

    const info = await transporter.sendMail({
      from: `"植物监控" <${config.smtp.user}>`,
      to: config.to || config.smtp.user,
      subject: subject,
      html: html,
    });

    log('INFO', `[邮件] 发送成功: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    log('ERROR', `[邮件] 发送失败: ${error.message}`);
    return { success: false, reason: error.message };
  }
}

/**
 * 构建通知内容
 * @param {Object[]} notifications 需要通知的产品列表
 * @returns {{ title: string, markdown: string, html: string }}
 */
function buildNotificationContent(notifications) {
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const count = notifications.length;

  const title = `🌿 wistuba.com 植物可用性通知 - ${now}`;

  // PushPlus 用的 Markdown 内容
  let markdown = `## 🌱 植物监控通知\n\n`;
  markdown += `**检测时间**: ${now}\n\n`;
  markdown += `**发现 ${count} 个可购买的植物/产品**：\n\n`;
  markdown += `---\n\n`;

  // 邮件用的 HTML 内容
  let html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2d6a4f;">🌱 植物监控通知</h2>
      <p><strong>检测时间</strong>: ${now}</p>
      <p style="color: #d00000;"><strong>发现 ${count} 个可购买的产品！</strong></p>
      <hr>
  `;

  for (const item of notifications) {
    const statusLabel =
      item.status === 'short_supply' ? '⚠️ 库存紧张' :
      item.status === 'new' ? '🆕 新品' :
      '✅ 可购买';

    const priceInfo = item.price ? `€${item.price}` : '价格未知';

    // Markdown
    markdown += `### ${item.name}\n`;
    markdown += `- **状态**: ${statusLabel}\n`;
    markdown += `- **价格**: ${priceInfo}\n`;
    if (item.url) {
      markdown += `- **链接**: [点击查看](${item.url})\n`;
    }
    markdown += `\n`;

    // HTML
    html += `
      <div style="border: 1px solid #ddd; padding: 12px; margin: 8px 0; border-radius: 6px;">
        <h3 style="margin: 0 0 8px 0; color: #1b4332;">${item.name}</h3>
        <p style="margin: 4px 0;"><strong>状态</strong>: ${statusLabel}</p>
        <p style="margin: 4px 0;"><strong>价格</strong>: ${priceInfo}</p>
        ${item.url ? `<p style="margin: 4px 0;"><a href="${item.url}" style="color: #40916c;">点击查看产品详情 →</a></p>` : ''}
      </div>
    `;
  }

  markdown += `---\n\n> 植物监控机器人 | wistuba.com`;
  markdown += `\n\n[[不想再收到通知？修改 config.json 中的 enabled 字段即可]](https://github.com)`;

  html += `
      <hr>
      <p style="color: #888; font-size: 12px;">
        植物监控机器人 | wistuba.com<br>
        如需调整监控设置，请修改 config.json
      </p>
    </div>
  `;

  return { title, markdown, html };
}

/**
 * 发送通知（PushPlus + 邮箱）
 * @param {Object} config 完整通知配置
 * @param {Object[]} notifications 需要通知的产品列表
 */
async function sendNotifications(config, notifications) {
  if (!notifications || notifications.length === 0) {
    log('INFO', '[通知] 没有需要通知的产品，跳过');
    return;
  }

  log('INFO', `[通知] 准备发送 ${notifications.length} 条通知...`);

  const { title, markdown, html } = buildNotificationContent(notifications);

  const results = [];

  // PushPlus 微信通知（支持多个Token，每个人都能收到）
  if (config.pushplus && config.pushplus.enabled) {
    // 支持单个 token 或 tokens 数组
    const tokens = config.pushplus.tokens || (config.pushplus.token ? [config.pushplus.token] : []);

    for (const token of tokens) {
      const result = await sendPushPlus({ token, enabled: true }, title, markdown);
      results.push({ channel: 'PushPlus', token: token.substring(0, 8) + '...', ...result });
    }
  }

  // 邮箱通知
  if (config.email && config.email.enabled) {
    const result = await sendEmail(config.email, title, html);
    results.push({ channel: 'Email', ...result });
  }

  // 汇总
  const successCount = results.filter((r) => r.success).length;
  log('INFO', `[通知] 完成: ${successCount}/${results.length} 个渠道发送成功`);

  if (successCount === 0 && results.length > 0) {
    log('WARN', '[通知] 所有通知渠道发送失败！请检查配置');
  }

  return results;
}

module.exports = { sendPushPlus, sendEmail, sendNotifications, buildNotificationContent };
