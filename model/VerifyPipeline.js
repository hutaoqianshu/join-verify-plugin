import { DataStore, Config, Log_Prefix } from "#join-verify.components"
import ApiManager from "./ApiManager.js"
import Notification from "./Notification.js"

class VerifyPipeline {
  constructor() {
    this.checks = [
      { name: "红用户校验", fnc: this.checkRedUser.bind(this) },
      { name: "退群用户校验", fnc: this.checkLeaveUser.bind(this) },
      { name: "限时黑名单校验", fnc: this.checkBlacklist.bind(this) },
      { name: "申请次数阈值校验", fnc: this.checkApplyCount.bind(this) },
      { name: "ID校验", fnc: this.checkId.bind(this) },
      { name: "手机号验证", fnc: this.checkPhoneValidation.bind(this) },
      { name: "手机号绑定校验", fnc: this.checkPhoneBinding.bind(this) }
    ]
  }

  async process(e, options = {}) {
    const mode = options.mode || "full"
    const qq = e.user_id
    const groupId = e.group_id
    const comment = e.comment || ""
    const { phone, userId } = this.extractInfo(comment)

    let result = {
      e,
      nickname: e.nickname,
      qq,
      approve: false,
      reason: "",
      isBlacklisted: false,
      phone,
      userId,
      phoneResult: "未校验",
      idResult: mode === "phone" ? "跳过" : "未校验",
      location: null,
      comment,
      mode,
      checkSteps: []
    }

    const skippedChecks = mode === "phone" ? ["ID校验"] : []
    const executedChecks = this.checks.filter(c => !skippedChecks.includes(c.name))

    logger.info(`${Log_Prefix} [校验开始] 开始执行校验管道，模式: ${mode}，共${executedChecks.length}项校验`)
    logger.info(`${Log_Prefix} [提取信息] 手机号: ${phone || '未提取'}, ID: ${userId || '未提取'}, 答案: ${comment || '无'}`)

    for (let i = 0; i < executedChecks.length; i++) {
      const { name, fnc } = executedChecks[i]
      logger.info(`${Log_Prefix} [校验中] 执行第${i + 1}项: ${name}`)
      const checkResult = await fnc({ qq, groupId, phone, userId, e, result })
      if (!checkResult.pass) {
        logger.info(`${Log_Prefix} [校验失败] ${name}未通过: ${checkResult.reason}`)
        result.reason = checkResult.reason
        result.isBlacklisted = checkResult.isBlacklisted || false
        // 透传 skip/needManual，供上层判定"既不通过也不拒绝"
        if (checkResult.skip) result.skip = true
        if (checkResult.needManual) result.needManual = true
        if (checkResult.manualReason) result.manualReason = checkResult.manualReason
        result.checkSteps.push({ name, result: "不通过", detail: checkResult.reason })
        return result
      }
      logger.info(`${Log_Prefix} [校验通过] ${name}通过`)
      result.checkSteps.push({ name, result: "通过", detail: checkResult.detail || "" })
    }

    logger.info(`${Log_Prefix} [校验完成] 全部${executedChecks.length}项校验通过`)
    result.approve = true
    result.reason = mode === "phone" ? "手机号校验通过" : "全部校验通过"
    result.phoneResult = "通过"
    if (mode !== "phone") {
      result.idResult = "通过"
    }
    return result
  }

  extractInfo(text) {
    let phone = null
    let userId = null

    const phoneIdPattern = /(1[3-9]\d{9})(\d{8})/
    const match = text.match(phoneIdPattern)

    if (match) {
      phone = match[1]
      userId = match[2]
    } else {
      const phone13Pattern = /1[3-9]\d{11}/
      const phone13Match = text.match(phone13Pattern)
      if (phone13Match) {
        phone = phone13Match[0].slice(0, 11)
        const remaining = text.replace(phone13Match[0], "")
        const idMatches = remaining.match(/\d{8}/)
        userId = idMatches ? idMatches[0] : null
      } else {
        const phone11Pattern = /1[3-9]\d{9}/
        const phone11Match = text.match(phone11Pattern)
        if (phone11Match) {
          phone = phone11Match[0]
          const remaining = text.replace(phone, "")
          const idMatches = remaining.match(/\d{8}/)
          userId = idMatches ? idMatches[0] : null
        } else {
          const idMatches = text.match(/\d{8}/)
          userId = idMatches ? idMatches[0] : null
        }
      }
    }

    return { phone, userId }
  }

