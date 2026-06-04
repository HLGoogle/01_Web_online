/**
 * functions/api/[[path]].js
 * 企业级重构版 - 修复安全漏洞、并发瓶颈与文件类型欺骗
 */

// 秘钥：用于 HMAC 签名 (如果在生产环境，请配置到 Cloudflare 环境变量 env.JWT_SECRET)
const SECRET_KEY = "hardcore_edge_secret_nav_2026"; 
const PWD_SALT = "_nav_salt_2026";

// Web Crypto API 辅助函数
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function signHMAC(text, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  if (method === 'OPTIONS') return new Response(null, { headers });

  // ==========================================
  // 📸 读取 KV 自定义图片 (保持不变)
  // ==========================================
  if (path.startsWith('/api/icon/') && method === 'GET') {
    const kvKey = path.split('/').pop();
    const placeholderPng = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,11,73,68,65,84,120,156,99,96,0,1,0,0,5,0,1,13,10,45,180,0,0,0,0,73,69,78,68,174,66,96,130]);
    if (!kvKey) return new Response(placeholderPng, { headers: { ...headers, "Content-Type": "image/png" } });
    try {
      const imageBuffer = await env.IMAGE_KV.get(kvKey, { type: "arrayBuffer" });
      if (!imageBuffer) return new Response(placeholderPng, { headers: { ...headers, "Content-Type": "image/png" } });
      let contentType = "image/png";
      if (kvKey.endsWith(".jpg") || kvKey.endsWith(".jpeg")) contentType = "image/jpeg";
      if (kvKey.endsWith(".gif")) contentType = "image/gif";
      if (kvKey.endsWith(".webp")) contentType = "image/webp";
      return new Response(imageBuffer, { headers: { 'Access-Control-Allow-Origin': '*', "Content-Type": contentType, "Cache-Control": "public, max-age=31536000, immutable" } });
    } catch(e) {
      return new Response(placeholderPng, { headers: { ...headers, "Content-Type": "image/png" } });
    }
  }

  // ==========================================
  // 🛡️ 鉴权网关：严格校验 HMAC 签名 Token
  // ==========================================
  let userId = null;
  const isProtected = path.startsWith('/api/links') || path.startsWith('/api/user') || path.startsWith('/api/code-grid');
  
  if (isProtected) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers });
    try {
      const token = authHeader.split(' ')[1];
      const parts = token.split('.');
      if (parts.length !== 2) throw new Error('Token格式非法'); // 拒绝旧版/伪造Token
      const expectedSig = await signHMAC(parts[0], env.JWT_SECRET || SECRET_KEY);
      if (expectedSig !== parts[1]) throw new Error('Token签名防伪失败');
      userId = atob(parts[0]).split(':')[0];
      if (!userId) throw new Error('提取身份失败');
    } catch (e) {
      return new Response(JSON.stringify({ error: '身份凭证无效或过期，请重新登录' }), { status: 401, headers });
    }
  }

  try {
    // ========================================== 
    // 🎴 记事条模块 (修复并发请求洪峰 N+1 问题)
    // ========================================== 
    if (path.startsWith('/api/code-grid')) {
      if (method === 'GET') {
        const rows = await env.DB.prepare('SELECT id, user_id, row_data, sort_order FROM Web_code_rows WHERE user_id = ? ORDER BY sort_order ASC, id DESC').bind(userId).all();
        const parsedRows = rows.results.map(r => ({ id: r.id, data: JSON.parse(r.row_data), sort_order: r.sort_order }));
        return new Response(JSON.stringify({ rows: parsedRows }), { headers });
      }

      const body = await request.json();

      if (method === 'POST') {
        // 🚀 核心优化：利用 D1 batch API 处理批量请求
        if (body.items && Array.isArray(body.items)) {
          const stmts = body.items.map(item => {
            const rowDataStr = JSON.stringify(item.data);
            if (item.id) {
              return env.DB.prepare('UPDATE Web_code_rows SET row_data = ?, sort_order = ? WHERE id = ? AND user_id = ?').bind(rowDataStr, item.sort_order || 0, item.id, userId);
            } else {
              return env.DB.prepare('INSERT INTO Web_code_rows (user_id, row_data, sort_order) VALUES (?, ?, ?)').bind(userId, rowDataStr, item.sort_order || 0);
            }
          });
          await env.DB.batch(stmts); // 1个请求搞定所有行
          return new Response(JSON.stringify({ success: true }), { headers });
        }
        // 兼容遗留的单条 POST 逻辑
        const rowDataStr = JSON.stringify(body.data);
        if (body.id) await env.DB.prepare('UPDATE Web_code_rows SET row_data=?, sort_order=? WHERE id=? AND user_id=?').bind(rowDataStr, body.sort_order || 0, body.id, userId).run();
        else await env.DB.prepare('INSERT INTO Web_code_rows (user_id, row_data, sort_order) VALUES (?, ?, ?)').bind(userId, rowDataStr, body.sort_order || 0).run();
        return new Response(JSON.stringify({ success: true }), { headers });
      }

      if (method === 'DELETE') {
        await env.DB.prepare('DELETE FROM Web_code_rows WHERE id = ? AND user_id = ?').bind(body.id, userId).run();
        return new Response(JSON.stringify({ success: true }), { headers });
      }
    }

    // ==========================================
    // 📸 用户直传图标 (修复 MIME 伪装欺骗漏洞)
    // ==========================================
    if (path === '/api/user/upload-icon' && method === 'POST') {
      const originalName = url.searchParams.get("name") || "icon.png";
      const extension = originalName.split('.').pop().toLowerCase();
      const imageBlob = await request.arrayBuffer();
      if (!imageBlob || imageBlob.byteLength === 0) return new Response(JSON.stringify({ success: false, error: "上传文件不可为空" }), { status: 400, headers });
      if (imageBlob.byteLength > 2 * 1024 * 1024) return new Response(JSON.stringify({ success: false, error: "体积不可超过2MB" }), { status: 400, headers });

      // 🛡️ 读取前4个字节检查 Magic Number
      const arr = new Uint8Array(imageBlob).subarray(0, 4);
      const headerHex = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
      let validFile = false;
      if (headerHex.startsWith('89504E47')) validFile = true; // PNG
      else if (headerHex.startsWith('FFD8FF')) validFile = true; // JPEG
      else if (headerHex.startsWith('47494638')) validFile = true; // GIF
      else if (headerHex.startsWith('52494646')) validFile = true; // WEBP (RIFF)

      if (!validFile) return new Response(JSON.stringify({ success: false, error: "安全拦截：请上传真实的图片文件" }), { status: 400, headers });

      const kvKey = `user_${userId}_${Date.now()}.${extension}`;
      await env.IMAGE_KV.put(kvKey, imageBlob);
      return new Response(JSON.stringify({ success: true, kvKey, url: `/api/icon/${kvKey}` }), { headers: { ...headers, "Content-Type": "application/json" } });
    }

    // ==========================================
    // 🔐 用户管理模块 (修复密码明文存储漏洞)
    // ==========================================
    if (path === '/api/auth' && method === 'POST') {
      const body = await request.json();
      const { action, username, password, reset_code, new_password } = body;
      
      if (action === 'register') {
        const existing = await env.DB.prepare('SELECT id FROM Web_online_users_00 WHERE username = ?').bind(username).first();
        if (existing) throw new Error('该用户名已存在');
        const hashedPassword = await sha256(password + PWD_SALT);
        await env.DB.prepare('INSERT INTO Web_online_users_00 (username, password, reset_code, settings) VALUES (?, ?, ?, ?)')
          .bind(username, hashedPassword, reset_code, '{"sensitivity": 50}').run();
        return new Response(JSON.stringify({ success: true }), { headers });
      }

      if (action === 'login') {
        const user = await env.DB.prepare('SELECT id, username, settings, password FROM Web_online_users_00 WHERE username = ?').bind(username).first();
        if (!user) return new Response(JSON.stringify({ success: false, error: '账号或密码错误' }), { status: 401, headers });
        
        const hashedInput = await sha256(password + PWD_SALT);
        // ⚠️ 数据库平滑升级机制：同时对比新Hash和老明文，匹配明文则静默帮用户升级为Hash存储
        if (user.password !== hashedInput && user.password !== password) {
            return new Response(JSON.stringify({ success: false, error: '账号或密码错误' }), { status: 401, headers });
        }
        if (user.password === password) {
            await env.DB.prepare('UPDATE Web_online_users_00 SET password = ? WHERE id = ?').bind(hashedInput, user.id).run();
        }

        // 颁发安全的签名 Token: base64(payload).signature
        const payload = btoa(`${user.id}:${user.username}`);
        const signature = await signHMAC(payload, env.JWT_SECRET || SECRET_KEY);
        const token = `${payload}.${signature}`;

        return new Response(JSON.stringify({ success: true, token, username: user.username, settings: user.settings || '{"sensitivity": 50}' }), { headers });
      }

      if (action === 'reset') {
        const user = await env.DB.prepare('SELECT id FROM Web_online_users_00 WHERE username = ? AND reset_code = ?').bind(username, reset_code).first();
        if (!user) return new Response(JSON.stringify({ success: false, error: '安全编码未通过' }), { status: 403, headers });
        const hashedNewPwd = await sha256(new_password + PWD_SALT);
        await env.DB.prepare('UPDATE Web_online_users_00 SET password = ? WHERE id = ?').bind(hashedNewPwd, user.id).run();
        return new Response(JSON.stringify({ success: true }), { headers });
      }
    }

    // ==========================================
    // 🗂️ 书签与配置模块 (保持不变)
    // ==========================================
    if (path === '/api/links') {
      if (method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM Web_online_info_01 WHERE user_id = ? ORDER BY sort_order ASC, created_at DESC').bind(userId).all();
        return new Response(JSON.stringify(results), { headers });
      }
      const body = await request.json();
      if (method === 'POST') {
        await env.DB.prepare('INSERT INTO Web_online_info_01 (user_id, type, url, icon, comment, note, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(userId, body.type, body.url, body.icon, body.comment, body.note, body.sort_order || 0).run();
        return new Response(JSON.stringify({ success: true }), { headers });
      }
      if (method === 'PUT') {
        await env.DB.prepare('UPDATE Web_online_info_01 SET type=?, url=?, icon=?, comment=?, note=?, sort_order=? WHERE id=? AND user_id=?')
          .bind(body.type, body.url, body.icon, body.comment, body.note, body.sort_order, body.id, userId).run();
        return new Response(JSON.stringify({ success: true }), { headers });
      }
      if (method === 'DELETE') {
        const currentLink = await env.DB.prepare('SELECT icon FROM Web_online_info_01 WHERE id = ? AND user_id = ?').bind(body.id, userId).first();
        if (currentLink && currentLink.icon && currentLink.icon.startsWith('user_')) await env.IMAGE_KV.delete(currentLink.icon);
        await env.DB.prepare('DELETE FROM Web_online_info_01 WHERE id = ? AND user_id = ?').bind(body.id, userId).run();
        return new Response(JSON.stringify({ success: true }), { headers });
      }
    }

    if (path === '/api/user' && method === 'PUT') {
      const { settings } = await request.json();
      await env.DB.prepare('UPDATE Web_online_users_00 SET settings = ? WHERE id = ?').bind(JSON.stringify(settings), userId).run();
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers });

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers });
  }
}
