/**
 * functions/api/auth.js
 * 处理用户注册、登录、重置密码 (已升级：登录时返回用户设置)
 */
export async function onRequest(context) {
  const { request, env } = context;
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers });

  try {
    const body = await request.json();
    const { action } = body;

    // 1. 注册
    if (action === 'register') {
      const { username, password, reset_code } = body;
      if (!username || !password || !reset_code) throw new Error('信息不完整');

      const existing = await env.DB.prepare('SELECT id FROM Web_online_users_00 WHERE username = ?').bind(username).first();
      if (existing) throw new Error('用户名已存在');

      // 注册时写入默认设置
      const defaultSettings = JSON.stringify({ sensitivity: 50 });
      await env.DB.prepare(
        'INSERT INTO Web_online_users_00 (username, password, reset_code, settings) VALUES (?, ?, ?, ?)'
      ).bind(username, password, reset_code, defaultSettings).run();

      return new Response(JSON.stringify({ success: true }), { headers });
    }

    // 2. 登录 (升级点：返回 settings)
    if (action === 'login') {
      const { username, password } = body;
      
      // 多查询一个 settings 字段
      const user = await env.DB.prepare(
        'SELECT id, username, settings FROM Web_online_users_00 WHERE username = ? AND password = ?'
      ).bind(username, password).first();

      if (!user) return new Response(JSON.stringify({ success: false, error: '账号或密码错误' }), { status: 401, headers });

      const token = btoa(`${user.id}:${user.username}`);
      
      // 如果数据库里 settings 是空的，给个默认值
      const settings = user.settings || '{"sensitivity": 50}';

      return new Response(JSON.stringify({ 
        success: true, 
        token, 
        username: user.username,
        settings: settings // 将配置返回给前端
      }), { headers });
    }

    // 3. 重置密码
    if (action === 'reset') {
      const { username, reset_code, new_password } = body;
      const user = await env.DB.prepare('SELECT id FROM Web_online_users_00 WHERE username = ? AND reset_code = ?').bind(username, reset_code).first();
      if (!user) return new Response(JSON.stringify({ success: false, error: '验证失败' }), { status: 403, headers });

      await env.DB.prepare('UPDATE Web_online_users_00 SET password = ? WHERE id = ?').bind(new_password, user.id).run();
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    return new Response(JSON.stringify({ error: '未知操作' }), { status: 400, headers });

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers });
  }
}
