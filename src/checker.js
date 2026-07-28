/**
 * 库存检查模块 — 检查 wistuba.com 上植物的可用性
 * 支持两种模式：URL精确监控 和 关键词模糊搜索
 */
const { log, buildSearchUrl } = require('./utils');

/**
 * 检查单个URL产品页面（模式A：精确URL监控）
 * @param {import('playwright').Page} page
 * @param {Object} plant 植物配置
 * @returns {Promise<Object>} 检查结果
 */
async function checkByUrl(page, plant) {
  const result = {
    name: plant.name,
    url: plant.url,
    type: 'url',
    status: 'unknown',
    price: null,
    error: null,
  };

  try {
    log('INFO', `[URL检查] 正在访问: ${plant.url}`);
    await page.goto(plant.url, { waitUntil: 'networkidle', timeout: 30000 });

    // 获取页面文本内容用于分析
    const bodyText = await page.textContent('body');

    // 检查是否是404或页面不存在
    if (
      bodyText.includes('Page not found') ||
      bodyText.includes('page not found') ||
      bodyText.includes('not be found')
    ) {
      result.status = 'page_not_found';
      log('WARN', `[URL检查] ${plant.name}: 页面不存在 (404)`);
      return result;
    }

    // 检查 "Sold out" 状态 (布尔语和其他语言)
    const soldOut =
      bodyText.includes('Sold out') ||
      bodyText.includes('Sold Out') ||
      bodyText.includes('Ausverkauft');

    // 检查是否有 "Add to shopping cart" 按钮
    const addToCartBtn = await page.$('button:has-text("Add to shopping cart")');

    // 检查加购按钮是否可用（disabled = 缺货或某个size选项不可用）
    let addToCartEnabled = false;
    if (addToCartBtn) {
      addToCartEnabled = !(await addToCartBtn.isDisabled());
    }

    // 检查是否有 disabled 的 option（某些 size 缺货）
    const disabledOptions = await page.$$('.product-detail-configurator-option-input:disabled, .product-detail-configurator-option-input.not-combinable');
    const hasDisabledOptions = disabledOptions.length > 0;

    // 检查是否有可用的 option
    const enabledOptions = await page.$$('.product-detail-configurator-option-input:not(:disabled):not(.not-combinable)');
    const hasEnabledOptions = enabledOptions.length > 0;

    // 提取所有可用的 size/option 信息
    let availableOptions = [];
    try {
      const optionLabels = await page.$$('.product-detail-configurator-option-label:not(.disabled)');
      for (const label of optionLabels) {
        const text = await label.textContent();
        if (text && text.trim()) {
          availableOptions.push(text.trim());
        }
      }
    } catch (e) { /* ignore */ }

    // 检查是否显示 "Currently not available" —— Shopware缺货标志
    const currentlyNotAvailable =
      bodyText.includes('Currently not available') ||
      bodyText.includes('currently not available');

    // 检查是否有 "Notify me" 按钮 —— 缺货但有到货通知功能的标志
    const hasNotifyMeBtn = await page.$('button:has-text("Notify me")');

    // 检查 "Short supply" 标签
    const isShortSupply = bodyText.includes('Short supply');

    // 检查 "New" 标签
    const isNew = bodyText.includes('New');

    // 提取价格信息
    let price = null;
    try {
      // Shopware 价格选择器
      const priceEl = await page.$('.product-detail-price');
      if (priceEl) {
        const priceText = await priceEl.textContent();
        const match = priceText.match(/€\s*([\d.,]+)/);
        if (match) {
          price = parseFloat(match[1].replace(',', '.'));
        }
      }
      // 备用：找任何包含 € 的价格元素（排除购物车 €0.00）
      if (!price) {
        const priceMatches = bodyText.match(/€\s*([\d,.]+)/g);
        if (priceMatches && priceMatches.length > 1) {
          // 跳过购物车的 €0.00，取第二个价格
          for (const pm of priceMatches) {
            if (!pm.includes('0.00')) {
              const m = pm.match(/[\d,.]+/);
              if (m) {
                price = parseFloat(m[0].replace(',', '.'));
                break;
              }
            }
          }
        }
      }
    } catch (e) {
      // 价格提取失败不影响整体判断
    }

    // 判断最终状态
    if (soldOut) {
      result.status = 'sold_out';
      result.price = price;
      log('INFO', `[URL检查] ${plant.name}: 已售罄`);
    } else if (addToCartBtn && addToCartEnabled) {
      // 有可用的加购按钮 - 可购买！
      result.status = isShortSupply ? 'short_supply' : 'available';
      result.price = price;
      result.options = availableOptions;
      log('INFO', `[URL检查] ${plant.name}: ✅ 可购买！状态=${result.status}, 价格=€${price}${availableOptions.length > 0 ? ', 可选规格: ' + availableOptions.join(' | ') : ''}`);
    } else if (addToCartBtn && !addToCartEnabled && hasEnabledOptions) {
      // 加购按钮被禁用但有可选option — 可能是没选规格
      result.status = 'available';
      result.price = price;
      result.options = availableOptions;
      result.error = '需要选择规格';
      log('INFO', `[URL检查] ${plant.name}: 有可选规格但需选择 — 价格=€${price}, 可选: ${availableOptions.join(' | ')}`);
    } else if (addToCartBtn && !addToCartEnabled) {
      // 有加购按钮但被禁用且无可选option — 缺货
      result.status = 'sold_out';
      result.price = price;
      log('INFO', `[URL检查] ${plant.name}: 加购按钮已禁用，当前缺货`);
    } else if (hasNotifyMeBtn || currentlyNotAvailable) {
      // 有Notify me按钮 - 当前缺货
      result.status = 'sold_out';
      result.price = price;
      log('INFO', `[URL检查] ${plant.name}: 当前缺货（可登记到货通知）`);
    } else {
      // 其他情况
      result.status = 'unknown';
      result.price = price;
      result.error = '无法确定产品状态';
      log('WARN', `[URL检查] ${plant.name}: 状态未知`);
    }

  } catch (error) {
    result.status = 'error';
    result.error = error.message;
    log('ERROR', `[URL检查] ${plant.name}: 访问失败 - ${error.message}`);
  }

  return result;
}

