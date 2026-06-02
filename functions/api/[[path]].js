/**
 * functions/api/[[path]].js
 * 终极健壮版路由中心 - 整合多维动态代码画布接口
 */
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
  // 📸 路由分支：读取 KV 中的自定义图片图标
  // ==========================================
  if (path.startsWith('/api/icon/') && method === 'GET') {
    const kvKey = path.split('/').pop();
    const placeholderPng = new Uint8Array([
      137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,11,73,68,65,84,120,156,99,96,0,1,0,0,5,0,1,13,10,45,180,0,0,0,0,73,69,78,68,174,66,96,130
    ]);
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

  // 统一鉴权逻辑
  let userId = null;
  const isProtected = path.startsWith('/api/links') || path.startsWith('/api/user') || path.startsWith('/api/code-grid');
  
  if (isProtected) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers });
    try {
      const token = authHeader.split(' ')[1];
      userId = atob(token).split(':')[0];
      if (!userId) throw new Error();
    } catch (e) {
      return new Response(JSON.stringify({ error: '身份验证已失效，请重新连接' }), { status: 403, headers });
    }
  }

  try {
    // ========================================== 
    // 🎴 核心新路由：多维动态代码画布模块 (/api/code-grid)
    // ========================================== 
    if (path.startsWith('/api/code-grid')) {
      // 1. 获取配置列维度及行代码数据 (GET)
      if (method === 'GET') {
        const columns = await env.DB.prepare('SELECT * FROM Web_code_columns WHERE user_id = ? ORDER BY sort_order ASC').bind(userId).all();
        const rows = await env.DB.prepare('SELECT * FROM Web_code_rows WHERE user_id = ? ORDER BY sort_order ASC, id DESC').bind(userId).all();
        
        const parsedRows = rows.results.map(r => ({
          id: r.id,
          data: JSON.parse(r.row_data),
          sort_order: r.sort_order
        }));
        return new Response(JSON.stringify({ columns: columns.results, rows: parsedRows }), { headers });
      }

      const body = await request.json();

      // 2. 保存或更新单行代码块 (POST)
      if (method === 'POST') {
        const rowDataStr = JSON.stringify(body.data);
        if (body.id) {
          await env.DB.prepare('UPDATE Web_code_rows SET row_data = ?, sort_order = ? WHERE id = ? AND user_id = ?')
            .bind(rowDataStr, body.sort_order || 0, body.id, userId).run();
        } else {
          await env.DB.prepare('INSERT INTO Web_code_rows (user_id, row_data, sort_order) VALUES (?, ?, ?)')
            .bind(userId, rowDataStr, body.sort_order || 0).run();
        }
        return new Response(JSON.stringify({ success: true }), { headers });
      }

      // 3. 动态新建一个列配置维度 (PUT)
      if (method === 'PUT' && path === '/api/code-grid/column') {
        const colKey = `col_${Date.now()}`;
        await env.DB.prepare('INSERT INTO Web_code_columns (user_id, col_key, col_name, sort_order) VALUES (?, ?, ?, ?)')
          .bind(userId, colKey, body.col_name, body.sort_order || 0).run();
        return new Response(JSON.stringify({ success: true, colKey }), { headers });
      }

      // 4. 物理擦除代码行记录 (DELETE)
      if (method === 'DELETE') {
        await env.DB.prepare('DELETE FROM Web_code_rows WHERE id = ? AND user_id = ?').bind(body.id, userId).run();
        return new Response(JSON.stringify({ success: true }), { headers });
      }
    }

    // ==========================================
    // 📸 路由分支：用户直传图标
    // ==========================================
    if (path === '/api/user/upload-icon' && method === 'POST') {
      const originalName = url.searchParams.get("name") || "icon.png";
      const extension = originalName.split('.').pop().toLowerCase();
      const kvKey = `user_${userId}_${Date.now()}.${extension}`;
      const imageBlob = await request.arrayBuffer();
      if (!imageBlob || imageBlob.byteLength === 0) return new Response(JSON.stringify({ success: false, error: "上传文件不可为空" }), { status: 400, headers });
      if (imageBlob.byteLength > 2 * 1024 * 1024) return new Response(JSON.stringify({ success: false, error: "图标体积不可超过 2MB" }), { status: 400, headers });
      await env.IMAGE_KV.put(kvKey, imageBlob);
      return new Response(JSON.stringify({ success: true, kvKey, url: `/api/icon/${kvKey}` }), { headers: { ...headers, "Content-Type": "application/json" } });
    }

    // ==========================================
    // 🔐 路由分支一: 用户管理与重置校验模块 (/api/auth)
    // ==========================================
    if (path === '/api/auth' && method === 'POST') {
      const body = await request.json();
      const { action, username, password, reset_code, new_password } = body;
      if (action === 'register') {
        const existing = await env.DB.prepare('SELECT id FROM Web_online_users_00 WHERE username = ?').bind(username).first();
        if (existing) throw new Error('该用户名在数据库中已存在');
        await env.DB.prepare('INSERT INTO Web_online_users_00 (username, password, reset_code, settings) VALUES (?, ?, ?, ?)')
          .bind(username, password, reset_code, '{"sensitivity": 50}').run();
        return new Response(JSON.stringify({ success: true }), { headers });
      }
      if (action === 'login') {
        const user = await env.DB.prepare('SELECT id, username, settings FROM Web_online_users_00 WHERE username = ? AND password = ?').bind(username, password).first();
        if (!user) return new Response(JSON.stringify({ success: false, error: '账号或密码错误' }), { status: 401, headers });
        const token = btoa(`${user.id}:${user.username}`);
        return new Response(JSON.stringify({ success: true, token, username: user.username, settings: user.settings || '{"sensitivity": 50}' }), { headers });
      }
      if (action === 'reset') {
        const user = await env.DB.prepare('SELECT id FROM Web_online_users_00 WHERE username = ? AND reset_code = ?').bind(username, reset_code).first();
        if (!user) return new Response(JSON.stringify({ success: false, error: '安全编码重置验证未通过' }), { status: 403, headers });
        await env.DB.prepare('UPDATE Web_online_users_00 SET password = ? WHERE id = ?').bind(new_password, user.id).run();
        return new Response(JSON.stringify({ success: true }), { headers });
      }
    }

    // ==========================================
    // 🗂️ 路由分支二: 核心网址卡片库控制模块 (/api/links)
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
        if (currentLink && currentLink.icon && currentLink.icon.startsWith('user_')) {
          await env.IMAGE_KV.delete(currentLink.icon);
        }
        await env.DB.prepare('DELETE FROM Web_online_info_01 WHERE id = ? AND user_id = ?').bind(body.id, userId).run();
        return new Response(JSON.stringify({ success: true }), { headers });
      }
    }

    // ==========================================
    // ⚙️ 路由分支三: 全局偏好属性修改模块 (/api/user)
    // ==========================================
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
