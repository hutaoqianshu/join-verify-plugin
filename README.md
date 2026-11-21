# join-verify-plugin
`join-verify-plugin`是一个群管功能插件，插件主要使用手机号对申请入群用户进行验证并记录

>本插件主要使用AI进行制作

## 本插件仅个人使用，因需求特殊，不推荐他人使用


## 安装

1. 将本插件放入 Yunzai-Bot 的 `plugins/` 目录

```bash
cd Yunzai-Bot/plugins
git clone https://github.com/hutaoqianshu/join-verify-plugin.git
```

2. 安装依赖

```bash
cd join-verify-plugin
pnpm install
```

3. 重启 Bot

首次启动会自动创建 `config/config/` 与 `data/` 等数据文件

## 配置

配置文件：`config/config/config.yaml`

```yaml
# 触发自动拉黑的申请次数阈值
blacklistThreshold: 10
# 限时黑名单时长（秒）
blacklistDuration: 3600
# 是否启用自动拉黑
blacklistEnabled: true
# API 巡检间隔（秒）
apiCheckInterval: 600
# 审核通知推送群号，留空则不推送
notificationGroup: ""
# 虚拟运营商号段前缀，留空则只依赖 API 判定
virtualNumberPrefix:
  - "170"
  - "171"
  - "165"
# 导流配置（首次使用请通过 #设置导流x群群号+qq群号 命令设置）
diversionEnabled: true
diversionIndex: ""
diversionGroupId: ""
diversionText: "本群已满，请加{index}群{groupId}"
# 退群策略的额外白名单管理员 QQ，留空则仅主人可操作
leaveUserAdminQQ: ""
```


## 命令

所有命令**仅限 Bot 主人**使用。

### 群规则

| 命令 | 说明 |
|---|---|
| `#开启入群审核` | 当前群开启全部验证（手机号 + ID） |
| `#开启手机号验证` | 当前群仅验证手机号 |
| `#关闭入群审核` | 当前群关闭审核 |
| `#设置入群规则 [群号] [拒绝/手机号验证/全部验证]` | 设置指定群规则 |
| `#设置导流[x]群群号[群号]` | 设置导流目标，如 `#设置导流9群群号12382479` |

### 黑白名单

| 命令 | 说明 |
|---|---|
| `#新增红用户 [QQ/@用户]` | 加入永久黑名单 |
| `#删除红用户 [QQ/@用户]` | 移出永久黑名单 |
| `#新增黑名单 [QQ/@用户]` | 加入当前群限时黑名单 |
| `#删除黑名单 [QQ/@用户]` | 移出当前群限时黑名单 |
| `#设置黑名单阈值 [数字]` | 设置触发拉黑的申请次数 |
| `#设置黑名单时间 [秒]` | 设置拉黑时长 |
| `#拉黑开启` / `#拉黑关闭` | 开关自动拉黑 |

### 退群用户

| 命令 | 说明 |
|---|---|
| `#查看退群用户 [页码]` | 分页查看退群用户列表 |
| `#设置退群用户策略 [QQ] [验证/拒绝]` | 设置二次入群策略 |
| `#移除退群用户 [QQ/@用户]` | 移除退群标记 |

### 群管理与清退

| 命令 | 说明 |
|---|---|
| `#获取需管理群` | 获取已配置规则的群列表（前置命令） |
| `#获取所有群员` | 遍历管理群抓取成员列表 |
| `#联动清退 [QQ]` | 检索该 QQ 在所有管理群的位置，等待确认 |
| `#确认清退` | 执行撤消息 + 踢出 |
| `#取消清退` | 取消本次清退 |
| `#测试检索清退群 [QQ]` | 仅检索，不执行 |
| `#测试撤回消息 [QQ] [秒]` | 仅统计可撤回消息数，不执行 |

### API 管理

| 命令 | 说明 |
|---|---|
| `#新增查询api [地址]` | 添加手机号查询接口，地址中用 `{phone}` 占位 |
| `#删除查询api [地址]` | 删除接口 |
| `#查询API列表` | 查看所有接口状态与延迟 |
| `#测试api` | 测试所有接口可用性 |

### 查询与测试

| 命令 | 说明 |
|---|---|
| `#查询用户 [QQ/@用户]` | 查询绑定、黑名单、退群状态 |
| `#入群自动化统计` | 查看审核统计 |
| `#入群验证插件设置` | 查看当前配置 |
| `#入群验证菜单` | 显示完整菜单 |
| `#设置通知群` | 将当前群设为审核通知群 |
| `#测试验证 [内容] [模式]` | 测试校验流程，不实际处理 |
| `#QQ接口测试 [群号]` | 检测协议端支持的接口 |




## 目录结构

```
join-verify-plugin/
├── index.js              # 插件入口，递归加载命令与事件
├── apps/
│   ├── verify/           # 命令模块
│   │   ├── common.js     # 命令基类（权限、QQ 提取、群名兜底）
│   │   ├── rule.js       # 群规则与导流
│   │   ├── blacklist.js  # 黑白名单
│   │   ├── leaveUser.js  # 退群用户
│   │   ├── cleanup.js    # 群管理与清退
│   │   ├── api.js        # API 管理
│   │   └── query.js      # 查询、统计、测试
│   └── events/
│       ├── request.js    # 入群申请处理
│       └── notice.js     # 退群/踢人事件
├── components/
│   ├── Config.js         # 配置读写与热重载
│   ├── DataStore.js      # 数据持久化
│   └── index.js
├── model/
│   ├── VerifyPipeline.js # 校验管道
│   ├── ApiManager.js     # API 调度
│   ├── ApiProbe.js       # 协议端能力探测
│   └── Notification.js   # 消息通知
├── tools/
├── constants/
└── config/
    ├── default_config/   # 默认配置模板
    └── config/           # 实际配置（已忽略）
```

## 数据说明


| 文件 | 内容 |
|---|---|
| `bindings.json` | 手机号 ↔ QQ 绑定 |
| `redUsers.json` | 永久黑名单 |
| `blacklist.json` | 限时黑名单 |
| `applyCounts.json` | 申请次数计数 |
| `groupRules.json` | 各群审核规则 |
| `statistics.json` | 审核统计 |
| `auditLogs.json` | 审核日志（超 3000 条自动归档） |
| `managedGroups.json` | 需管理群列表 |
| `groupMembers.json` | 群成员快照 |
| `leaveUsers.json` | 退群用户 |
| `apiList.json` | 查询接口列表 |
| `pendingCleanup.json` | 待确认的清退操作 |


## License

[MIT](./LICENSE)