/**
 * 通过关键词搜索检查（模式B：模糊搜索）
 * @param {import('playwright').Page} page
 * @param {Object} plant 植物配置
 * @param {import('playwright').BrowserContext} context
 * @returns {Promise<Object[]>} 搜索结果列表
 */
async function checkByKeywords(page, plant) {
  const results = [];

  for (const keyword of plant.keywords) {
    try {
      const searchUrl = buildSearchUrl(keyword);
      log('INFO', `[关键词搜索] "${keyword}": 正在搜索...`);
      await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });

      // 等待搜索结果加载
      await page.waitForTimeout(2000);

      // 获取搜索结果总数
      const bodyText = await page.textContent('body');
      const countMatch = bodyText.match(/(\d+)\s*products?\s*found/i);
      const totalCount = countMatch ? parseInt(countMatch[1]) : 0;

      if (totalCount === 0) {
        log('INFO', `[关键词搜索] "${keyword}": 未找到产品`);
        results.push({
          name: plant.name,
          keyword,
          type: 'keyword',
          found: false,
          totalResults: 0,
          products: [],
        });
        continue;
      }

      log('INFO', `[关键词搜索] "${keyword}": 找到 ${totalCount} 个产品`);

      // 解析搜索结果中的产品卡片
      const products = await parseSearchResults(page, plant);

      results.push({
        name: plant.name,
        keyword,
        type: 'keyword',
        found: products.length > 0,
        totalResults: totalCount,
        products,
      });

    } catch (error) {
      log('ERROR', `[关键词搜索] "${keyword}": 搜索失败 - ${error.message}`);
      results.push({
        name: plant.name,
        keyword,
        type: 'keyword',
        found: false,
        error: error.message,
        products: [],
      });
    }
  }

  return results;
}

/**
 * 解析搜索结果页面中的产品卡片
 */
