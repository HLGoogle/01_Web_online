/**
 * functions/api/[[path]].js
 * 终极完整版 - 已集成全部模块 + 纯流直传修复 500 报错
 */

const SECRET_KEY = "hardcore_edge_secret_nav_2026"; 
const PWD_SALT = "_nav_salt_2026";

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
  // 📸 模块 1：读取 KV 自定义图片
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
  // 🛡️ 模块 2：安全网关（严格拦截与动态鉴权）
  // ==========================================
  let userId = null;
  const isProtected = path.includes('api/links') || path.includes('api/user') || path.includes('api/code-grid') || path.includes('cloud');
  
  if (isProtected) {
    let authHeader = request.headers.get('Authorization');
    if (!authHeader && url.searchParams.get('auth')) {
      authHeader = `Bearer ${url.searchParams.get('auth')}`;
    }

    if (!authHeader) return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers });
    try {
      const token = authHeader.split(' ')[1];
      const parts = token.split('.');
      if (parts.length !== 2) throw new Error('Token格式非法'); 
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
    // ☁️ 🚀 模块 3：云盘核心高级模块 (D1 SQL + R2 联动)
    // ========================================== 
    if (path.includes('cloud')) {
      // 3.1 获取专属云盘列表
      if (path.includes('list') && method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT * FROM cloud_files WHERE user_id = ? ORDER BY created_at DESC'
        ).bind(userId).all();
        return new Response(JSON.stringify({ success: true, data: results }), { headers });
      }

      // 3.2 🌟 纯原生流直传 + 严格类型转换入库 (已修复 500 报错)
      if (path.includes('upload') && method === 'POST') {
        if (!env.MY_BUCKET) return new Response(JSON.stringify({ success: false, error: "未绑定 R2 存储桶 (MY_BUCKET)" }), { status: 500, headers });
        if (!env.DB) return new Response(JSON.stringify({ success: false, error: "未绑定 D1 数据库 (DB)" }), { status: 500, headers });

        // 🚨 将 URL 提取的参数严格强制转换类型，保证 fileSize 绝对是 Number
        const fileName = String(url.searchParams.get("name") || "unknown_file.bin");
        const fileSize = Number(url.searchParams.get("size")) || 0; 
        const fileType = String(url.searchParams.get("type") || "application/octet-stream");

        const r2Key = `${userId}/${Date.now()}_${fileName}`;

        try {
          // 原生流直传
          await env.MY_BUCKET.put(r2Key, request.body, {
            httpMetadata: { contentType: fileType }
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: "R2 写入失败: " + err.message }), { status: 500, headers });
        }

        try {
          // 🚨 严格以类型安全的格式写入 D1
          await env.DB.prepare(
            'INSERT INTO cloud_files (user_id, file_name, r2_key, file_size, file_type) VALUES (?, ?, ?, ?, ?)'
          ).bind(String(userId), fileName, r2Key, fileSize, fileType).run();
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: "D1 登记失败: " + err.message }), { status: 500, headers });
        }

        return new Response(JSON.stringify({ success: true, message: "上传成功" }), { headers });
      }

      // 3.3 双端物理擦除
      if (path.includes('delete') && method === 'DELETE') {
        const id = url.searchParams.get("id");
        if (!id) return new Response(JSON.stringify({ success: false, error: "缺少文件ID" }), { status: 400, headers });

        const fileInfo = await env.DB.prepare(
          'SELECT r2_key FROM cloud_files WHERE id = ? AND user_id = ?'
        ).bind(id, userId).first();

        if (!fileInfo) return new Response(JSON.stringify({ success: false, error: "文件不存在或无权操作" }), { status: 404, headers });

        await env.MY_BUCKET.delete(fileInfo.r2_key);
        await env.DB.prepare('DELETE FROM cloud_files WHERE id = ?').bind(id).run();

        return new Response(JSON.stringify({ success: true, message: "删除成功" }), { headers });
      }

      // 3.4 极速大文件边缘拉取流
      if (path.includes('download') && method === 'GET') {
        const id = url.searchParams.get("id");
        
        const fileInfo = await env.DB.prepare(
          'SELECT file_name, r2_key, file_type FROM cloud_files WHERE id = ? AND user_id = ?'
        ).bind(id, userId).first();

        if (!fileInfo) return new Response("文件不存在或无权限", { status: 404, headers });

        const r2Object = await env.MY_BUCKET.get(fileInfo.r2_key);
        if (!r2Object) return new Response("存储桶中未找到该文件体", { status: 404, headers });

        const downloadHeaders = new Headers();
        r2Object.writeHttpMetadata(downloadHeaders);
        downloadHeaders.set("etag", r2Object.httpEtag);
        downloadHeaders.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileInfo.file_name)}`);
        downloadHeaders.set('Access-Control-Allow-Origin', '*');

        return new Response(r2Object.body, { headers: downloadHeaders });
      }
    }

    // ========================================== 
    // 🎴 模块 4：记事条画布模块
    // ========================================== 
    if (path.startsWith('/api/code-grid')) {
      if (method === 'GET') {
        const rows = await env.DB.prepare('SELECT id, user_id, row_data, sort_order FROM Web_code_rows WHERE user_id = ? ORDER BY sort_order ASC, id DESC').bind(userId).all();
        const parsedRows = rows.results.map(r => ({ id: r.id, data: JSON.parse(r.row_data), sort_order: r.sort_order }));
        return new Response(JSON.stringify({ rows: parsedRows }), { headers });
      }

      const body = await request.json();

      if (method === 'POST') {
        if (body.items && Array.isArray(body.items)) {
          const stmts = body.items.map(item => {
            const rowDataStr = JSON.stringify(item.data);
            if (item.id) {
              return env.DB.prepare('UPDATE Web_code_rows SET row_data = ?, sort_order = ? WHERE id = ? AND user_id = ?').bind(rowDataStr, item.sort_order || 0, item.id, userId);
            } else {
              return env.DB.prepare('INSERT INTO Web_code_rows (user_id, row_data, sort_order) VALUES (?, ?, ?)').bind(userId, rowDataStr, item.sort_order || 0);
            }
          });
          await env.DB.batch(stmts);
          return new Response(JSON.stringify({ success: true }), { headers });
        }
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
    // 📸 模块 5：用户直传图标安全校验
    // ==========================================
    if (path === '/api/user/upload-icon' && method === 'POST') {
      const originalName = url.searchParams.get("name") || "icon.png";
      const extension = originalName.split('.').pop().toLowerCase();
      const imageBlob = await request.arrayBuffer();
      if (!imageBlob || imageBlob.byteLength === 0) return new Response(JSON.stringify({ success: false, error: "上传文件不可为空" }), { status: 400, headers });
      if (imageBlob.byteLength > 2 * 1024 * 1024) return new Response(JSON.stringify({ success: false, error: "体积不可超过2MB" }), { status: 400, headers });

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
    // 🔐 模块 6：用户管理中心
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
        if (user.password !== hashedInput && user.password !== password) {
            return new Response(JSON.stringify({ success: false, error: '账号或密码错误' }), { status: 401, headers });
        }
        if (user.password === password) {
            await env.DB.prepare('UPDATE Web_online_users_00 SET password = ? WHERE id = ?').bind(hashedInput, user.id).run();
        }

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
    // 🗂️ 模块 7：书签与配置模块
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
        if (Array.isArray(body)) {
          const stmts = body.map(item => 
            env.DB.prepare('UPDATE Web_online_info_01 SET sort_order=? WHERE id=? AND user_id=?')
              .bind(item.sort_order, item.id, userId)
          );
          await env.DB.batch(stmts); 
          return new Response(JSON.stringify({ success: true, message: "排序更新成功" }), { headers });
        } 
        else {
          await env.DB.prepare('UPDATE Web_online_info_01 SET type=?, url=?, icon=?, comment=?, note=?, sort_order=? WHERE id=? AND user_id=?')
            .bind(body.type, body.url, body.icon, body.comment, body.note, body.sort_order, body.id, userId).run();
          return new Response(JSON.stringify({ success: true }), { headers });
        }
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
