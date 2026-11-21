import moment from "moment"
import { Config, DataStore, Log_Prefix } from "#join-verify.components"
import { ApiProbe, VerifyPipeline } from "#join-verify.model"
import { VerifyBase } from "./common.js"

/**
 * 查询、统计与测试命令
 * 命令：#查询用户 / #入群自动化统计 / #入群验证插件设置 / #入群验证菜单 /
 *       #测试验证 / #QQ接口测试 / #设置通知群
 */
export class Query extends VerifyBase {
  constructor() {
    super({
      name: "入群验证-查询",
      rule: [
        { reg: "^#设置通知群$", fnc: "setNotificationGroup" },
        { reg: "^#查询用户\\s*(\\S.+)$", fnc: "queryUser" },
        { reg: "^#入群自动化统计$", fnc: "showStatistics" },
        { reg: "^#入群验证插件设置$", fnc: "showSettings" },
        { reg: "^#入群验证菜单$", fnc: "showMenu" },
        { reg: "^#测试验证\\s*(\\S.+)$", fnc: "testVerify" },
        { reg: "^#QQ接口测试(?:\\s+(\\d+))?$", fnc: "qqApiTest" }
      ]
    })
  }

  async setNotificationGroup(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 执行 #设置通知群 命令`)
    if (!await this.checkPermission(e, "master")) return

    const groupId = String(e.group_id)
    Config.modify("config", "notificationGroup", groupId)
    e.reply(`已将通知群设置为当前群：${groupId}`)
    logger.info(`${Log_Prefix} [命令执行] #设置通知群 成功，群号: ${groupId}`)
  }

  async showMenu(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 执行 #入群验证菜单 命令`)
    if (!await this.checkPermission(e, "master")) return

    const menu = [
      "入群验证菜单\n\n",
      "【API管理】\n",
      "#新增查询api [API地址] - 增加手机号查询接口\n",
      "#删除查询api [API地址] - 删除查询接口\n",
      "#查询API列表 - 查看所有API状态\n",
      "#测试api - 测试所有API接口延迟与可用性\n\n",
      "【黑白名单】\n",
      "#新增红用户 [QQ/@用户] - 增加永久拉黑用户\n",
      "#删除红用户 [QQ/@用户] - 移除红用户\n",
      "#新增黑名单 [QQ/@用户] - 增加限时黑名单\n",
      "#删除黑名单 [QQ/@用户] - 移除黑名单\n\n",
      "【退群用户管理】\n",
      "#查看退群用户 [页码] - 分页查看退群用户列表\n",
      "#设置退群用户策略 [QQ] [验证/拒绝] - 设置退群用户二次入群策略\n",
      "#移除退群用户 [QQ/@用户] - 移除退群用户标记\n\n",
      "【群管理/清退】\n",
      "#获取需管理群 - 获取已配置规则的群列表(前置命令)\n",
      "#获取所有群员 - 遍历管理群获取成员列表\n",
      "#联动清退 [QQ] - 检索QQ在所有管理群的位置并确认清退\n",
      "#确认清退 - 确认执行清退操作\n",
      "#取消清退 - 取消清退操作\n",
      "#测试检索清退群 [QQ] - 测试检索QQ在管理群的位置\n",
      "#测试撤回消息 [QQ] [秒] - 测试检索QQ在管理群N秒内的消息\n\n",
      "【配置设置】\n",
      "#设置通知群 - 设置审核日志推送群\n",
      "#开启入群审核 - 开启当前群入群审核(全部验证:手机号+ID)\n",
      "#开启手机号验证 - 开启当前群手机号验证(仅验证手机号,不记录ID)\n",
      "#关闭入群审核 - 关闭当前群入群审核\n",
      "#设置入群规则 [群号] [拒绝/手机号验证/全部验证] - 设置指定群入群规则\n",
      "#设置导流x群群号+qq群号 - 设置拒绝时的导流目标(如 #设置导流9群群号123456789)\n",
      "#设置黑名单阈值 [数字] - 设置自动拉黑阈值\n",
      "#设置黑名单时间 [数字] - 设置拉黑时长(秒)\n",
      "#拉黑开启/关闭 - 开关自动拉黑功能\n\n",
      "【查询功能】\n",
      "#查询用户 [QQ/@用户] - 查询用户绑定信息\n",
      "#入群自动化统计 - 查看入群审核统计\n",
      "#入群验证插件设置 - 查看当前配置\n\n",
      "【测试功能】\n",
      "#测试验证 [内容] [手机号验证/全部验证] - 测试验证流程\n",
      "#QQ接口测试 [群号] - 检测协议端支持哪些QQ接口\n\n",
      "【菜单】\n",
      "#入群验证菜单 - 显示此菜单"
    ]

    e.reply(menu)
    logger.info(`${Log_Prefix} [命令执行] #入群验证菜单 成功`)
  }

  async showSettings(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 执行 #入群验证插件设置 命令`)
    if (!await this.checkPermission(e, "master")) return

    const cfg = Config.getConfig("config")
    const allStats = DataStore.getAllStatistics()
    const apiList = DataStore.getApiList()

    let msg = `入群验证插件设置\n\n`
    msg += `【基础配置】\n`
    msg += `通知群：${cfg.notificationGroup || "未设置"}\n`
    msg += `拉黑阈值：${cfg.blacklistThreshold || 10}次\n`
    msg += `拉黑时长：${cfg.blacklistDuration || 3600}秒\n`
    msg += `自动拉黑：${cfg.blacklistEnabled !== false ? "开启" : "关闭"}\n`
    msg += `API接口数：${apiList.length}个\n\n`

    msg += `【导流配置】\n`
    msg += `当前文案：${DataStore.getDiversionReason()}\n\n`

    msg += `【统计数据】\n`
    msg += `通过：${allStats.totalApproved}\n`
    msg += `拒绝：${allStats.totalRejected}\n`
    msg += `拉黑：${allStats.totalBlacklisted}\n`

    e.reply(msg)
    logger.info(`${Log_Prefix} [命令执行] #入群验证插件设置 成功`)
  }

