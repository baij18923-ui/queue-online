# 覆盖部署步骤

当前可以保持原网址覆盖部署。

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

这一步会新增/更新这些表：

```text
meteor_settings
meteor_designers
meteor_design_tickets
meteor_logs
meteor_month_manual_stats
```

`meteor_month_manual_stats` 是本次新增的手动本月统计表。

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
7. 号码变成制作中。
8. 点完成。
9. 用户端设计A当前待处理数量减少 1。
10. 后台点设计A暂停接单。
11. 用户端设计A显示暂停接单，取号按钮禁用。
12. 后台点恢复接单。
13. 用户端设计A恢复可取号。
14. 后台进入本月统计。
15. 手动填写本月接单、等待中、制作中、已完成、已作废。
16. 完成率自动变化。
17. 点击保存本月统计。
18. 刷新后台，确认手动填写的数据仍然保留。


## 这次部署前建议
1. 先在 Supabase SQL Editor 重新执行 `supabase/schema.sql`，确保新增的统计快照字段和 `meteor_clear_all_data()` 已创建。
2. 再把整个项目文件覆盖到 GitHub 仓库。
3. Netlify 会自动重新部署。
4. 部署完成后，进入管理端点击一次“清空全部数据”，即可把旧测试数据和旧统计清零。
