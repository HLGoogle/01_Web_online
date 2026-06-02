// ====================================================================
// 统一路由中心：D1 关系型数据库 (用户/网址/数据) + Workers KV (免绑卡大文件/图片存储)
// ====================================================================

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // 允许跨域请求 (CORS配置)
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS, PUT, DELETE",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, token",
    "Access-Control-Max-Age": "86400",
  };

  if (method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ==========================================
    // 📸 新增路由 1：读取 KV 中的专属图片图标
    // URL 格式例如：/api/icon/user_1001_1718293821.png
    // ==========================================
    if (path.startsWith('/api/icon/') && method === 'GET') {
      const kvKey = path.split('/').pop();
      if (!kvKey) return new Response("缺少图片Key", { status: 400, headers: corsHeaders });

      // 直接去绑定的 IMAGE_KV 空间抓取大文件二进制流
      const imageBuffer = await env.IMAGE_KV.get(kvKey, { type: "arrayBuffer" });
      if (!imageBuffer) {
        return new Response("图片不存在或已被删除", { status: 404, headers: corsHeaders });
      }

      // 动态识别常见图片后缀，防止浏览器变成下载文件
      let contentType = "image/png"; // 默认png
      if (kvKey.endsWith(".jpg") || kvKey.endsWith(".jpeg")) contentType = "image/jpeg";
      if (kvKey.endsWith(".gif")) contentType = "image/gif";
      if (kvKey.endsWith(".webp")) contentType = "image/webp";
      if (kvKey.endsWith(".svg")) contentType = "image/svg+xml";

      return new Response(imageBuffer, {
        headers: {
          ...corsHeaders,
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=31536000" // 强缓存一年，极速加载且省去重复读取KV的额度
        }
      });
    }

    // ==========================================
    // 📸 新增路由 2：用户上传专属图片图标 (需要鉴权)
    // 逻辑：塞进 KV 存储，同时将生成的唯一 Key 存入 D1 SQL 对应的网址卡片中
    // ==========================================
    if (path === '/api/user/upload-icon' && method === 'POST') {
      const token = request.headers.get("token") || url.searchParams.get("token");
      if (!token) return new Response(JSON.stringify({ success: false, msg: "未登录" }), { status: 401, headers: corsHeaders });

      // 鉴权：去 D1 查询当前用户身份
      const user = await env.DB.prepare('SELECT id FROM Web_online_users_00 WHERE token = ?').bind(token).first();
      if (!user) return new Response(JSON.stringify({ success: false, msg: "登录已失效" }), { status: 403, headers: corsHeaders });

      const userId = user.id;
      const originalName = url.searchParams.get("name") || "icon.png";
      const linkId = url.searchParams.get("link_id"); // 关联的网址卡片ID
      const extension = originalName.split('.').pop().toLowerCase();

      // 生成带有用户ID前缀的唯一 KV 键名，完美实现账号间的数据隔离
      const kvKey = `user_${userId}_${Date.now()}.${extension}`;

      // 读取前端上传过来的二进制图片主体
      const imageBlob = await request.arrayBuffer();
      if (!imageBlob || imageBlob.byteLength === 0) {
        return new Response(JSON.stringify({ success: false, msg: "上传的文件为空" }), { status: 400, headers: corsHeaders });
      }

      // 写入到你绑定的 Web_online_Icon 空间中
      await env.IMAGE_KV.put(kvKey, imageBlob);

      // 如果有传入关联的网址卡片 ID，直接帮用户把新图标绑定到 D1 对应的卡片记录上
      if (linkId) {
        await env.DB.prepare(
          'UPDATE Web_online_info_01 SET icon = ? WHERE id = ? AND user_id = ?'
        ).bind(kvKey, linkId, userId).run();
      }

      return new Response(JSON.stringify({
        success: true,
        msg: "上传成功",
        kvKey: kvKey,
        url: `/api/icon/${kvKey}` // 网页前端可以直接用这个相对路径作为 <img> 的 src
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ====================================================================
    // 🏠 以下为您原有的基础关系型核心业务逻辑 (已完美融合)
    // ====================================================================

    // 1. 用户认证与状态模块
    if (path === '/api/auth/login' && method === 'POST') {
      const body = await request.json();
      const { username, password } = body;
      const user = await env.DB.prepare('SELECT * FROM Web_online_users_00 WHERE username = ? AND password = ?').bind(username, password).first();
      if (user) {
        const token = btoa(username + Date.now());
        await env.DB.prepare('UPDATE Web_online_users_00 SET token = ? WHERE id = ?').bind(token, user.id).run();
        return new Response(JSON.stringify({ success: true, token, user_id: user.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ success: false, msg: "用户名或密码错误" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (path === '/api/auth/register' && method === 'POST') {
      const body = await request.json();
      const { username, password } = body;
      const exist = await env.DB.prepare('SELECT * FROM Web_online_users_00 WHERE username = ?').bind(username).first();
      if (exist) return new Response(JSON.stringify({ success: false, msg: "用户名已存在" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      
      await env.DB.prepare('INSERT INTO Web_online_users_00 (username, password) VALUES (?, ?)').bind(username, password).run();
      return new Response(JSON.stringify({ success: true, msg: "注册成功" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2. 网址卡片管理模块 (获取/增加/更新/删除)
    if (path === '/api/links' && method === 'GET') {
      const token = request.headers.get("token") || url.searchParams.get("token");
      if (!token) return new Response(JSON.stringify({ success: false, msg: "未登录" }), { headers: corsHeaders });
      
      const user = await env.DB.prepare('SELECT id FROM Web_online_users_00 WHERE token = ?').bind(token).first();
      if (!user) return new Response(JSON.stringify({ success: false, msg: "登录失效" }), { headers: corsHeaders });

      // 查出该用户的所有卡片数据，D1 里面原本就预留了 icon 字段
      const { results } = await env.DB.prepare('SELECT * FROM Web_online_info_01 WHERE user_id = ? ORDER BY sort_order DESC, id ASC').bind(user.id).all();
      return new Response(JSON.stringify({ success: true, data: results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (path === '/api/links/add' && method === 'POST') {
      const token = request.headers.get("token");
      const body = await request.json();
      const user = await env.DB.prepare('SELECT id FROM Web_online_users_00 WHERE token = ?').bind(token).first();
      if (!user) return new Response(JSON.stringify({ success: false, msg: "未登录" }), { headers: corsHeaders });

      const { title, url_path, comment, type, sort_order, icon } = body;
      await env.DB.prepare(
        'INSERT INTO Web_online_info_01 (user_id, title, url_path, comment, type, sort_order, icon) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(user.id, title, url_path, comment, type, sort_order || 0, icon || '').run();

      return new Response(JSON.stringify({ success: true, msg: "添加成功" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (path === '/api/links/update' && method === 'POST') {
      const token = request.headers.get("token");
      const body = await request.json();
      const user = await env.DB.prepare('SELECT id FROM Web_online_users_00 WHERE token = ?').bind(token).first();
      if (!user) return new Response(JSON.stringify({ success: false, msg: "未登录" }), { headers: corsHeaders });

      const { id, title, url_path, comment, type, sort_order, icon } = body;
      await env.DB.prepare(
        'UPDATE Web_online_info_01 SET title=?, url_path=?, comment=?, type=?, sort_order=?, icon=? WHERE id=? AND user_id=?'
      ).bind(title, url_path, comment, type, sort_order, icon, id, user.id).run();

      return new Response(JSON.stringify({ success: true, msg: "更新成功" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (path === '/api/links/delete' && method === 'POST') {
      const token = request.headers.get("token");
      const body = await request.json();
      const user = await env.DB.prepare('SELECT id FROM Web_online_users_00 WHERE token = ?').bind(token).first();
      if (!user) return new Response(JSON.stringify({ success: false, msg: "未登录" }), { headers: corsHeaders });

      const { id } = body;
      
      // 【高级隔离联动优化】：删除卡片时，顺便查一下有没有关联的 KV 图片。如果有，把 KV 里的图片也删掉，绝不浪费空间！
      const currentLink = await env.DB.prepare('SELECT icon FROM Web_online_info_01 WHERE id = ? AND user_id = ?').bind(id, user.id).first();
      if (currentLink && currentLink.icon && currentLink.icon.startsWith('user_')) {
        await env.IMAGE_KV.delete(currentLink.icon); 
      }

      await env.DB.prepare('DELETE FROM Web_online_info_01 WHERE id = ? AND user_id = ?').bind(id, user.id).run();
      return new Response(JSON.stringify({ success: true, msg: "删除成功" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3. 备忘录/安全重置代码模块 (Notes)
    if (path === '/api/notes' && method === 'GET') {
      const token = request.headers.get("token");
      const user = await env.DB.prepare('SELECT id FROM Web_online_users_00 WHERE token = ?').bind(token).first();
      if (!user) return new Response(JSON.stringify({ success: false, msg: "未登录" }), { headers: corsHeaders });

      const { results } = await env.DB.prepare('SELECT * FROM Web_online_notes_02 WHERE user_id = ?').bind(user.id).all();
      return new Response(JSON.stringify({ success: true, data: results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (path === '/api/notes/update' && method === 'POST') {
      const token = request.headers.get("token");
      const body = await request.json();
      const user = await env.DB.prepare('SELECT id FROM Web_online_users_00 WHERE token = ?').bind(token).first();
      if (!user) return new Response(JSON.stringify({ success: false, msg: "未登录" }), { headers: corsHeaders });

      const { note_content } = body;
      const exist = await env.DB.prepare('SELECT id FROM Web_online_notes_02 WHERE user_id = ?').bind(user.id).first();
      if (exist) {
        await env.DB.prepare('UPDATE Web_online_notes_02 SET note_content = ? WHERE user_id = ?').bind(note_content, user.id).run();
      } else {
        await env.DB.prepare('INSERT INTO Web_online_notes_02 (user_id, note_content) VALUES (?, ?)').bind(user.id, note_content).run();
      }
      return new Response(JSON.stringify({ success: true, msg: "备忘录保存成功" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 未匹配到路由
    return new Response(JSON.stringify({ success: false, msg: "API 路由未找到" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
}
