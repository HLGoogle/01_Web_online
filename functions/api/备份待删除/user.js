/**
 * functions/api/user.js
 * 处理用户配置的保存 (需要登录)
 */
export async function onRequest(context) {
  const { request, env } = context;
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  if (request.method === 'OPTIONS') return new Response(null, { headers });

  // 鉴权逻辑
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers });
  
  let userId = null;
  try {
    const token = authHeader.split(' ')[1];
    userId = atob(token).split(':')[0];
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Token无效' }), { status: 403, headers });
  }

  // 保存设置逻辑
  if (request.method === 'PUT') {
    try {
      const { settings } = await request.json();
      
      // 将设置对象转为字符串存入数据库
      const settingsStr = JSON.stringify(settings);
      
      await env.DB.prepare(
        'UPDATE Web_online_users_00 SET settings = ? WHERE id = ?'
      ).bind(settingsStr, userId).run();

      return new Response(JSON.stringify({ success: true }), { headers });
    } catch (error) {
      return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers });
    }
  }

  return new Response('Method Not Allowed', { status: 405, headers });
}
