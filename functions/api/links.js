/**
 * functions/api/links.js
 * 处理导航数据的增删改查 (需要登录)
 */
export async function onRequest(context) {
  const { request, env } = context;
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers });
  }

  // --- 简单的鉴权中间件 ---
  // 从请求头 Authorization: Bearer <token> 中获取 Token
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers });
  }
  
  let userId = null;
  try {
    // 解码 Token (对应 auth.js 里的 btoa 逻辑)
    const token = authHeader.split(' ')[1];
    const decoded = atob(token); // 格式 "id:username"
    userId = decoded.split(':')[0];
    
    if (!userId) throw new Error('无效Token');
  } catch (e) {
    return new Response(JSON.stringify({ error: '无效的身份验证' }), { status: 403, headers });
  }
  // -----------------------

  try {
    // 1. 获取所有链接 (GET)
    if (request.method === 'GET') {
      const links = await env.DB.prepare(
        'SELECT * FROM Web_online_info_01 WHERE user_id = ? ORDER BY sort_order ASC, created_at DESC'
      ).bind(userId).all();
      
      return new Response(JSON.stringify(links.results), { headers });
    }

    const body = await request.json();

    // 2. 新增链接 (POST)
    if (request.method === 'POST') {
      const { type, url, icon, comment, note, sort_order } = body;
      
      await env.DB.prepare(
        `INSERT INTO Web_online_info_01 (user_id, type, url, icon, comment, note, sort_order) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(userId, type, url, icon, comment, note, sort_order || 0).run();

      return new Response(JSON.stringify({ success: true }), { headers });
    }

    // 3. 修改链接 (PUT)
    if (request.method === 'PUT') {
      const { id, type, url, icon, comment, note, sort_order } = body;
      
      const result = await env.DB.prepare(
        `UPDATE Web_online_info_01 
         SET type=?, url=?, icon=?, comment=?, note=?, sort_order=? 
         WHERE id=? AND user_id=?`
      ).bind(type, url, icon, comment, note, sort_order, id, userId).run();

      if (result.meta.changes === 0) {
        throw new Error('修改失败：无权操作或记录不存在');
      }

      return new Response(JSON.stringify({ success: true }), { headers });
    }

    // 4. 删除链接 (DELETE)
    if (request.method === 'DELETE') {
      const { id } = body;
      
      const result = await env.DB.prepare(
        'DELETE FROM Web_online_info_01 WHERE id = ? AND user_id = ?'
      ).bind(id, userId).run();

      if (result.meta.changes === 0) {
        throw new Error('删除失败：无权操作或记录不存在');
      }

      return new Response(JSON.stringify({ success: true }), { headers });
    }

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers });
  }
  
  return new Response('Method Not Allowed', { status: 405 });
}