  async checkRedUser({ qq }) {
    const isRed = DataStore.isRedUser(qq)
    if (isRed) {
      logger.info(`${Log_Prefix} [红用户校验] 用户 ${qq} 是红用户，拒绝入群`)
      return {
        pass: false,
        reason: "您在群内有违规行为，已被永久拉黑，请联系管理员",
        detail: `用户 ${qq} 是红用户`
      }
    }
    logger.info(`${Log_Prefix} [红用户校验] 用户 ${qq} 不是红用户，校验通过`)
    return { pass: true, detail: `用户 ${qq} 非红用户` }
  }

  async checkLeaveUser({ qq }) {
    const leaveUser = DataStore.getLeaveUser(qq)
    if (!leaveUser) {
      logger.info(`${Log_Prefix} [退群用户校验] 用户 ${qq} 不是退群用户，校验通过`)
      return { pass: true, detail: `用户 ${qq} 非退群用户` }
    }

    const policy = leaveUser.policy || "reject"
    logger.info(`${Log_Prefix} [退群用户校验] 用户 ${qq} 是退群用户，当前策略: ${policy}`)

    if (policy === "verify") {
      logger.info(`${Log_Prefix} [退群用户校验] 用户 ${qq} 策略为正常验证，放行`)
      return { pass: true, detail: `退群用户，策略: 正常验证` }
    }

    logger.info(`${Log_Prefix} [退群用户校验] 用户 ${qq} 策略为拒绝，拒绝入群`)
    return {
      pass: false,
      reason: "请添加管理员后重新申请",
      detail: `退群用户，策略: 拒绝`
    }
  }

  async checkBlacklist({ groupId, qq }) {
    const isInBlacklist = DataStore.isInBlacklist(groupId, qq)
    if (isInBlacklist) {
      const expireTime = DataStore.getBlacklistExpireTime(groupId, qq)
      const remainingSeconds = Math.max(0, Math.ceil((expireTime - Date.now()) / 1000))
      const timeStr = this.formatDuration(remainingSeconds)
      logger.info(`${Log_Prefix} [黑名单校验] 用户 ${qq} 在群 ${groupId} 的限时黑名单中，到期时间: ${new Date(expireTime).toLocaleString()}`)
      return {
        pass: false,
        reason: `申请过于频繁，请${timeStr}后再试`,
        detail: `用户 ${qq} 在群 ${groupId} 的限时黑名单中`
      }
    }
    logger.info(`${Log_Prefix} [黑名单校验] 用户 ${qq} 不在群 ${groupId} 的限时黑名单中，校验通过`)
    return { pass: true, detail: `用户 ${qq} 非黑名单` }
  }

