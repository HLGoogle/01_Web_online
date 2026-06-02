/**
 * functions/api/[[path]].js
 * 后端精简版控制台路由中心 - 1个文件处理所有 D1 数据库路由和鉴权
 */
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // 1. 统一跨域阻断与资源头响应配置
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  if (method === 'OPTIONS') return new Response(null, { headers });

  // 2. 统一鉴权逻辑 (隔离不同用户的专属网址导航链接及配置)
  let userId = null;
  const isProtected = path.startsWith('/api/links') || path.startsWith('/api/user');
  
  if (isProtected) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers });
    try {
      const token = authHeader.split(' ')[1];
      userId = atob(token).split(':')[0]; // 解密解析出 D1 用户表内的专属自增 id
      if (!userId) throw new Error();
    } catch (e) {
      return new Response(JSON.stringify({ error: '身份验证已失效，请重新连接' }), { status: 403, headers });
    }
  }

  // 3. 动态条件分发控制链
  try {
    // ==========================================
    // 路由分支一: 用户管理与重置校验模块 (/api/auth)
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
        if (!user) return new Response(JSON.stringify({ success: false, error: '安全访问控制拒绝：账号或密码错误' }), { status: 401, headers });
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
    // 路由分支二: 核心网址卡片库控制模块 (/api/links)
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
        await env.DB.prepare('DELETE FROM Web_online_info_01 WHERE id = ? AND user_id = ?').bind(body.id, userId).run();
        return new Response(JSON.stringify({ success: true }), { headers });
      }
    }

    // ==========================================
    // 路由分支三: 全局偏好属性修改模块 (/api/user)
    // ==========================================
    if (path === '/api/user' && method === 'PUT') {
      const { settings } = await request.json();
      await env.DB.prepare('UPDATE Web_online_users_00 SET settings = ? WHERE id = ?').bind(JSON.stringify(settings), userId).run();
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    // ========================================== 
    // 路由分支四: 滑动控制台开发备忘  模块 (/api/notes)
    // ========================================== 
    if (path === '/api/notes') {
      if (method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM notes ORDER BY is_pinned DESC, created_at DESC').all();
        return new Response(JSON.stringify(results), { headers });
      }

      const body = await request.json();
      if (method === 'POST') {
        await env.DB.prepare('INSERT INTO notes (content, is_pinned) VALUES (?, ?)').bind(body.content.trim(), body.is_pinned ? 1 : 0).run();
        return new Response(JSON.stringify({ success: true }), { headers });
      }
      if (method === 'PUT') {
        await env.DB.prepare('UPDATE notes SET content = ?, is_pinned = ? WHERE id = ?').bind(body.content.trim(), body.is_pinned ? 1 : 0, body.id).run();
        return new Response(JSON.stringify({ success: true }), { headers });
      }
      if (method === 'DELETE') {
        if (body.password !== '273573221') return new Response(JSON.stringify({ success: false, error: '安全屏障：拒绝指令执行，管理密钥未通过' }), { status: 403, headers });
        await env.DB.prepare('DELETE FROM notes WHERE id = ?').bind(body.id).run();
        return new Response(JSON.stringify({ success: true }), { headers });
      }
    }

    return new Response(JSON.stringify({ error: 'BAD_GATEWAY: Method Not Allowed or Path Invalid' }), { status: 405, headers });

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers });
  }
}
