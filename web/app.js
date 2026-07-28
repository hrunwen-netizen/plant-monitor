/**
 * 植物自动监控 — 管理面板交互逻辑
 *
 * 功能:
 *  - 可视化植物清单增删改查
 *  - 通过 GitHub API 读写 config.json
 *  - 查看 Actions 运行日志
 *  - 编辑通知设置
 *  - 手动触发检查
 */

// ============ 常量 ============
const STORAGE_KEY_GITHUB = 'plant-monitor-github';
const STORAGE_KEY_PLANTS = 'plant-monitor-plants-draft';
const CONFIG_PATH = 'config.json';

// ============ 状态 ============
let plants = [];
let config = null;
let githubConnected = false;
let gitHubInfo = { user: '', repo: '', token: '' };
let isDirty = false;

// ============ DOM 引用 ============
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ============ 初始化 ============
document.addEventListener('DOMContentLoaded', () => {
  loadLocalState();
  initNav();
  initModals();
  initSettings();
  initNotifications();
  loadDefaultPlants();
  renderPlants();

  if (githubConnected) {
    fetchConfigFromGitHub();
    updateGitHubStatus('已连接', 'connected');
  }
});

// ============ 本地状态 ============
function loadLocalState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_GITHUB);
    if (saved) {
      gitHubInfo = JSON.parse(saved);
      githubConnected = !!(gitHubInfo.token && gitHubInfo.user && gitHubInfo.repo);
    }
  } catch (e) { /* ignore */ }
}

function saveLocalState() {
  localStorage.setItem(STORAGE_KEY_GITHUB, JSON.stringify(gitHubInfo));
  githubConnected = !!(gitHubInfo.token && gitHubInfo.user && gitHubInfo.repo);
}

function loadDefaultPlants() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_PLANTS);
    if (saved) {
      plants = JSON.parse(saved);
      return;
    }
  } catch (e) { /* ignore */ }

  // 默认示例数据
  plants = [
    {
      name: 'Squamellaria jebbiana (Taveuni Island)',
      type: 'url',
      url: 'https://wistuba.com/Squamellaria-jebbiana-Taveuni-Island-Fiji/Sq-jebb-Tv',
      maxPrice: 100,
      enabled: true,
    },
    {
      name: 'Nepenthes villosa',
      type: 'keyword',
      keywords: ['villosa', 'Nepenthes villosa'],
      maxPrice: 200,
      enabled: false,
    },
  ];
}

// ============ 导航 ============
function initNav() {
  $('#nav').addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-btn');
    if (!btn) return;

    $$('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    $$('.tab-content').forEach(t => t.classList.remove('active'));
    const tabId = 'tab-' + btn.dataset.tab;
    $(`#${tabId}`).classList.add('active');

    if (btn.dataset.tab === 'logs') loadLogs();
    if (btn.dataset.tab === 'settings') loadSettings();
    if (btn.dataset.tab === 'notifications') loadNotifications();
  });

  $('#btn-run-now').addEventListener('click', triggerManualCheck);
}