  async queryUser(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 在群 ${e.group_id} 执行 #查询用户 命令`)
    if (!await this.checkPermission(e, "master")) return

    const qq = this.extractQQ(e)
    if (!qq) {
      logger.warn(`${Log_Prefix} [命令执行] #查询用户 缺少QQ参数`)
      return e.reply("请输入QQ号或@用户")
    }

    const binding = DataStore.getBindingByQQ(qq)
    const isRedUser = DataStore.isRedUser(qq)
    const isInBlacklist = DataStore.isInBlacklist(e.group_id, qq)
    const blacklistExpire = isInBlacklist
      ? moment(DataStore.getBlacklistExpireTime(e.group_id, qq)).format("YYYY-MM-DD HH:mm:ss")
      : ""
    const leaveUser = DataStore.getLeaveUser(qq)

    let msg = `用户查询结果\n\n`
    msg += `QQ号：${qq}\n`

    if (binding) {
      msg += `绑定手机号：${binding.phone}\n`
      msg += `绑定时间：${moment(binding.bindTime).format("YYYY-MM-DD HH:mm:ss")}\n`
    } else {
      msg += `绑定手机号：未绑定\n`
    }

    msg += `红用户：${isRedUser ? "是" : "否"}\n`
    msg += `限时黑名单：${isInBlacklist ? "是" : "否"}${blacklistExpire ? ` (到期: ${blacklistExpire})` : ""}\n`

    if (leaveUser) {
      const policyText = leaveUser.policy === "verify" ? "正常验证" : "拒绝"
      msg += `退群用户：是\n`
      msg += `二次入群策略：${policyText}\n`
      msg += `涉及群：${(leaveUser.groups || []).join(", ")}\n`
      msg += `退群时间：${moment(leaveUser.leaveTime).format("YYYY-MM-DD HH:mm:ss")}\n`
    } else {
      msg += `退群用户：否\n`
    }

    e.reply(msg)
    logger.info(`${Log_Prefix} [命令执行] #查询用户 成功，QQ: ${qq}`)
  }

  async showStatistics(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 执行 #入群自动化统计 命令`)
    if (!await this.checkPermission(e, "master")) return

    const allStats = DataStore.getAllStatistics()
    const groupRules = DataStore.getGroupRules()

    let msg = `入群审核统计\n\n`
    msg += `总计通过：${allStats.totalApproved}\n`
    msg += `总计拒绝：${allStats.totalRejected}\n`
    msg += `总计拉黑：${allStats.totalBlacklisted}\n\n`

    if (Object.keys(groupRules).length > 0) {
      msg += `【分群统计】\n`
      for (const groupId of Object.keys(groupRules)) {
        const stat = DataStore.getGroupStatistics(groupId)
        msg += `群 ${groupId}：通过${stat.approved} / 拒绝${stat.rejected}\n`
      }
    }

    e.reply(msg)
    logger.info(`${Log_Prefix} [命令执行] #入群自动化统计 成功`)
  }

  async testVerify(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 执行 #测试验证 命令`)
    if (!await this.checkPermission(e, "master")) return

    const raw = e.msg.replace(/^#测试验证\s*/, "").trim()
    if (!raw) {
      return e.reply("请输入测试内容，如：#测试验证 1380013800012345678 或 #测试验证 13800138000 手机号")
    }

    let mode = "full"
    let content = raw
    if (/手机号验证\s*$/.test(raw)) {
      mode = "phone"
      content = raw.replace(/手机号验证\s*$/, "").trim()
    } else if (/全部验证\s*$/.test(raw)) {
      mode = "full"
      content = raw.replace(/全部验证\s*$/, "").trim()
    }

    const testEvent = {
      user_id: e.user_id,
      group_id: e.group_id,
      group_name: e.group_name,
      nickname: e.nickname,
      comment: content,
      testMode: true
    }

    const result = await VerifyPipeline.process(testEvent, { mode })

    let msg = `测试验证结果\n\n`
    msg += `测试内容：${content}\n`
    msg += `验证模式：${mode === "phone" ? "手机号验证" : "全部验证"}\n`
    msg += `处理结果：${result.approve ? "通过" : "拒绝"}\n`
    if (result.reason) msg += `理由：${result.reason}\n`
    msg += `\n校验步骤：\n`
    result.checkSteps?.forEach((s, i) => {
      msg += `${i + 1}. ${s.name}：${s.result}${s.detail ? ` (${s.detail})` : ""}\n`
    })
    msg += `\n仅为测试，未实际处理申请`

    e.reply(msg)
    logger.info(`${Log_Prefix} [命令执行] #测试验证 完成`)
  }

  async qqApiTest(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 执行 #QQ接口测试 命令`)
    if (!await this.checkPermission(e, "master")) return

    const match = e.msg.match(/^#QQ接口测试(?:\s+(\d+))?$/)
    const targetGroupId = match?.[1] || String(e.group_id || "")
    if (!targetGroupId) return e.reply("请指定要测试的群号")

    e.reply(`正在检测协议端接口支持情况（群 ${targetGroupId}），请稍候...`)

    const { text } = await ApiProbe.probe({ bot: this.Bot, e, groupId: targetGroupId })
    e.reply(text)
    logger.info(`${Log_Prefix} [命令执行] #QQ接口测试 完成，群: ${targetGroupId}`)
  }
}

export default Query
