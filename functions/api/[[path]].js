// ====================================================================
// 统一路由中心：D1 关系型数据库 (用户/网址/数据) + Workers KV (免绑卡大文件/图片存储)
// ====================================================================

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // 跨域 CORS 基础配置
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS, PUT, DELETE",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };

  if (method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // 统一鉴权控制线（隔离不同用户的专属网址导航链接及配置）
  let userId = null;
  const isProtected = path.startsWith('/api/links') || path.startsWith('/api/user');
  
  if (isProtected) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: '安全机制：检测到未登录状态' }), { status: 401, headers: corsHeaders });
    try {
      const token = authHeader.split(' ')[1];
      userId = atob(token).split(':')[0]; // 解析出 D1 用户表内的专属自增 id
      if (!userId) throw new Error();
    } catch (e) {
      return new Response(JSON.stringify({ error: '身份验证已失效，请重新连接' }), { status: 403, headers: corsHeaders });
    }
  }

  try {
    // ==========================================
    // 📸 路由分支：动态读取 KV 中的自定义图标
    // ==========================================
    if (path.startsWith('/api/icon/') && method === 'GET') {
      const kvKey = path.split('/').pop();
      if (!kvKey) return new Response("缺少图片Key", { status: 400, headers: corsHeaders });

      // 从绑定的 IMAGE_KV (Web_online_Icon) 空间抓取大文件二进制流
      const imageBuffer = await env.IMAGE_KV.get(kvKey, { type: "arrayBuffer" });
      if (!imageBuffer) return new Response("图片不存在", { status: 404, headers: corsHeaders });

      // 动态识别常见图片后缀
      let contentType = "image/png";
      if (kvKey.endsWith(".jpg") || kvKey.endsWith(".jpeg")) contentType = "image/jpeg";
      if (kvKey.endsWith(".gif")) contentType = "image/gif";
      if (kvKey.endsWith(".webp")) contentType = "image/webp";

      return new Response(imageBuffer, {
        headers: {
          ...corsHeaders,
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=31536000" // 浏览器强缓存一年，省流量提速
        }
      });
    }

    // ==========================================
    // 📸 路由分支：用户异步上传专属图片图标 (需要登录)
    // ==========================================
    if (path === '/api/user/upload-icon' && method === 'POST') {
      const originalName = url.searchParams.get("name") || "icon.png";
      const extension = originalName.split('.').pop().toLowerCase();

      // 组装带有用户标识的唯一 KV 键名
      const kvKey = `user_${userId}_${Date.now()}.${extension}`;

      // 读取上传的图片二进制流
      const imageBlob = await request.arrayBuffer();
      if (!imageBlob || imageBlob.byteLength === 0) {
        return new Response(JSON.stringify({ success: false, error: "上传文件为空" }), { status: 400, headers: corsHeaders });
      }

      // 写入 Workers KV
      await env.IMAGE_KV.put(kvKey, imageBlob);

      return new Response(JSON.stringify({ success: true, kvKey: kvKey, url: `/api/icon/${kvKey}` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
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
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (action === 'login') {
        const user = await env.DB.prepare('SELECT id, username, settings FROM Web_online_users_00 WHERE username = ? AND password = ?').bind(username, password).first();
        if (!user) return new Response(JSON.stringify({ success: false, error: '安全访问控制拒绝：账号或密码错误' }), { status: 401, headers: corsHeaders });
        const token = btoa(`${user.id}:${user.username}`);
        return new Response(JSON.stringify({ success: true, token, username: user.username, settings: user.settings || '{"sensitivity": 50}' }), { headers: corsHeaders });
      }

      if (action === 'reset') {
        const user = await env.DB.prepare('SELECT id FROM Web_online_users_00 WHERE username = ? AND reset_code = ?').bind(username, reset_code).first();
        if (!user) return new Response(JSON.stringify({ success: false, error: '安全编码重置验证未通过' }), { status: 403, headers: corsHeaders });
        await env.DB.prepare('UPDATE Web_online_users_00 SET password = ? WHERE id = ?').bind(new_password, user.id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
    }

    // ==========================================
    // 🗂️ 路由分支二: 核心网址卡片库控制模块 (/api/links)
    // ==========================================
    if (path === '/api/links') {
      if (method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM Web_online_info_01 WHERE user_id = ? ORDER BY sort_order ASC, created_at DESC').bind(userId).all();
        return new Response(JSON.stringify(results), { headers: corsHeaders });
      }

      const body = await request.json();
      if (method === 'POST') {
        await env.DB.prepare('INSERT INTO Web_online_info_01 (user_id, type, url, icon, comment, note, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(userId, body.type, body.url, body.icon, body.comment, body.note, body.sort_order || 0).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (method === 'PUT') {
        // 如果卡片在更新时改为了其他图标，此处可以考虑清理旧的 KV 数据（可选）
        await env.DB.prepare('UPDATE Web_online_info_01 SET type=?, url=?, icon=?, comment=?, note=?, sort_order=? WHERE id=? AND user_id=?')
          .bind(body.type, body.url, body.icon, body.comment, body.note, body.sort_order, body.id, userId).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (method === 'DELETE') {
        // 联动删除：在从 D1 移除卡片记录前，顺便把与之绑定的 KV 图片物理删除，避免成为僵尸空间
        const currentLink = await env.DB.prepare('SELECT icon FROM Web_online_info_01 WHERE id = ? AND user_id = ?').bind(body.id, userId).first();
        if (currentLink && currentLink.icon && currentLink.icon.startsWith('user_')) {
          await env.IMAGE_KV.delete(currentLink.icon);
        }
        await env.DB.prepare('DELETE FROM Web_online_info_01 WHERE id = ? AND user_id = ?').bind(body.id, userId).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
    }

    // ==========================================
    // ⚙️ 路由分支三: 全局偏好属性修改模块 (/api/user)
    // ==========================================
    if (path === '/api/user' && method === 'PUT') {
      const { settings } = await request.json();
      await env.DB.prepare('UPDATE Web_online_users_00 SET settings = ? WHERE id = ?').bind(JSON.stringify(settings), userId).run();
      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    // ========================================== 
    // 📝 路由分支四: 滑动控制台开发备忘模块 (/api/notes)
    // ========================================== 
    if (path === '/api/notes') {
      if (method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM notes ORDER BY is_pinned DESC, created_at DESC').all();
        return new Response(JSON.stringify(results), { headers: corsHeaders });
      }

      const body = await request.json();
      if (method === 'POST') {
        await env.DB.prepare('INSERT INTO notes (content, is_pinned) VALUES (?, ?)').bind(body.content.trim(), body.is_pinned ? 1 : 0).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (method === 'PUT') {
        await env.DB.prepare('UPDATE notes SET content = ?, is_pinned = ? WHERE id = ?').bind(body.content.trim(), body.is_pinned ? 1 : 0, body.id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (method === 'DELETE') {
        if (body.password !== '273573221') return new Response(JSON.stringify({ success: false, error: '管理密钥验证未通过' }), { status: 403, headers: corsHeaders });
        await env.DB.prepare('DELETE FROM notes WHERE id = ?').bind(body.id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
    }

    return new Response(JSON.stringify({ error: 'BAD_GATEWAY: 未知请求路径' }), { status: 405, headers: corsHeaders });

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: corsHeaders });
  }
}
