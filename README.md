# 在线取号叫号系统

这个版本把展示屏合并到了用户端：

- 用户端 `/`：取号、显示当前叫号、等待人数、等待号码。
- 管理端 `/admin.html`：登录后叫号、重叫、跳过、暂停取号、清空队列、重置和导出记录。
- 管理端短路径 `/admin`：通过 `vercel.json` 重写到 `/admin.html`。
- 管理端可以自定义叫号提示文本，例如 `请 {number} 到窗口办理`。
- Supabase 提供在线数据库和 Realtime 实时同步。
- 未配置 Supabase 时，项目会启用浏览器本地测试数据源，方便先验证闭环；填入 Supabase 配置后会自动使用线上数据库。

## 本地运行

```bash
python -m http.server 5173
```

打开：

- 用户端：`http://localhost:5173/`
- 管理端：`http://localhost:5173/admin.html`
- 管理端短路径：`http://localhost:5173/admin`

管理端默认密码：`123456`

## Supabase 配置

1. 创建 Supabase 免费项目。
2. 打开 SQL Editor。
3. 执行 `supabase/schema.sql`。
4. 打开 `src/config.js`。
5. 填入 `SUPABASE_URL` 和 `SUPABASE_ANON_KEY`。

```js
export const SUPABASE_URL = "https://你的项目.supabase.co";
export const SUPABASE_ANON_KEY = "你的 anon public key";
```

管理端密码也在 `src/config.js`：

```js
export const ADMIN_PASSWORD = "123456";
```

## 免费部署

这是无构建静态网站，可以直接部署到 Vercel。

详细部署步骤见 `DEPLOY.md`。如果要交给另一个有浏览器和 GitHub 权限的 Codex 部署，可以把 `CODEX_DEPLOY_PROMPT.md` 的内容发给它。
