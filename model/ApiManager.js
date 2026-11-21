import fetch from "node-fetch"
import schedule from "node-schedule"
import { DataStore, Config, Log_Prefix } from "#join-verify.components"

class ApiManager {
  constructor() {
    this.initSchedule()
  }

  initSchedule() {
    const interval = Config.getConfig("config").apiCheckInterval || 600
    schedule.scheduleJob(`*/${interval} * * * *`, async () => {
      logger.info(`${Log_Prefix} [定时巡检] 开始执行API巡检任务`)
      await this.checkAllApis()
    })
    logger.info(`${Log_Prefix} [初始化] API巡检任务已启动，间隔${interval}秒`)
  }

  async testApi(url) {
    const startTime = Date.now()
    logger.debug(`${Log_Prefix} [API测试] 测试接口: ${url}`)
    try {
      const response = await fetch(url, {
        method: "GET",
        timeout: 5000,
        headers: {
          "Content-Type": "application/json"
        }
      })
      const latency = Date.now() - startTime
      const data = await response.json()
      
      if (response.ok && data && typeof data === "object") {
        logger.info(`${Log_Prefix} [API测试] 接口 ${url} 测试通过，延迟: ${latency}ms`)
        return { success: true, latency, data }
      }
      logger.warn(`${Log_Prefix} [API测试] 接口 ${url} 返回格式异常，延迟: ${latency}ms`)
      return { success: false, latency, error: "返回格式异常" }
    } catch (error) {
      const latency = Date.now() - startTime
      logger.warn(`${Log_Prefix} [API测试] 接口 ${url} 测试失败，延迟: ${latency}ms，错误: ${error.message}`)
      return { success: false, latency, error: error.message }
    }
  }

  async addApi(url) {
    logger.info(`${Log_Prefix} [API管理] 开始验证并增加API: ${url}`)
    const result = await this.testApi(url)
    if (result.success) {
      DataStore.addApi(url, result.latency, true)
      logger.info(`${Log_Prefix} [API管理] API验证成功，已增加至接口列表: ${url}`)
      return { success: true, message: "API验证成功，已增加至接口列表" }
    }
    logger.warn(`${Log_Prefix} [API管理] API验证失败，未增加: ${url}，原因: ${result.error}`)
    return { success: false, message: `API无法正常访问/返回格式异常，增加失败：${result.error}` }
  }

  async removeApi(url) {
    logger.info(`${Log_Prefix} [API管理] 删除API: ${url}`)
    const success = DataStore.removeApi(url)
    if (success) {
      logger.info(`${Log_Prefix} [API管理] API删除成功: ${url}`)
    } else {
      logger.warn(`${Log_Prefix} [API管理] API删除失败，不存在: ${url}`)
    }
    return success
  }

  async checkAllApis() {
    const apiList = DataStore.getApiList()
    const results = []

    logger.info(`${Log_Prefix} [API巡检] 开始巡检，共${apiList.length}个接口`)

    for (const api of apiList) {
      const result = await this.testApi(api.url)
      DataStore.updateApi(api.url, {
        latency: result.latency,
        available: result.success
      })
      results.push({
        url: api.url,
        available: result.success,
        latency: result.latency
      })
    }

    await this.sendCheckResult(results)
    
    const availableCount = results.filter(r => r.available).length
    logger.info(`${Log_Prefix} [API巡检] 巡检完成，可用: ${availableCount}/${apiList.length}`)
    
    return results
  }

  async sendCheckResult(results) {
    const notificationGroup = Config.getConfig("config").notificationGroup
    if (!notificationGroup) {
      logger.debug(`${Log_Prefix} [API巡检] 未设置通知群，跳过推送`)
      return
    }

    const availableCount = results.filter(r => r.available).length
    const totalCount = results.length

    let msg = `API巡检结果\n\n`
    msg += `总接口数：${totalCount}\n`
    msg += `可用接口：${availableCount}\n`
    msg += `不可用接口：${totalCount - availableCount}\n\n`
    
    results.forEach(result => {
      msg += `${result.available ? "可用" : "不可用"} ${result.url}\n`
      msg += `   延迟：${result.latency}ms\n`
    })

    try {
      await Bot.pickGroup(notificationGroup).sendMsg(msg)
      logger.info(`${Log_Prefix} [API巡检] 巡检结果已推送至通知群 ${notificationGroup}`)
    } catch (e) {
      logger.error(`${Log_Prefix} [API巡检] 发送巡检结果失败:`, e)
    }
  }

