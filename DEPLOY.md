# 免费部署说明

当前项目是静态网页 + Supabase 数据库版本，可以免费部署到 Vercel、Netlify 或 Cloudflare Pages。

## 重要说明

当前版本使用 Supabase 免费数据库和 Realtime：

- 手机用户端取号后，电脑管理端会同步看到。
- 管理端叫号后，用户端会实时更新。
- 需要先创建 Supabase 项目并填写 `src/config.js`。
- 未填写 Supabase 配置时，只适合本地浏览器闭环测试，不适合正式多人线上使用。

## Supabase 数据库配置

1. 打开 `https://supabase.com`。
2. 创建免费项目。
3. 进入项目后台。
4. 打开 SQL Editor。
5. 把 `supabase/schema.sql` 的内容复制进去并运行。
6. 打开 Project Settings -> API。
7. 复制 Project URL 和 anon public key。
8. 填到 `src/config.js`。

```js
export const SUPABASE_URL = "https://你的项目.supabase.co";
export const SUPABASE_ANON_KEY = "你的 anon public key";
```

## Vercel 部署

1. 打开 `https://vercel.com`。
2. 注册或登录账号。
3. 新建 Project。
4. 上传整个 `queue-online` 项目，或连接 GitHub 仓库。
5. Framework 选择 `Other`。
6. Build Command 留空。
7. Output Directory 留空。
8. Deploy。

部署完成后：

- 用户端：`https://你的项目名.vercel.app/`
- 管理端：`https://你的项目名.vercel.app/admin.html`
- 管理端短地址：`https://你的项目名.vercel.app/admin`

## Netlify 部署

1. 打开 `https://www.netlify.com`。
2. 登录账号。
3. 选择 Add new site。
4. 直接拖拽整个 `queue-online` 文件夹。
5. 发布完成后会得到一个免费网站地址。

## Cloudflare Pages 部署

1. 打开 `https://pages.cloudflare.com`。
2. 新建 Pages 项目。
3. 上传整个 `queue-online` 文件夹。
4. Build Command 留空。
5. Output Directory 留空。

## 安全说明

当前版本为了免费静态部署，管理端密码写在前端配置里，适合小店、内部测试、低风险场景。

如果要正式商用并防止别人绕过管理端操作，需要继续升级：

- Supabase Auth 管理员登录
- RLS 权限策略
- 管理操作走 Edge Function
