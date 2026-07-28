/**
 * 设置 GitHub Secrets 的脚本
 */
const https = require('https');
const sodium = require('libsodium-wrappers');

const TOKEN = process.argv[2];
const OWNER = process.argv[3];
const REPO = process.argv[4];
const SECRET_NAME = process.argv[5];
const SECRET_VALUE = process.argv[6];

async function setSecret() {
  await sodium.ready;

  // 1. 获取公钥
  const pubKey = await getPublicKey();
  console.log('公钥 ID:', pubKey.key_id);

  // 2. 加密 secret
  const binkey = sodium.from_base64(pubKey.key, sodium.base64_variants.ORIGINAL);
  const binsec = sodium.from_string(SECRET_VALUE);
  const encBytes = sodium.crypto_box_seal(binsec, binkey);
  const encrypted = sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL);

  // 3. 提交 secret
  await putSecret(pubKey.key_id, encrypted);
  console.log(`✅ Secret "${SECRET_NAME}" 设置成功`);
}

function getPublicKey() {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com',
      path: `/repos/${OWNER}/${REPO}/actions/secrets/public-key`,
      method: 'GET',
      headers: {
        'Authorization': 'token ' + TOKEN,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'plant-monitor',
      },
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error('获取公钥失败: ' + res.statusCode + ' ' + body));
        } else {
          resolve(JSON.parse(body));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function putSecret(keyId, encryptedValue) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ encrypted_value: encryptedValue, key_id: keyId });
    const req = https.request({
      hostname: 'api.github.com',
      path: `/repos/${OWNER}/${REPO}/actions/secrets/${SECRET_NAME}`,
      method: 'PUT',
      headers: {
        'Authorization': 'token ' + TOKEN,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': 'plant-monitor',
      },
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode === 201 || res.statusCode === 204) {
          resolve();
        } else {
          reject(new Error('设置 secret 失败: ' + res.statusCode + ' ' + body));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

setSecret().catch(e => { console.error('错误:', e.message); process.exit(1); });
