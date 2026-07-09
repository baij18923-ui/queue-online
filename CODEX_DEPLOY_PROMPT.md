# 给 Codex 的部署指令

请把这个取号叫号系统部署到免费线上环境。

## 项目说明

这是一个静态前端项目：

- 用户端：`/`
- 管理端：`/admin.html`
- 管理端短路径：`/admin`
- 数据库：Supabase
- 实时同步：Supabase Realtime
- 部署目标：Vercel 免费项目

## 必须先配置 Supabase

1. 登录 Supabase。
2. 创建一个免费项目。
3. 打开 SQL Editor。
4. 执行 `supabase/schema.sql` 里的全部 SQL。
5. 打开 Project Settings -> API。
6. 复制：
   - Project URL
   - anon public key
7. 修改 `src/config.js`：

```js
export const SUPABASE_URL = "粘贴 Supabase Project URL";
export const SUPABASE_ANON_KEY = "粘贴 Supabase anon public key";

export const ADMIN_PASSWORD = "123456";
```

上线前可以把 `ADMIN_PASSWORD` 改成用户指定的管理密码。

## GitHub

1. 创建一个新的 GitHub 仓库，例如 `queue-online`。
2. 把当前项目所有文件提交到仓库。
3. 确认不要提交无关缓存文件。

推荐提交命令：

```bash
git init
git add .
git commit -m "Deploy queue system"
git branch -M main
git remote add origin <GitHub 仓库地址>
git push -u origin main
```

## Vercel

1. 登录 Vercel。
2. New Project。
3. Import 刚创建的 GitHub 仓库。
4. Framework Preset 选择 `Other`。
5. Build Command 留空。
6. Output Directory 留空。
7. 点击 Deploy。

部署完成后检查：

- `https://项目名.vercel.app/` 用户端能打开。
- `https://项目名.vercel.app/admin.html` 管理端能打开。
- `https://项目名.vercel.app/admin` 管理端短路径能打开。

## 功能测试

1. 手机或新窗口打开用户端。
2. 电脑打开管理端。
3. 管理端密码默认 `123456`，如果已修改则使用新密码。
4. 用户端点击“立即取号”。
5. 管理端应实时出现等待号码。
6. 管理端点击“叫下一个”。
7. 用户端当前叫号应实时更新。
8. 管理端修改“叫号提示文本”，例如：

```text
请 {number} 到 3 号窗口办理
```

9. 再叫号，用户端提示文本应按新模板显示。

## 注意

当前版本为了静态免费部署，管理密码在前端配置里，适合测试、小店和低风险场景。

如果要更正式的权限安全，需要下一版升级：

- Supabase Auth 管理员登录
- 更严格的 RLS
- 管理操作走 Supabase Edge Function