  async queryPhone(phone) {
    const fastestApi = DataStore.getFastestApi()
    
    if (!fastestApi) {
      logger.warn(`${Log_Prefix} [手机号查询] 无可用API接口，查询失败`)
      return { success: false, virtual: false, error: "所有API接口均不可用" }
    }

    logger.info(`${Log_Prefix} [手机号查询] 使用最快接口查询: ${fastestApi.url}，手机号: ${phone}`)

    try {
      const url = fastestApi.url.replace("{phone}", phone)
      const response = await fetch(url, {
        method: "GET",
        timeout: 10000
      })
      const data = await response.json()
      
      const locationInfo = this.extractLocation(data)
      const isVirtual = this.isVirtualNumber(data, phone)
      logger.info(`${Log_Prefix} [手机号查询] 查询完成，手机号: ${phone}，归属地: ${locationInfo.full}，是否虚拟号: ${isVirtual}`)
      
      return {
        success: true,
        virtual: isVirtual,
        data,
        location: locationInfo
      }
    } catch (error) {
      logger.error(`${Log_Prefix} [手机号查询] 查询失败，接口: ${fastestApi.url}，错误: ${error.message}`)
      DataStore.updateApi(fastestApi.url, { available: false })
      return this.queryPhone(phone)
    }
  }

  extractLocation(data) {
    let province = ""
    let city = ""
    let district = ""
    let carrier = ""

    if (!data || typeof data !== "object") {
      return { province, city, district, carrier, full: "未知" }
    }

    const resultData = data.data || data

    if (resultData.location) {
      const parts = resultData.location.split(" ")
      if (parts.length >= 1) province = parts[0]
      if (parts.length >= 2) city = parts[1]
      if (parts.length >= 3) {
        const lastPart = parts[parts.length - 1]
        if (!["移动", "联通", "电信", "铁通", "卫通", "广电"].includes(lastPart)) {
          district = lastPart
        } else {
          carrier = lastPart
          if (parts.length >= 4) district = parts[2]
        }
      }
    } else if (resultData.province) {
      province = resultData.province
      city = resultData.city || ""
      district = resultData.district || resultData.county || ""
      carrier = resultData.sp || resultData.carrier || ""
    }

    if (!carrier && resultData.sp) carrier = resultData.sp
    if (!carrier && resultData.carrier) carrier = resultData.carrier

    let full = ""
    if (province) full += province
    if (city && city !== province) full += city
    if (district && district !== city && district !== province) full += district
    if (!full) full = "未知"

    return { province, city, district, carrier, full }
  }

  isVirtualNumber(data, phone) {
    const virtualPrefix = Config.getConfig("config").virtualNumberPrefix || []
    
    if (virtualPrefix.some(prefix => phone.startsWith(prefix))) {
      logger.debug(`${Log_Prefix} [虚拟号判断] 手机号 ${phone} 前缀匹配虚拟运营商`)
      return true
    }

    if (!data || typeof data !== "object") {
      return false
    }

    const resultData = data.data || data

    if (resultData.virtual === true || resultData.isVirtual === true) {
      logger.debug(`${Log_Prefix} [虚拟号判断] 手机号 ${phone} API返回标记为虚拟号`)
      return true
    }
    if (resultData.carrier && 
        (resultData.carrier.includes("虚拟") || 
         resultData.carrier.includes("MVNO") || 
         resultData.carrier.includes("虚拟运营商"))) {
      logger.debug(`${Log_Prefix} [虚拟号判断] 手机号 ${phone} 运营商为虚拟运营商: ${resultData.carrier}`)
      return true
    }
    if (resultData.type && 
        (resultData.type.includes("虚拟") || 
         resultData.type.includes("副卡"))) {
      logger.debug(`${Log_Prefix} [虚拟号判断] 手机号 ${phone} 类型为虚拟号: ${resultData.type}`)
      return true
    }

    return false
  }

  getApiList() {
    return DataStore.getApiList()
  }
}

export default new ApiManager()