// ============ 植物清单渲染 ============
function renderPlants() {
  const list = $('#plant-list');
  $('#plant-count').textContent = `${plants.length} 个植物`;

  if (plants.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🪴</div>
        <p>还没有监控任何植物</p>
        <p class="text-muted">点击 "添加植物" 开始，粘贴 wistuba.com 的产品链接即可</p>
      </div>`;
    return;
  }

  list.innerHTML = plants.map((p, i) => `
    <div class="plant-card ${p.enabled ? '' : 'paused'}">
      <div class="plant-card-header">
        <div class="plant-card-name">
          ${p.enabled ? '🌱' : '💤'}
          ${escapeHtml(p.name)}
        </div>
        <div class="plant-card-badges">
          <span class="badge ${p.type === 'url' ? 'badge-url' : 'badge-keyword'}">
            ${p.type === 'url' ? '🔗 URL' : '🔍 关键词'}
          </span>
          <span class="badge ${p.enabled ? 'badge-active' : 'badge-paused'}">
            ${p.enabled ? '监控中' : '已暂停'}
          </span>
        </div>
      </div>

      <div class="plant-card-info">
        <span>💰 价格上限: <strong>€${p.maxPrice || '不限'}</strong></span>
        ${p.type === 'url'
          ? `<span>🔗 URL: ${escapeHtml(p.url || '')}</span>`
          : `<span>🏷 关键词: ${(p.keywords || []).join(', ')}</span>`
        }
      </div>

      <div class="plant-card-actions">
        <button class="btn btn-outline btn-sm" onclick="editPlant(${i})">✏️ 编辑</button>
        <button class="btn btn-outline btn-sm" onclick="togglePlant(${i})">
          ${p.enabled ? '⏸ 暂停' : '▶ 启用'}
        </button>
        <button class="btn btn-danger btn-sm" onclick="deletePlant(${i})">🗑 删除</button>
      </div>
    </div>
  `).join('');

  updateUnsavedIndicator();
}

function updateUnsavedIndicator() {
  if (isDirty) {
    $('#btn-save-plants').style.display = '';
    $('#unsaved-indicator').style.display = '';
  } else {
    $('#btn-save-plants').style.display = 'none';
    $('#unsaved-indicator').style.display = 'none';
  }
}

function markDirty() {
  isDirty = true;
  localStorage.setItem(STORAGE_KEY_PLANTS, JSON.stringify(plants));
  updateUnsavedIndicator();
}

// ============ 植物操作 ============
function addPlant() {
  openPlantModal(-1);
}

function editPlant(index) {
  openPlantModal(index);
}

function togglePlant(index) {
  plants[index].enabled = !plants[index].enabled;
  markDirty();
  renderPlants();
  showToast('success', plants[index].enabled
    ? `✅ "${plants[index].name}" 已启用监控`
    : `⏸ "${plants[index].name}" 已暂停监控`);
}

function deletePlant(index) {
  const plant = plants[index];
  if (!confirm(`确定要删除 "${plant.name}" 吗？此操作不可恢复。`)) return;

  plants.splice(index, 1);
  markDirty();
  renderPlants();
  showToast('info', `已删除 "${plant.name}"`);
}

// ============ 模态框 ============
function initModals() {
  $('#btn-add-plant').addEventListener('click', () => openPlantModal(-1));
  $('#btn-close-modal').addEventListener('click', closeModal);
  $('#btn-cancel-modal').addEventListener('click', closeModal);
  $('#btn-confirm-modal').addEventListener('click', savePlantFromModal);
  $('#modal-overlay').addEventListener('click', (e) => {
    if (e.target === $('#modal-overlay')) closeModal();
  });

  // 类型切换
  $$('input[name="modal-type"]').forEach(radio => {
    radio.addEventListener('change', toggleModalType);
  });
}

function openPlantModal(editIndex) {
  $('#modal-edit-index').value = editIndex;
  $('#modal-title').textContent = editIndex >= 0 ? '编辑植物' : '添加新植物';

  if (editIndex >= 0) {
    const p = plants[editIndex];
    $('#modal-name').value = p.name || '';
    $$('input[name="modal-type"]').forEach(r => {
      r.checked = r.value === p.type;
    });
    $('#modal-url').value = p.url || '';
    $('#modal-keywords').value = (p.keywords || []).join(', ');
    $('#modal-price').value = p.maxPrice || '';
    $('#modal-enabled').checked = p.enabled !== false;
  } else {
    $('#modal-name').value = '';
    $$('input[name="modal-type"]')[0].checked = true;
    $('#modal-url').value = '';
    $('#modal-keywords').value = '';
    $('#modal-price').value = '';
    $('#modal-enabled').checked = true;
  }

  toggleModalType();
  $('#modal-overlay').style.display = 'flex';
  $('#modal-name').focus();
}

function closeModal() {
  $('#modal-overlay').style.display = 'none';
}

function toggleModalType() {
  const type = document.querySelector('input[name="modal-type"]:checked').value;
  $('#modal-url-group').style.display = type === 'url' ? '' : 'none';
  $('#modal-keywords-group').style.display = type === 'keyword' ? '' : 'none';
}

function savePlantFromModal() {
  const editIndex = parseInt($('#modal-edit-index').value);
  const type = document.querySelector('input[name="modal-type"]:checked').value;

  const name = $('#modal-name').value.trim();
  if (!name) { showToast('error', '请输入植物名称'); return; }

  const plant = {
    name,
    type,
    maxPrice: parseInt($('#modal-price').value) || 100,
    enabled: $('#modal-enabled').checked,
  };

  if (type === 'url') {
    plant.url = $('#modal-url').value.trim();
    if (!plant.url) { showToast('error', '请输入产品 URL'); return; }
    if (!plant.url.includes('wistuba.com')) {
      showToast('error', 'URL 必须来自 wistuba.com');
      return;
    }
  } else {
    const kw = $('#modal-keywords').value.trim();
    if (!kw) { showToast('error', '请输入至少一个关键词'); return; }
    plant.keywords = kw.split(',').map(k => k.trim()).filter(Boolean);
  }

  if (editIndex >= 0) {
    plants[editIndex] = plant;
    showToast('success', `✅ "${name}" 已更新`);
  } else {
    plants.push(plant);
    showToast('success', `✅ "${name}" 已添加`);
  }

  closeModal();
  markDirty();
  renderPlants();
}

// ============ GitHub 交互 ============
function initSettings() {
  $('#btn-connect-github').addEventListener('click', connectGitHub);
  $('#btn-save-plants').addEventListener('click', savePlantsToGitHub);

  // 回填已保存的 GitHub 信息
  if (gitHubInfo.user) $('#github-user').value = gitHubInfo.user;
  if (gitHubInfo.repo) $('#github-repo').value = gitHubInfo.repo;
  if (gitHubInfo.token) $('#github-token').value = gitHubInfo.token;
}

function loadSettings() {
  if (gitHubInfo.user) $('#github-user').value = gitHubInfo.user;
  if (gitHubInfo.repo) $('#github-repo').value = gitHubInfo.repo;
  if (gitHubInfo.token) $('#github-token').value = gitHubInfo.token;
}

function connectGitHub() {
  gitHubInfo.user = $('#github-user').value.trim();
  gitHubInfo.repo = $('#github-repo').value.trim();
  gitHubInfo.token = $('#github-token').value.trim();

  if (!gitHubInfo.user || !gitHubInfo.repo || !gitHubInfo.token) {
    showToast('error', '请填写完整的 GitHub 信息');
    return;
  }

  saveLocalState();
  fetchConfigFromGitHub();
}

async function fetchConfigFromGitHub() {
  if (!githubConnected) return;

  updateGitHubStatus('正在连接...', 'running');

  try {
    const response = await githubApi(`repos/${gitHubInfo.user}/${gitHubInfo.repo}/contents/${CONFIG_PATH}`);

    if (response.ok) {
      const data = await response.json();
      config = JSON.parse(atob(data.content));
      const configSha = data.sha;

      // 将 config.json 中的植物同步到 plants
      if (config.plants && config.plants.length > 0) {
        plants = config.plants;
        localStorage.setItem(STORAGE_KEY_PLANTS, JSON.stringify(plants));
        isDirty = false;
        renderPlants();
      }

      // 同步通知设置
      syncNotificationsFromConfig(config);

      updateGitHubStatus('已连接 ✅', 'connected');
      $('#github-status').textContent = `✅ 已连接，SHA: ${configSha.substring(0, 7)}`;
      showToast('success', '已从 GitHub 加载配置');
    } else if (response.status === 401) {
      updateGitHubStatus('Token 无效', 'disconnected');
      $('#github-status').textContent = '❌ Token 无效，请检查';
      showToast('error', 'GitHub Token 无效');
    } else if (response.status === 404) {
      updateGitHubStatus('仓库或文件不存在', 'disconnected');
      $('#github-status').textContent = '❌ 找不到仓库或 config.json';
      showToast('error', '找不到仓库，请检查用户名和仓库名');
    } else {
      updateGitHubStatus('连接失败', 'disconnected');
      $('#github-status').textContent = `❌ 错误: ${response.status}`;
    }
  } catch (e) {
    updateGitHubStatus('网络错误', 'disconnected');
    $('#github-status').textContent = `❌ 网络错误: ${e.message}`;
  }
}

async function savePlantsToGitHub() {
  if (!githubConnected) {
    showToast('error', '请先在「设置」中连接 GitHub');
    return;
  }

  updateGitHubStatus('正在保存...', 'running');

  try {
    // 先获取当前 config.json 的 SHA
    const getResp = await githubApi(`repos/${gitHubInfo.user}/${gitHubInfo.repo}/contents/${CONFIG_PATH}`);
    if (!getResp.ok) {
      showToast('error', '无法读取 config.json，请先连接 GitHub');
      return;
    }
    const { sha } = await getResp.json();

    // 更新 plants 字段
    if (!config) config = {};
    config.plants = plants;

    // 更新通知设置
    syncNotificationsToConfig();

    // 更新监控设置
    config.monitor = config.monitor || {};
    config.monitor.checkIntervalMinutes = parseInt($('#check-interval').value) || 15;
    config.monitor.autoAddToCart = $('#auto-add-cart').checked;

    const newContent = btoa(unescape(encodeURIComponent(JSON.stringify(config, null, 2))));
    const putResp = await githubApi(`repos/${gitHubInfo.user}/${gitHubInfo.repo}/contents/${CONFIG_PATH}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: '📝 更新监控配置 [通过管理面板]',
        content: newContent,
        sha: sha,
      }),
    });

    if (putResp.ok) {
      isDirty = false;
      updateUnsavedIndicator();
      updateGitHubStatus('已连接 ✅', 'connected');
      showToast('success', '✅ 配置已保存到 GitHub！下次 Actions 运行时会自动生效');
    } else {
      const err = await putResp.json();
      showToast('error', `保存失败: ${err.message}`);
    }
  } catch (e) {
    showToast('error', `保存失败: ${e.message}`);
  }
}

