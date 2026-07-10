# 覆盖部署步骤

当前可以保持原网址覆盖部署。

你的原网址类似：

```text
https://curious-kheer-27c89e.netlify.app/
```

只要 Netlify 还是连接原来的 GitHub 仓库，更新 GitHub 后 Netlify 会自动重新发布，网址不变。

## 第一步：运行 Supabase SQL

1. 打开 Supabase。
2. 进入之前的项目。
3. 打开 SQL Editor。
4. 新建 Query。
5. 打开本项目的 `supabase/schema.sql`。
6. 全部复制进去。
7. 点 Run。
8. 出现危险提示时点运行查询。
9. 看到 Success 就成功。

这一步会创建新版表：

```text
meteor_settings
meteor_designers
meteor_design_tickets
meteor_logs
```

不会删除你旧版表。

## 第二步：上传 GitHub 覆盖旧仓库

1. 打开 GitHub 旧仓库。
2. 确认这个仓库就是 Netlify 当前连接的仓库。
3. 删除旧文件，或者直接上传覆盖。
4. 上传本项目文件夹里面的内容，不要上传外层文件夹。

GitHub 根目录应该直接看到：

```text
index.html
admin.html
src
supabase
README.md
DEPLOY_STEPS.md
```

不要变成：

```text
meteor-design-queue-online/index.html
```

## 第三步：等待 Netlify 自动部署

GitHub 提交后，Netlify 会自动部署。

部署成功后，原网址保持不变：

```text
用户端：https://curious-kheer-27c89e.netlify.app/
管理端：https://curious-kheer-27c89e.netlify.app/admin.html
```

管理密码默认：

```text
123456
```

## 测试闭环

1. 打开用户端。
2. 选择设计A取号。
3. 打开管理端。
4. 登录。
5. 查看设计A等待中出现号码。
6. 点设计A的叫下一个。
7. 用户端设计A当前待处理数量不变，但后台状态从等待中变制作中。
8. 管理端点完成。
9. 用户端设计A当前待处理数量减少 1。
10. 管理端点暂停接单。
11. 用户端设计A显示暂停接单，取号按钮禁用。
12. 管理端点恢复接单。
13. 用户端设计A恢复可取号。