  formatDuration(seconds) {
    if (seconds < 60) return `${seconds}秒`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时`
    return `${Math.floor(seconds / 86400)}天`
  }

  async checkApplyCount({ qq, groupId, e }) {
    const threshold = Config.getConfig("config").blacklistThreshold || 10
    const duration = Config.getConfig("config").blacklistDuration || 3600
    const blacklistEnabled = Config.getConfig("config").blacklistEnabled !== false
    
    let count = 0
    if (e?.testMode) {
      count = 0
    } else {
      const oldCount = DataStore.getApplyCount(groupId, qq)
      DataStore.incrementApplyCount(groupId, qq)
      count = DataStore.getApplyCount(groupId, qq)
    }
    
    logger.info(`${Log_Prefix} [次数校验] 用户 ${qq} 在群 ${groupId} 申请次数: ${count} (阈值: ${threshold})`)
    
    if (count >= threshold) {
      const timeStr = this.formatDuration(duration)
      
      if (blacklistEnabled && !e?.testMode) {
        DataStore.addToBlacklist(groupId, qq, duration)
      }
      
      const expireTime = new Date(Date.now() + duration * 1000).toLocaleString()
      logger.info(`${Log_Prefix} [次数校验] 用户 ${qq} 申请次数达到阈值，已加入限时黑名单，到期: ${expireTime}`)
      
      return {
        pass: false,
        reason: `申请过于频繁，请${timeStr}后再试`,
        isBlacklisted: blacklistEnabled,
        detail: `次数: ${count}，阈值: ${threshold}，已达阈值`
      }
    }
    
    return { pass: true, detail: `次数: ${count}，阈值: ${threshold}，${count} < ${threshold}` }
  }

  async checkId({ userId, result }) {
    if (!userId) {
      logger.info(`${Log_Prefix} [ID校验] 用户未填写ID，拒绝入群`)
      result.idResult = "不通过"
      return {
        pass: false,
        reason: "请填写8位数字ID",
        detail: "未填写id"
      }
    }

    if (!/^\d{8}$/.test(userId)) {
      logger.info(`${Log_Prefix} [ID校验] ID ${userId} 格式不正确(需8位数字)，拒绝入群`)
      result.idResult = "不通过"
      return {
        pass: false,
        reason: `ID格式有误，请填8位数字:${userId}`,
        detail: `id格式不正确: ${userId}`
      }
    }

    logger.info(`${Log_Prefix} [ID校验] ID ${userId} 校验通过`)
    result.idResult = "通过"
    return { pass: true, detail: `ID: ${userId}` }
  }

  async checkPhoneValidation({ phone, result }) {
    if (!phone) {
      logger.info(`${Log_Prefix} [手机号校验] 用户未填写手机号，拒绝入群`)
      result.phoneResult = "不通过"
      return {
        pass: false,
        reason: "请填写手机号",
        detail: "未填写手机号"
      }
    }

    if (!/^1[3-9]\d{9}$/.test(phone)) {
      logger.info(`${Log_Prefix} [手机号校验] 手机号 ${phone} 不正确，拒绝入群`)
      result.phoneResult = "不通过"
      return {
        pass: false,
        reason: `手机号格式有误，请检查:${phone}`,
        detail: `手机号格式不正确: ${phone}`
      }
    }

    const virtualPrefix = Config.getConfig("config").virtualNumberPrefix || []
    if (virtualPrefix.some(prefix => phone.startsWith(prefix))) {
      logger.info(`${Log_Prefix} [手机号校验] 手机号 ${phone} 为虚拟运营商号码(前缀匹配)，拒绝入群`)
      result.phoneResult = "不通过"
      return {
        pass: false,
        reason: "不支持虚拟运营商号码",
        detail: `前缀匹配虚拟运营商: ${phone}`
      }
    }

    const apiResult = await ApiManager.queryPhone(phone)
    
    if (!apiResult.success) {
      // API 全部不可用：不拒绝也不通过，转人工验证。
      // 此前这里直接拒绝，API 抖动会把正常用户挡在外面（历史已误拒 400+ 人）。
      logger.warn(`${Log_Prefix} [手机号校验] API全部不可用，转人工验证，跳过本条申请`)
      result.phoneResult = "待人工"
      result.needManual = true
      result.manualReason = "API异常"
      await Notification.sendApiFailureNotice(result, phone)
      return { pass: false, skip: true, reason: "API异常，转人工验证" }
    }

    if (apiResult.location) {
      result.location = apiResult.location
    }

    if (apiResult.virtual) {
      logger.info(`${Log_Prefix} [手机号校验] 手机号 ${phone} 通过API查询确认为虚拟运营商号码，拒绝入群`)
      result.phoneResult = "不通过"
      return {
        pass: false,
        reason: "不支持虚拟运营商号码",
        detail: `API确认虚拟运营商: ${phone}`
      }
    }

    const locationStr = apiResult.location ? `${apiResult.location.province}${apiResult.location.city}${apiResult.location.district}` : "未知"
    logger.info(`${Log_Prefix} [手机号校验] 手机号 ${phone} 校验通过，非虚拟运营商号码，归属地: ${locationStr}`)
    result.phoneResult = "通过"
    return { 
      pass: true, 
      detail: `非虚拟号码，来自${locationStr}`
    }
  }

  async checkPhoneBinding({ phone, qq, result }) {
    if (!phone) {
      logger.info(`${Log_Prefix} [绑定校验] 未填写手机号，跳过绑定校验`)
      return { pass: true, detail: "未填写手机号，跳过" }
    }

    const binding = DataStore.getBindingByPhone(phone)
    if (binding && binding.qq !== qq) {
      logger.info(`${Log_Prefix} [绑定校验] 手机号 ${phone} 已绑定其他QQ(${binding.qq})，拒绝入群`)
      result.phoneResult = "不通过"
      return {
        pass: false,
        reason: "该手机号已被其他账号绑定",
        detail: `手机号 ${phone} 已绑定其他QQ(${binding.qq})`
      }
    }

    if (binding && binding.qq === qq) {
      logger.info(`${Log_Prefix} [绑定校验] 手机号 ${phone} 已绑定当前QQ(${qq})，校验通过`)
      return { pass: true, detail: `手机号 ${phone} 已绑定当前QQ` }
    } else {
      logger.info(`${Log_Prefix} [绑定校验] 手机号 ${phone} 未绑定任何QQ，校验通过`)
      return { pass: true, detail: `手机号 ${phone} 未绑定任何QQ` }
    }
  }
}

export default new VerifyPipeline()
