export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // 统一处理跨域请求（CORS）
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ==========================================
    // 路由：/api/code-grid
    // ==========================================
    if (path === "/api/code-grid") {
      
      // 1. GET 请求：获取当前用户的所有页签与行数据
      if (method === "GET") {
        const userId = url.searchParams.get("userId");
        if (!userId) {
          return new Response(JSON.stringify({ error: "缺少 userId 参数" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // 从 D1 中按排序查询该用户的记录
        const { results } = await env.DB.prepare(`
          SELECT id, tab_index, sort_order, row_data 
          FROM Web_code_rows 
          WHERE user_id = ? 
          ORDER BY sort_order ASC
        `).bind(userId).all();

        // 将数据库中的 JSON 字符串解析回对象传给前端
        const formattedData = results.map(row => {
          let parsedData = {};
          try {
            parsedData = JSON.parse(row.row_data);
          } catch (e) {
            parsedData = { tabTitle: "未命名页签", grids: [] }; // 防错处理
          }
          return {
            id: row.id,
            tabIndex: row.tab_index,
            sortOrder: row.sort_order,
            ...parsedData // 展开解构出 tabTitle 和 grids
          };
        });

        return new Response(JSON.stringify({ success: true, data: formattedData }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 2. POST 请求：保存或批量更新用户的所有页签与行数据
      if (method === "POST") {
        const { userId, rows } = await request.json();

        if (!userId || !Array.isArray(rows)) {
          return new Response(JSON.stringify({ error: "参数不完整，必须包含 userId 和 rows 数组" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // 使用 D1 事务批量保存（先清空当前用户的旧数据，再重新写入，这样能完美同步删除/增加的行）
        // 如果数据量极大，推荐逐条 upsert；在这里通过清空重写是最简单干净的覆盖保存方式
        const statements = [
          env.DB.prepare("DELETE FROM Web_code_rows WHERE user_id = ?").bind(userId)
        ];

        rows.forEach((row, index) => {
          // 将页签名称和网格数据打包装入 row_data
          const rowDataText = JSON.stringify({
            tabTitle: row.tabTitle || `页签 ${index + 1}`,
            grids: row.grids || []
          });

          statements.push(
            env.DB.prepare(`
              INSERT INTO Web_code_rows (user_id, tab_index, sort_order, row_data)
              VALUES (?, ?, ?, ?)
            `).bind(userId, row.tabIndex || index, row.sortOrder || index, rowDataText)
          );
        });

        // 执行批量提交
        await env.DB.batch(statements);

        return new Response(JSON.stringify({ success: true, message: "保存成功" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // ==========================================
    // 其他原有的 API 路由（如 user, notes 等）保持不变
    // ==========================================
    return new Response(JSON.stringify({ error: "API 接口不存在" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}
