/**
 * functions/api/[[path]].js
 * 企业级全能终极版 - 集成直链图床、同名覆盖、文件夹层级、自定义短链别名
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
  // 🌐 公共直链/图床模块 (支持 ID 或自定义别名，无须鉴权)
  // ==========================================
  if (path.startsWith('/api/f') && method === 'GET') {
    try {
      const slug = path.split('/').pop(); // 获取 /api/f/ 之后的路径
      const idParam = url.searchParams.get("id");
      
      let fileInfo;
      // 1. 如果路径有别名 (例如 /api/f/my-file)
      if (slug !== 'f' && slug !== '') { 
        fileInfo = await env.DB.prepare('SELECT file_name, file_type, r2_key FROM cloud_files WHERE alias = ?').bind(slug).first();
      } 
      // 2. 如果走传统的 ID 路线 (例如 /api/f?id=14)
      else if (idParam) { 
        fileInfo = await env.DB.prepare('SELECT file_name, file_type, r2_key FROM cloud_files WHERE id = ?').bind(Number(idParam)).first();
      }
      
      if (!fileInfo) return new Response("文件不存在或别名未配置", { status: 404, headers });

      const r2Object = await env.MY_BUCKET.get(fileInfo.r2_key);
      if (!r2Object) return new Response("存储桶文件丢失", { status: 404, headers });

      const downloadHeaders = new Headers();
      r2Object.writeHttpMetadata(downloadHeaders);
      downloadHeaders.set("etag", r2Object.httpEtag);
      
      // 图床智能判定：图片/音视频直接在网页内联显示，其他文件强制下载
      const type = fileInfo.file_type || '';
      if (type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/')) {
        downloadHeaders.set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(fileInfo.file_name)}`);
      } else {
        downloadHeaders.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileInfo.file_name)}`);
      }
      downloadHeaders.set('Access-Control-Allow-Origin', '*');

      return new Response(r2Object.body, { headers: downloadHeaders });
    } catch(e) {
      return new Response("服务器内部错误", { status: 500, headers });
    }
  }

  // ==========================================
  // 📸 读取 KV 自定义图片
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
  // 🛡️ 安全网关认证 (管理后台需要登录)
  // ==========================================
  let userId = null;
  const isProtected = path.includes('api/links') || path.includes('api/user') || path.includes('api/code-grid') || path.includes('cloud');
  
  if (isProtected) {
    let authHeader = request.headers.get('Authorization');
    if (!authHeader && url.searchParams.get('auth')) authHeader = `Bearer ${url.searchParams.get('auth')}`;

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
    // ☁️ 🚀 云盘核心模块
    // ========================================== 
    if (path.includes('cloud')) {
      
      const strUserId = String(userId);
      const intUserId = Number(userId) || 0;

      // 1. 获取列表
      if (path.includes('list') && method === 'GET') {
        const folderId = Number(url.searchParams.get("folder_id")) || 0;
        const { results: folders } = await env.DB.prepare('SELECT * FROM cloud_folders WHERE (user_id = ? OR user_id = ?) AND parent_id = ? ORDER BY created_at DESC').bind(strUserId, intUserId, folderId).all();
        // 自动拉取文件列表（包含了刚建立的 alias 字段）
        const { results: files } = await env.DB.prepare('SELECT * FROM cloud_files WHERE (user_id = ? OR user_id = ?) AND (folder_id = ? OR (? = 0 AND folder_id IS NULL)) ORDER BY created_at DESC').bind(strUserId, intUserId, folderId, folderId).all();
        const sizeRes = await env.DB.prepare('SELECT SUM(file_size) as total FROM cloud_files WHERE user_id = ? OR user_id = ?').bind(strUserId, intUserId).first();
        const totalSize = sizeRes ? (sizeRes.total || 0) : 0;
        return new Response(JSON.stringify({ success: true, data: { folders, files, totalSize } }), { headers });
      }

      // 2. 新建文件夹
      if (path.includes('create-folder') && method === 'POST') {
        const { name, parent_id } = await request.json();
        await env.DB.prepare('INSERT INTO cloud_folders (user_id, name, parent_id) VALUES (?, ?, ?)').bind(strUserId, name, parent_id || 0).run();
        return new Response(JSON.stringify({ success: true }), { headers });
      }

      // 3. 移动文件
      if (path.includes('move-file') && method === 'PUT') {
        const { file_id, target_folder_id } = await request.json();
        await env.DB.prepare('UPDATE cloud_files SET folder_id = ? WHERE id = ? AND (user_id = ? OR user_id = ?)').bind(target_folder_id, file_id, strUserId, intUserId).run();
        return new Response(JSON.stringify({ success: true }), { headers });
      }

      // 4. 上传文件 (同名自动覆盖机制)
      if (path.includes('upload') && method === 'POST') {
        try {
          if (!env.MY_BUCKET) throw new Error("未绑定 R2 存储桶");
          if (!env.DB) throw new Error("未绑定 D1 数据库");

          let fileBuffer, fileName, fileSize, fileType, folderId;
          const contentType = request.headers.get("content-type") || "";

          if (contentType.includes("multipart/form-data")) {
            const formData = await request.formData();
            const file = formData.get("file");
            if (!file) throw new Error("未检测到文件实体");
            fileName = file.name;
            fileSize = file.size;
            fileType = file.type || 'application/octet-stream';
            folderId = Number(formData.get("folder_id")) || 0;
            fileBuffer = await file.arrayBuffer();
          } else {
            fileName = decodeURIComponent(url.searchParams.get("name") || "unknown.bin");
            fileSize = Number(url.searchParams.get("size")) || 0;
            fileType = decodeURIComponent(url.searchParams.get("type") || 'application/octet-stream');
            folderId = Number(url.searchParams.get("folder_id")) || 0;
            fileBuffer = await request.arrayBuffer();
          }

          if (!fileBuffer || fileBuffer.byteLength === 0) throw new Error("拦截：空文件");
          const r2Key = `${userId}/${Date.now()}_${fileName}`;

          try { await env.MY_BUCKET.put(r2Key, fileBuffer, { httpMetadata: { contentType: fileType } }); } 
          catch(e) { throw new Error(`R2 写入被拒: ${e.message}`); }

          try {
            const existingFile = await env.DB.prepare('SELECT id, r2_key FROM cloud_files WHERE file_name = ? AND folder_id = ? AND (user_id = ? OR user_id = ?)')
              .bind(fileName, Number(folderId), strUserId, intUserId).first();

            if (existingFile) {
              await env.DB.prepare('UPDATE cloud_files SET r2_key = ?, file_size = ?, file_type = ? WHERE id = ?')
                .bind(r2Key, Number(fileSize), fileType, existingFile.id).run();
              await env.MY_BUCKET.delete(existingFile.r2_key).catch(() => console.log('旧文件清理跳过'));
            } else {
              await env.DB.prepare('INSERT INTO cloud_files (user_id, file_name, r2_key, file_size, file_type, folder_id) VALUES (?, ?, ?, ?, ?, ?)')
                .bind(strUserId, fileName, r2Key, Number(fileSize), fileType, Number(folderId)).run();
            }
          } catch(e) { throw new Error(`数据库写入失败: ${e.message}`); }

          return new Response(JSON.stringify({ success: true, message: "上传(覆盖)成功" }), { headers });
        } catch (innerError) {
          return new Response(JSON.stringify({ success: false, error: innerError.message }), { status: 200, headers });
        }
      }

      // 5. 删除文件/文件夹
      if (path.includes('delete') && method === 'DELETE') {
        try {
          const id = Number(url.searchParams.get("id")); 
          const type = url.searchParams.get("type");

          if (type === 'folder') {
            await env.DB.prepare('DELETE FROM cloud_folders WHERE id = ? AND (user_id = ? OR user_id = ?)').bind(id, strUserId, intUserId).run();
          } else {
            const fileInfo = await env.DB.prepare('SELECT r2_key FROM cloud_files WHERE id = ? AND (user_id = ? OR user_id = ?)').bind(id, strUserId, intUserId).first();
            if (!fileInfo) throw new Error("文件不存在或无权操作");
            await env.MY_BUCKET.delete(fileInfo.r2_key);
            await env.DB.prepare('DELETE FROM cloud_files WHERE id = ?').bind(id).run();
          }
          return new Response(JSON.stringify({ success: true, message: "删除成功" }), { headers });
        } catch (e) {
          return new Response(JSON.stringify({ success: false, error: e.message }), { status: 200, headers });
        }
      }

      // 6. 🚀 设置自定义短链别名
      if (path.includes('set-alias') && method === 'PUT') {
        const { id, alias } = await request.json();
        try {
          // 如果传入空字符串，则设置为 null
          const finalAlias = alias && alias.trim() !== '' ? alias.trim() : null;
          await env.DB.prepare('UPDATE cloud_files SET alias = ? WHERE id = ? AND (user_id = ? OR user_id = ?)')
            .bind(finalAlias, Number(id), strUserId, intUserId).run();
          return new Response(JSON.stringify({ success: true, message: "设置成功" }), { headers });
        } catch (e) {
          return new Response(JSON.stringify({ success: false, error: "别名可能已被占用，请换一个" }), { status: 200, headers });
        }
      }

      // 7. 重命名
      if (path.includes('rename') && method === 'PUT') {
        try {
          const { id, type, new_name } = await request.json();
          if (!new_name || new_name.trim() === '') throw new Error("名称不能为空");

          if (type === 'folder') {
            await env.DB.prepare('UPDATE cloud_folders SET name = ? WHERE id = ? AND (user_id = ? OR user_id = ?)')
              .bind(new_name.trim(), Number(id), strUserId, intUserId).run();
          } else {
            await env.DB.prepare('UPDATE cloud_files SET file_name = ? WHERE id = ? AND (user_id = ? OR user_id = ?)')
              .bind(new_name.trim(), Number(id), strUserId, intUserId).run();
          }
          return new Response(JSON.stringify({ success: true, message: "重命名成功" }), { headers });
        } catch (e) {
          return new Response(JSON.stringify({ success: false, error: e.message }), { status: 200, headers });
        }
      }
    }

    // ========================================== 
    // 🎴 记事条模块
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
            if (item.id) return env.DB.prepare('UPDATE Web_code_rows SET row_data = ?, sort_order = ? WHERE id = ? AND user_id = ?').bind(rowDataStr, item.sort_order || 0, item.id, userId);
            else return env.DB.prepare('INSERT INTO Web_code_rows (user_id, row_data, sort_order) VALUES (?, ?, ?)').bind(userId, rowDataStr, item.sort_order || 0);
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

    if (path === '/api/user/upload-icon' && method === 'POST') {
      const originalName = url.searchParams.get("name") || "icon.png";
      const extension = originalName.split('.').pop().toLowerCase();
      const imageBlob = await request.arrayBuffer();
      if (!imageBlob || imageBlob.byteLength === 0) return new Response(JSON.stringify({ success: false, error: "上传文件不可为空" }), { status: 400, headers });
      if (imageBlob.byteLength > 2 * 1024 * 1024) return new Response(JSON.stringify({ success: false, error: "体积不可超过2MB" }), { status: 400, headers });

      const arr = new Uint8Array(imageBlob).subarray(0, 4);
      const headerHex = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
      let validFile = false;
      if (headerHex.startsWith('89504E47')) validFile = true; 
      else if (headerHex.startsWith('FFD8FF')) validFile = true; 
      else if (headerHex.startsWith('47494638')) validFile = true; 
      else if (headerHex.startsWith('52494646')) validFile = true; 

      if (!validFile) return new Response(JSON.stringify({ success: false, error: "安全拦截：请上传真实的图片文件" }), { status: 400, headers });

      const kvKey = `user_${userId}_${Date.now()}.${extension}`;
      await env.IMAGE_KV.put(kvKey, imageBlob);
      return new Response(JSON.stringify({ success: true, kvKey, url: `/api/icon/${kvKey}` }), { headers: { ...headers, "Content-Type": "application/json" } });
    }

    if (path === '/api/auth' && method === 'POST') {
      const body = await request.json();
      const { action, username, password, reset_code, new_password } = body;
      
      if (action === 'register') {
        const existing = await env.DB.prepare('SELECT id FROM Web_online_users_00 WHERE username = ?').bind(username).first();
        if (existing) throw new Error('该用户名已存在');
        const hashedPassword = await sha256(password + PWD_SALT);
        await env.DB.prepare('INSERT INTO Web_online_users_00 (username, password, reset_code, settings) VALUES (?, ?, ?, ?)').bind(username, hashedPassword, reset_code, '{"sensitivity": 50}').run();
        return new Response(JSON.stringify({ success: true }), { headers });
      }

      if (action === 'login') {
        const user = await env.DB.prepare('SELECT id, username, settings, password FROM Web_online_users_00 WHERE username = ?').bind(username).first();
        if (!user) return new Response(JSON.stringify({ success: false, error: '账号或密码错误' }), { status: 401, headers });
        const hashedInput = await sha256(password + PWD_SALT);
        if (user.password !== hashedInput && user.password !== password) return new Response(JSON.stringify({ success: false, error: '账号或密码错误' }), { status: 401, headers });
        if (user.password === password) await env.DB.prepare('UPDATE Web_online_users_00 SET password = ? WHERE id = ?').bind(hashedInput, user.id).run();
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

    if (path === '/api/links') {
      if (method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM Web_online_info_01 WHERE user_id = ? ORDER BY sort_order ASC, created_at DESC').bind(userId).all();
        return new Response(JSON.stringify(results), { headers });
      }
      const body = await request.json();
      if (method === 'POST') {
        await env.DB.prepare('INSERT INTO Web_online_info_01 (user_id, type, url, icon, comment, note, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(userId, body.type, body.url, body.icon, body.comment, body.note, body.sort_order || 0).run();
        return new Response(JSON.stringify({ success: true }), { headers });
      }
      if (method === 'PUT') {
        if (Array.isArray(body)) {
          const stmts = body.map(item => env.DB.prepare('UPDATE Web_online_info_01 SET sort_order=? WHERE id=? AND user_id=?').bind(item.sort_order, item.id, userId));
          await env.DB.batch(stmts); 
          return new Response(JSON.stringify({ success: true, message: "排序更新成功" }), { headers });
        } else {
          await env.DB.prepare('UPDATE Web_online_info_01 SET type=?, url=?, icon=?, comment=?, note=?, sort_order=? WHERE id=? AND user_id=?').bind(body.type, body.url, body.icon, body.comment, body.note, body.sort_order, body.id, userId).run();
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

  } catch (globalError) {
    return new Response(JSON.stringify({ success: false, error: "网关底座异常: " + globalError.message }), { status: 200, headers });
  }
}