async function triggerManualCheck() {
  if (!githubConnected) {
    showToast('error', '请先在「设置」中连接 GitHub');
    return;
  }

  showToast('info', '正在触发手动检查...');

  try {
    const resp = await githubApi(
      `repos/${gitHubInfo.user}/${gitHubInfo.repo}/actions/workflows/monitor.yml/dispatches`,
      {
        method: 'POST',
        body: JSON.stringify({ ref: 'main' }),
      }
    );

    if (resp.ok || resp.status === 204) {
      showToast('success', '✅ 已触发手动检查，稍后在「运行日志」查看结果');
    } else if (resp.status === 404) {
      showToast('error', '未找到工作流，请确认仓库已 push 到 GitHub');
    } else {
      showToast('error', `触发失败: HTTP ${resp.status}`);
    }
  } catch (e) {
    showToast('error', `触发失败: ${e.message}`);
  }
}

async function loadLogs() {
  if (!githubConnected) {
    $('#log-list').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔌</div>
        <p>请先在「设置」中连接 GitHub</p>
      </div>`;
    return;
  }

  try {
    const resp = await githubApi(
      `repos/${gitHubInfo.user}/${gitHubInfo.repo}/actions/runs?per_page=10&branch=main`
    );

    if (!resp.ok) {
      $('#log-list').innerHTML = `<div class="empty-state"><p>无法加载日志</p></div>`;
      return;
    }

    const data = await resp.json();
    if (!data.workflow_runs || data.workflow_runs.length === 0) {
      $('#log-list').innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📭</div>
          <p>暂无运行记录</p>
          <p class="text-muted">Actions 还没运行过，第一次推送代码后会自动开始</p>
        </div>`;
      return;
    }

    $('#log-list').innerHTML = data.workflow_runs.map(run => `
      <div class="log-item">
        <div class="log-status">
          <span class="log-icon ${run.conclusion === 'success' ? 'success' : run.conclusion === 'failure' ? 'failure' : 'running'}"></span>
          <span>${run.name || '植物监控'}</span>
        </div>
        <span class="log-detail">
          ${run.conclusion || run.status}
          ${run.conclusion === 'success' ? '✅' : run.conclusion === 'failure' ? '❌' : '🔄'}
        </span>
        <span class="log-time">${new Date(run.created_at).toLocaleString('zh-CN')}</span>
        <a href="${run.html_url}" target="_blank" class="log-link">查看详情 →</a>
      </div>
    `).join('');

    // 更新状态栏
    const latestRun = data.workflow_runs[0];
    $('#last-check-time').textContent = latestRun
      ? `上次检查: ${new Date(latestRun.created_at).toLocaleString('zh-CN')}`
      : '尚未检查';
  } catch (e) {
    $('#log-list').innerHTML = `<div class="empty-state"><p>加载失败: ${e.message}</p></div>`;
  }
}

