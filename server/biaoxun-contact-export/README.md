# 标讯甲方联系方式导出

独立部署在 `/opt/biaoxun-contact-export`，读取现有 `/opt/fujian-qwjsy/.env` 中的 MySQL 配置，不在浏览器中暴露数据库账号。

- 地址：`/contact-export/`
- 默认只搜索标题、项目名称、甲方单位、项目编号，可选正文搜索。
- 从“采购人信息 / 采购人（甲方） / 采购单位 / 招标人”段落提取电话、邮箱、联系人和地址。
- 按甲方单位合并去重，导出 UTF-8 BOM CSV，可直接用 Excel 打开。
- 登录凭据及 Flask secret 仅保存在服务器 `/opt/biaoxun-contact-export/.env`。
