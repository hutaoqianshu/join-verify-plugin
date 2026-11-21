import { Config } from "./components/index.js"

/**
 * 锅巴面板配置支持
 * 锅巴插件：https://gitee.com/guoba-yunzai/guoba-plugin
 * 组件类型参考：https://vvbin.cn/doc-next/components/introduction.html
 */
export function supportGuoba() {
  return {
    pluginInfo: {
      name: "join-verify-plugin",
      title: "入群验证",
      author: "@join-verify",
      link: "https://github.com/",
      isV3: true,
      isV2: true,
      description: "手机号 + 游戏ID 双重校验的入群审核插件，支持红名单、限时黑名单、退群管控与群管清退",
      icon: "mdi:shield-account",
      iconColor: "#4CAF50"
    },
    configInfo: {
      schemas: [
        {
          field: "notificationGroup",
          label: "通知群号",
          bottomHelpMessage: "审核通过/拒绝/转人工的通知推送目标群，留空则不推送",
          component: "Input",
          componentProps: { placeholder: "请输入通知群号" }
        },
        {
          field: "blacklistEnabled",
          label: "自动拉黑",
          bottomHelpMessage: "是否在申请次数达到阈值时自动加入限时黑名单",
          component: "Switch"
        },
        {
          field: "blacklistThreshold",
          label: "拉黑阈值",
          bottomHelpMessage: "同一用户达到多少次申请后触发拉黑",
          component: "InputNumber",
          componentProps: { min: 1, max: 100 }
        },
        {
          field: "blacklistDuration",
          label: "拉黑时长(秒)",
          bottomHelpMessage: "限时黑名单的持续时间，3600 表示 1 小时",
          component: "InputNumber",
          componentProps: { min: 60, max: 2592000 }
        },
        {
          field: "apiCheckInterval",
          label: "API巡检间隔(秒)",
          bottomHelpMessage: "定期检测手机号查询接口可用性的间隔",
          component: "InputNumber",
          componentProps: { min: 60, max: 86400 }
        },
        {
          field: "virtualNumberPrefix",
          label: "虚拟运营商号段",
          bottomHelpMessage: "这些前缀开头的手机号将被判定为虚拟号并拒绝，留空则仅依赖 API 判定",
          component: "Select",
          componentProps: {
            mode: "tags",
            placeholder: "输入号段后回车，如 170"
          }
        },
        {
          field: "diversionEnabled",
          label: "启用导流",
          bottomHelpMessage: "群满拒绝时是否附带引导加其他群的信息",
          component: "Switch"
        },
        {
          field: "diversionIndex",
          label: "导流群序号",
          bottomHelpMessage: "引导文案中的第几群，如 7 会显示为「请加7群」",
          component: "Input",
          componentProps: { placeholder: "如 7" }
        },
        {
          field: "diversionGroupId",
          label: "导流群号",
          bottomHelpMessage: "引导加入的实际群号",
          component: "Input",
          componentProps: { placeholder: "请输入导流目标群号" }
        },
        {
          field: "diversionText",
          label: "导流文案模板",
          bottomHelpMessage: "支持 {index} 与 {groupId} 占位符，一般无需修改",
          component: "InputTextArea",
          componentProps: { rows: 2 }
        }
      ],

      /** 前端加载时填充当前配置 */
      getConfigData() {
        return Config.getConfig("config") || {}
      },

      /** 前端保存时写回配置 */
      setConfigData(data, { Result }) {
        for (const [keyPath, value] of Object.entries(data)) {
          Config.modify("config", keyPath, value)
        }
        return Result.ok({}, "保存成功~")
      }
    }
  }
}