// ============ 通知设置 ============
function initNotifications() {
  $('#btn-save-notifications').addEventListener('click', saveNotifications);
}

function loadNotifications() {
  // 从 config 或 localStorage 加载通知设置
  try {
    const saved = localStorage.getItem('plant-monitor-notifications');
    if (saved) {
      const n = JSON.parse(saved);
      $('#pushplus-enabled').checked = n.pushplusEnabled !== false;
      $('#pushplus-token').value = n.pushplusToken || '';
      $('#email-enabled').checked = n.emailEnabled || false;
      $('#email-user').value = n.emailUser || '';
      $('#email-pass').value = n.emailPass || '';
      $('#email-to').value = n.emailTo || '';
    }
  } catch(e) { /* ignore */ }
}

function syncNotificationsFromConfig(cfg) {
  if (!cfg || !cfg.notifications) return;
  const n = cfg.notifications;
  if (n.pushplus) {
    $('#pushplus-enabled').checked = n.pushplus.enabled;
    $('#pushplus-token').value = n.pushplus.token || '';
  }
  if (n.email) {
    $('#email-enabled').checked = n.email.enabled;
    if (n.email.smtp) {
      $('#email-user').value = n.email.smtp.user || '';
      $('#email-pass').value = n.email.smtp.pass || '';
    }
    $('#email-to').value = n.email.to || '';
  }
  saveNotificationsLocally();
}

