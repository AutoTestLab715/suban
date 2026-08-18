# 信息提交小程序

基于微信云开发的表单提交小程序，支持微信账号登录注册，普通用户填写表单，管理员在小程序端管理全部提交。

## 功能

### 用户端
- **微信登录/注册**：使用微信头像、昵称完成账号注册
- **表单提交**：姓名、手机号、邮箱（选填）、类型、留言内容
- **提交记录**：查看自己的历史提交及处理状态

### 管理后台（小程序端）
- **微信身份鉴权**：管理员需在数据库中配置 `role: admin`
- **数据统计**：全部 / 待处理 / 已处理
- **记录管理**：查看、筛选、标记状态、删除

## 启动流程

1. 打开小程序 → **身份核验页**
2. **已注册用户** → 自动微信登录 → 按身份跳转
   - 管理员 → 管理后台
   - 普通用户 → 表单页
3. **未注册用户** → 微信账号注册（头像 + 昵称）→ 进入表单页

## 使用步骤

### 1. 开通云开发并配置环境 ID

在 `miniprogram/app.js` 中填入云环境 ID。

### 2. 上传云函数

右键 `cloudfunctions/quickstartFunctions` → **上传并部署：云端安装依赖**。

### 3. 设置管理员

在云开发控制台 → 数据库 → `users` 集合，将目标用户的 `role` 字段改为 `admin`：

```json
{
  "_openid": "用户openid",
  "nickName": "管理员",
  "avatarUrl": "...",
  "role": "admin"
}
```

### 4. 编译运行

## 项目结构

```
miniprogram/
  pages/
    entry/           # 启动页（微信登录）
    register/        # 微信注册页
    index/           # 表单提交页
    list/            # 用户提交记录
    admin/
      index/         # 管理后台
      detail/        # 记录详情
cloudfunctions/
  quickstartFunctions/
```

## 数据库

### 集合：`users`

| 字段 | 类型 | 说明 |
|------|------|------|
| _openid | string | 微信用户唯一标识 |
| nickName | string | 微信昵称 |
| avatarUrl | string | 头像地址 |
| role | string | `user`（默认）/ `admin` |
| createTime | date | 注册时间 |
| lastLoginTime | date | 最后登录时间 |

### 集合：`form_submissions`

| 字段 | 类型 | 说明 |
|------|------|------|
| name | string | 姓名 |
| phone | string | 手机号 |
| email | string | 邮箱 |
| type | string | 提交类型 |
| content | string | 留言内容 |
| status | string | `pending` / `processed` |
| _openid | string | 提交用户 |
| createTime | date | 提交时间 |

## 云函数接口

| type | 权限 | 说明 |
|------|------|------|
| checkUser | 公开 | 检查是否已注册 |
| loginUser | 已注册 | 微信登录 |
| registerUser | 公开 | 微信注册 |
| submitForm | 已登录 | 提交表单 |
| getMyForms | 已登录 | 查询自己的记录 |
| getFormStats | 管理员 | 统计数据 |
| getAllForms | 管理员 | 分页查询全部 |
| getFormDetail | 管理员 | 记录详情 |
| updateFormStatus | 管理员 | 更新状态 |
| deleteFormSubmission | 管理员 | 删除记录 |

## 参考文档

- [云开发文档](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/basis/getting-started.html)

## 标讯中心（MySQL 数据源）

小程序首页已增加“标讯中心”入口。小程序不会直连 MySQL，所有查询都通过 `quickstartFunctions` 云函数代理，数据库密码不会下发到客户端。

### 1. 配置云函数环境变量

在云开发控制台 → 云函数 → `quickstartFunctions` → 配置 → 环境变量中设置：

| 变量 | 必填 | 示例 | 说明 |
|------|------|------|------|
| `BIAOXUN_DB_HOST` | 否 | `47.99.117.191` | 默认即为该服务器 |
| `BIAOXUN_DB_PORT` | 否 | `3306` | MySQL 端口 |
| `BIAOXUN_DB_USER` | 是 | `biaoxun_reader` | 建议使用只读账号 |
| `BIAOXUN_DB_PASSWORD` | 是 | `请填写强密码` | 不要写入小程序源码 |
| `BIAOXUN_DB_NAME` | 否 | `biaoxun` | 默认数据库名 |
| `BIAOXUN_DB_TABLE` | 否 | `bidding_notices` | 不填时会自动识别常见标讯表 |

自动识别失败时，可继续配置字段映射：

- `BIAOXUN_COLUMN_ID`
- `BIAOXUN_COLUMN_TITLE`
- `BIAOXUN_COLUMN_PUBLISH_TIME`
- `BIAOXUN_COLUMN_DEADLINE`
- `BIAOXUN_COLUMN_REGION`
- `BIAOXUN_COLUMN_BUYER`
- `BIAOXUN_COLUMN_AGENCY`
- `BIAOXUN_COLUMN_BUDGET`
- `BIAOXUN_COLUMN_SOURCE`
- `BIAOXUN_COLUMN_URL`
- `BIAOXUN_COLUMN_CATEGORY`
- `BIAOXUN_COLUMN_CONTENT`

### 2. 服务器安全要求

请在 `47.99.117.191` 上创建仅拥有 `biaoxun` 数据库 `SELECT` 权限的账号，不要使用 MySQL `root` 账号。MySQL 端口只对白名单来源开放，并将云函数出口地址加入服务器安全组和 MySQL 访问白名单。

```sql
CREATE USER 'biaoxun_reader'@'允许的来源地址' IDENTIFIED BY '高强度密码';
GRANT SELECT ON biaoxun.* TO 'biaoxun_reader'@'允许的来源地址';
FLUSH PRIVILEGES;
```

### 3. 部署

在微信开发者工具中右键 `cloudfunctions/quickstartFunctions`，选择“上传并部署：云端安装依赖”。部署后重新编译小程序，即可从首页进入标讯列表，支持关键词搜索、分页加载和详情查看。
