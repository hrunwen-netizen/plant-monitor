/**
 * 工具函数模块 — 日志、文件操作、状态去重
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'last-state.json');

// 确保 data 目录存在
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * 读取上次运行时的产品状态
 * @returns {Object} 状态对象 { "product-key": { status, lastNotified } }
 */
function loadState() {
  ensureDataDir();
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch (e) {
    log('WARN', '读取状态文件失败，将使用空状态: ' + e.message);
  }
  return {};
}

/**
 * 保存当前产品状态
 * @param {Object} state
 */
function saveState(state) {
  ensureDataDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * 检查产品状态是否发生了变化
 * @param {string} productKey 产品唯一标识
 * @param {string} newStatus 新状态 (available | sold_out | short_supply | unknown)
 * @param {Object} state 完整状态对象
 * @returns {boolean} 是否应该发送通知
 */
function shouldNotify(productKey, newStatus, state) {
  const old = state[productKey];
  if (!old) {
    // 新产品，首次发现
    state[productKey] = { status: newStatus, lastNotified: new Date().toISOString() };
    return newStatus !== 'sold_out'; // sold_out 不通知
  }

  if (old.status !== newStatus) {
    // 状态变化了
    state[productKey] = { status: newStatus, lastNotified: new Date().toISOString() };
    // 只有变为可购买时才通知（sold_out → available 或 unknown → available）
    if (newStatus === 'available' || newStatus === 'short_supply') {
      return true;
    }
    return false;
  }

  // 状态没变，但如果是可购买状态且距离上次通知超过24小时，重新通知
  if ((newStatus === 'available' || newStatus === 'short_supply') && old.lastNotified) {
    const hoursSinceLastNotify = (Date.now() - new Date(old.lastNotified).getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastNotify > 24) {
      state[productKey].lastNotified = new Date().toISOString();
      return true;
    }
  }

  return false;
}

/**
 * 格式化日志输出
 * @param {string} level INFO | WARN | ERROR
 * @param {string} message
 */
function log(level, message) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const prefix = `[${timestamp}] [${level}]`;
  if (level === 'ERROR') {
    console.error(`${prefix} ${message}`);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

/**
 * 生成产品的唯一标识 key
 */
function productKey(plant) {
  if (plant.type === 'url') {
    return plant.url;
  }
  return 'keyword:' + plant.keywords.join('|');
}

/**
 * 构建 wistuba.com 的搜索 URL
 */
function buildSearchUrl(keyword) {
  return `https://wistuba.com/search?search=${encodeURIComponent(keyword)}`;
}

module.exports = {
  loadState,
  saveState,
  shouldNotify,
  log,
  productKey,
  buildSearchUrl,
  STATE_FILE
};