function syncNotificationsToConfig() {
  if (!config) config = {};
  config.notifications = {
    pushplus: {
      enabled: $('#pushplus-enabled').checked,
      token: $('#pushplus-token').value.trim(),
    },
    email: {
      enabled: $('#email-enabled').checked,
      smtp: {
        host: 'smtp.qq.com',
        port: 465,
        user: $('#email-user').value.trim(),
        pass: $('#email-pass').value.trim(),
      },
      to: $('#email-to').value.trim(),
    },
  };
}

function saveNotifications() {
  saveNotificationsLocally();
  syncNotificationsToConfig();
  if (!config) config = {};
  // 同步到 config（但不提交到 GitHub，等下次保存植物时一并提交）
  showToast('success', '✅ 通知设置已保存（下次保存植物清单时一起提交到 GitHub）');
}

function saveNotificationsLocally() {
  localStorage.setItem('plant-monitor-notifications', JSON.stringify({
    pushplusEnabled: $('#pushplus-enabled').checked,
    pushplusToken: $('#pushplus-token').value.trim(),
    emailEnabled: $('#email-enabled').checked,
    emailUser: $('#email-user').value.trim(),
    emailPass: $('#email-pass').value.trim(),
    emailTo: $('#email-to').value.trim(),
  }));
}

function updateGitHubStatus(text, status) {
  $('#status-text').textContent = text;
  const dot = $('#status-dot');
  dot.className = 'status-dot ' + status;
}

// ============ 辅助函数 ============
async function githubApi(path, opts = {}) {
  const url = `https://api.github.com/${path}`;
  const options = {
    headers: {
      'Authorization': `token ${gitHubInfo.token}`,
      'Accept': 'application/vnd.github.v3+json',
    },
    ...opts,
  };
  if (!options.headers['Content-Type'] && opts.body) {
    options.headers['Content-Type'] = 'application/json';
  }
  return fetch(url, options);
}

function showToast(type, message) {
  const container = $('#toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-hiding');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
