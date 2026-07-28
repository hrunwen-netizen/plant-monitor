/**
 * 自动加购模块 — 将商品加入 wistuba.com 购物车
 *
 * 注意：这是实验性功能，受以下因素限制：
 * 1. Shopware 可能有 CSRF 保护
 * 2. 网站可能使用 JavaScript 处理表单提交
 * 3. 需要先处理 Cookie 同意弹窗
 * 4. 某些产品需要选择 Clone/Size 选项
 *
 * 使用方法：在 config.json 中设置
 *   "monitor": { "autoAddToCart": true, "cartNotifyOnly": true }
 *
 * cartNotifyOnly = true 时，加购失败也会发送通知提醒手动购买
 */
const { log } = require('./utils');

/**
 * 处理 Cookie 同意弹窗（如果存在）
 * @param {import('playwright').Page} page
 */
async function handleCookieConsent(page) {
  try {
    // Shopware/ThemeWare 通常有这样的Cookie按钮
    const acceptBtn = await page.$(
      'button:has-text("Accept all cookies"), ' +
      'button:has-text("Accept all"), ' +
      'button:has-text("Alle akzeptieren"), ' +
      '.js-offcanvas-cookie-accept-all, ' +
      '[data-cookie-accept-all="true"]'
    );
    if (acceptBtn) {
      await acceptBtn.click();
      log('INFO', '[加购] 已接受 Cookie');
      await page.waitForTimeout(1000);
    }
  } catch (e) {
    // Cookie弹窗处理失败不影响主流程
  }
}

/**
 * 将产品加入购物车
 * @param {import('playwright').Page} page Playwright Page 对象
 * @param {Object} plant 植物配置（URL模式）
 * @returns {Promise<Object>} 加购结果
 */
async function addToCart(page, plant) {
  if (plant.type !== 'url') {
    return {
      success: false,
      error: '只有URL模式的植物支持自动加购',
      product: plant.name,
    };
  }

  log('INFO', `[加购] 尝试将 "${plant.name}" 加入购物车...`);

  try {
    // 1. 访问产品页面
    await page.goto(plant.url, { waitUntil: 'networkidle', timeout: 30000 });
    await handleCookieConsent(page);

    // 2. 检查页面是否为404
    const title = await page.title();
    if (title.includes('404')) {
      return { success: false, error: '产品页面不存在', product: plant.name };
    }

    // 3. 检查是否已售罄
    const bodyText = await page.textContent('body');
    if (bodyText.includes('Sold out')) {
      return { success: false, error: '产品已售罄', product: plant.name };
    }

    // 4. 处理选项选择（Clone / Size 等下拉框）
    await selectDefaultOptions(page);

    // 5. 点击 "Add to shopping cart" 按钮
    const addBtn = await page.$('button:has-text("Add to shopping cart")');
    if (!addBtn) {
      return { success: false, error: '未找到加购按钮', product: plant.name };
    }

    await addBtn.click();
    log('INFO', '[加购] 已点击加购按钮');
    await page.waitForTimeout(3000);

    // 6. 验证加购是否成功
    // 检查购物车是否更新（通常侧边栏购物车金额会变化）
    const cartResult = await verifyCartUpdate(page);

    if (cartResult.added) {
      log('INFO', `[加购] ✅ 成功将 "${plant.name}" 加入购物车！购物车总额: ${cartResult.cartTotal}`);
      return {
        success: true,
        product: plant.name,
        cartTotal: cartResult.cartTotal,
        message: `已自动加入购物车。请尽快付款！`,
      };
    } else {
      log('WARN', `[加购] ⚠️ 加购操作已执行，但无法确认是否成功。${cartResult.reason}`);
      return {
        success: false,
        partialSuccess: true,
        product: plant.name,
        error: cartResult.reason || '加购状态未确认',
        message: '加购操作已执行但无法确认，请手动检查购物车',
      };
    }

  } catch (error) {
    log('ERROR', `[加购] "${plant.name}" 加购失败: ${error.message}`);
    return { success: false, error: error.message, product: plant.name };
  }
}

/**
 * 选择默认的 Clone/Size 等选项
 */
async function selectDefaultOptions(page) {
  try {
    // Shopware 常见的选择器
    const selectors = [
      'select[name*="option"]',
      'select[id*="option"]',
      'select[data-selector="option"]',
      '.product-detail-configurator select',
      '.custom-select',
    ];

    for (const selector of selectors) {
      const selects = await page.$$(selector);
      for (const select of selects) {
        try {
          // 检查是否可见
          const visible = await select.isVisible();
          if (!visible) continue;

          // 获取所有选项，选择第一个非空值的选项（通常是第二个，第一个可能是 "Please select"）
          const options = await select.$$eval('option', (opts) =>
            opts.map((o) => ({ value: o.value, text: o.text.trim() }))
          );

          if (options.length > 1) {
            // 跳过 "Please select" / "Bitte wählen" 等占位选项
            const validOption = options.find(
              (o) => o.value && !o.text.includes('select') && !o.text.includes('wählen')
            );
            if (validOption) {
              await select.selectOption(validOption.value);
              log('INFO', `[加购] 已选择选项: ${validOption.text}`);
              await page.waitForTimeout(500);
            }
          }
        } catch (e) {
          // 单个选择器失败不影响其他
        }
      }
    }
  } catch (e) {
    log('WARN', `[加购] 选项选择过程出错: ${e.message}`);
  }
}

/**
 * 验证购物车是否更新
 */
async function verifyCartUpdate(page) {
  try {
    // 方法1：检查页面上的成功提示
    const successSelectors = [
      '.alert-success',
      '.alert.alert-success',
      '[class*="success"]',
      '.offcanvas.is-open',  // Shopware通常会在加购后弹出侧边栏
    ];

    for (const sel of successSelectors) {
      const el = await page.$(sel);
      if (el) {
        const text = await el.textContent();
        if (text.includes('cart') || text.includes('shopping') || text.includes('Warenkorb') || text.includes('added')) {
          // 提取购物车总额
          const cartTotal = await getCartTotal(page);
          return { added: true, cartTotal };
        }
      }
    }

    // 方法2：检查购物车图标金额是否变化
    const cartTotal = await getCartTotal(page);
    if (cartTotal && cartTotal !== '€0.00') {
      return { added: true, cartTotal };
    }

    // 方法3：检查按钮是否变为 "1x in cart" 或类似文字
    const inCartBtn = await page.$(
      'button:has-text("in cart"), button:has-text("In cart"), ' +
      'button:has-text("im Warenkorb"), .is-in-cart'
    );
    if (inCartBtn) {
      const cartTotal = await getCartTotal(page);
      return { added: true, cartTotal };
    }

    return { added: false, reason: '未检测到购物车更新信号' };
  } catch (e) {
    return { added: false, reason: e.message };
  }
}

/**
 * 获取购物车总额
 */
async function getCartTotal(page) {
  try {
    const cartSelectors = [
      '.header-cart-total',
      '.cart-total-price',
      '[class*="cart-total"]',
      'a[href*="cart"] span',
      '.btn-basket span',
    ];
    for (const sel of cartSelectors) {
      const el = await page.$(sel);
      if (el) {
        const text = await el.textContent();
        if (text.includes('€')) {
          return text.trim();
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

module.exports = { addToCart };