async function parseSearchResults(page, plant) {
  const products = [];

  try {
    // Shopware 的搜索结果通常使用 .cms-listing-col 作为卡片容器
    // 尝试多种可能的选择器
    const selectors = [
      '.cms-listing-col',
      '.product-box',
      '.product--box',
      '[class*="product-box"]',
      '.card.product-box',
    ];

    let productCards = [];
    for (const sel of selectors) {
      productCards = await page.$$(sel);
      if (productCards.length > 0) {
        log('INFO', `[解析] 使用选择器 "${sel}" 找到 ${productCards.length} 个产品卡片`);
        break;
      }
    }

    // 如果找不到卡片，尝试通过链接解析
    if (productCards.length === 0) {
      log('WARN', '[解析] 未找到产品卡片容器，尝试备用解析方式');
      // 查找所有包含产品详情链接的元素
      const detailLinks = await page.$$('a[href*="/detail/"]');
      // 简单处理：不解析每个卡片，改为直接检查搜索结果页面整体
      const bodyText = await page.textContent('body');

      // 检查是否有非 sold-out 产品
      const soldOutCount = (bodyText.match(/Sold out/gi) || []).length;
      log('INFO', `[解析] 搜索页面包含 ${soldOutCount} 个 "Sold Out" 标记`);

      // 这里简化处理：如果搜索结果中有非soldout的链接就可以
      return products;
    }

    // 遍历每个产品卡片
    for (const card of productCards) {
      try {
        const cardText = await card.textContent();

        // 跳过 "Sold Out" 产品
        if (cardText.includes('Sold out')) {
          continue;
        }

        // 提取产品链接
        const linkEl = await card.$('a[href*="/detail/"], a.product-name, a[class*="product-name"]');
        let productUrl = null;
        let productName = null;

        if (linkEl) {
          productUrl = await linkEl.getAttribute('href');
          productName = (await linkEl.textContent()).trim();

          // 确保URL是完整的
          if (productUrl && !productUrl.startsWith('http')) {
            productUrl = 'https://wistuba.com' + productUrl;
          }
        }

        // 提取价格
        let price = null;
        const priceMatch = cardText.match(/€\s*([\d,.]+)/);
        if (priceMatch) {
          price = parseFloat(priceMatch[1].replace(',', '.'));
        }

        // 检查状态标签
        let status = 'available';
        if (cardText.includes('Short supply')) status = 'short_supply';
        if (cardText.includes('New')) status = 'new';

        // 价格过滤
        if (plant.maxPrice && price && price > plant.maxPrice) {
          log('INFO', `[解析] 跳过 "${productName}" — 价格 €${price} 超出预算 €${plant.maxPrice}`);
          continue;
        }

        if (productName || productUrl) {
          products.push({
            name: productName || '未知产品',
            url: productUrl,
            price,
            status,
          });
        }
      } catch (e) {
        // 单个卡片解析失败不影响其他
      }
    }

    // 如果有分页，检查是否要翻页（最多翻3页）
    if (products.length === 0) {
      const nextPageBtn = await page.$('a[aria-label="Next"], .pagination .page-link[rel="next"], .page-next a');
      if (nextPageBtn) {
        for (let pageNum = 2; pageNum <= 4; pageNum++) {
          try {
            await nextPageBtn.click();
            await page.waitForTimeout(2000);
            const moreProducts = await parseSearchResults(page, plant);
            products.push(...moreProducts);
            if (moreProducts.length > 0) break;
          } catch (e) {
            break;
          }
        }
      }
    }

  } catch (e) {
    log('ERROR', `[解析] 解析搜索结果失败: ${e.message}`);
  }

  return products;
}

/**
 * 主检查函数：对单个植物执行检查
 * @param {import('playwright').Page} page
 * @param {Object} plant 植物配置
 * @returns {Promise<Object>} 统一的检查结果
 */
async function checkPlant(page, plant) {
  if (!plant.enabled) {
    return { skipped: true, name: plant.name };
  }

  log('INFO', `========== 检查: ${plant.name} (类型: ${plant.type}) ==========`);

  if (plant.type === 'url') {
    const result = await checkByUrl(page, plant);

    // 判断是否需要通知
    const available = result.status === 'available' || result.status === 'short_supply';
    const notifyStatus = available ? 'available' : (result.status === 'sold_out' ? 'sold_out' : 'unknown');

    return {
      ...result,
      available,
      notifyStatus,
    };
  }

  if (plant.type === 'keyword') {
    const searchResults = await checkByKeywords(page, plant);

    // 汇总所有搜索结果中的可购买产品
    const availableProducts = [];
    for (const sr of searchResults) {
      if (sr.products && sr.products.length > 0) {
        availableProducts.push(...sr.products.filter(p => p.status !== 'sold_out'));
      }
    }

    return {
      name: plant.name,
      type: 'keyword',
      status: availableProducts.length > 0 ? 'available' : 'sold_out',
      available: availableProducts.length > 0,
      notifyStatus: availableProducts.length > 0 ? 'available' : 'sold_out',
      products: availableProducts,
      searchResults,
    };
  }

  return { name: plant.name, type: 'unknown', error: '未知的检查类型' };
}

module.exports = { checkPlant, checkByUrl, checkByKeywords };
