/**
 * functions/api/auth.js
 * 处理用户注册、登录、重置密码
 */
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // 允许跨域 (CORS)
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers });
  }

  try {
    const body = await request.json();
    const { action } = body; // action: 'register', 'login', 'reset'

    // 1. 注册 (Register)
    if (action === 'register') {
      const { username, password, reset_code } = body;
      
      if (!username || !password || !reset_code) {
        throw new Error('用户名、密码和重置码均不能为空');
      }

      // 检查用户名是否已存在
      const existing = await env.DB.prepare('SELECT id FROM Web_online_users_00 WHERE username = ?').bind(username).first();
      if (existing) {
        throw new Error('用户名已存在');
      }

      // 简单存储 (实际生产建议加盐Hash，这里演示用明文/简单处理)
      await env.DB.prepare(
        'INSERT INTO Web_online_users_00 (username, password, reset_code) VALUES (?, ?, ?)'
      ).bind(username, password, reset_code).run();

      return new Response(JSON.stringify({ success: true, message: '注册成功' }), { headers });
    }

    // 2. 登录 (Login)
    if (action === 'login') {
      const { username, password } = body;
      
      const user = await env.DB.prepare(
        'SELECT id, username FROM Web_online_users_00 WHERE username = ? AND password = ?'
      ).bind(username, password).first();

      if (!user) {
        return new Response(JSON.stringify({ success: false, error: '用户名或密码错误' }), { status: 401, headers });
      }

      // 返回简单的 Token (这里用 base64(user_id:username) 模拟 Token，生产环境建议用 JWT)
      const token = btoa(`${user.id}:${user.username}`);
      return new Response(JSON.stringify({ success: true, token, username: user.username }), { headers });
    }

    // 3. 重置密码 (Reset Password)
    if (action === 'reset') {
      const { username, reset_code, new_password } = body;

      const user = await env.DB.prepare(
        'SELECT id FROM Web_online_users_00 WHERE username = ? AND reset_code = ?'
      ).bind(username, reset_code).first();

      if (!user) {
        return new Response(JSON.stringify({ success: false, error: '重置码错误或用户不存在' }), { status: 403, headers });
      }

      await env.DB.prepare(
        'UPDATE Web_online_users_00 SET password = ? WHERE id = ?'
      ).bind(new_password, user.id).run();

      return new Response(JSON.stringify({ success: true, message: '密码重置成功' }), { headers });
    }

    return new Response(JSON.stringify({ error: '未知操作' }), { status: 400, headers });

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers });
  }
}
