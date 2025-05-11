import { EventEmitter } from 'node:events'
import { app } from 'electron'
import is from 'electron-is'
import { parse } from 'querystring'

import logger from './Logger'
import protocolMap from '../configs/protocol'
import { ADD_TASK_TYPE } from '@shared/constants'

export default class ProtocolManager extends EventEmitter {
  constructor (options = {}) {
    super()
    this.options = options

    // package.json:build.protocols[].schemes[]
    // options.protocols: { 'magnet': true, 'thunder': false }
    this.protocols = {
      mo: true,
      motrix: true,
      ...options.protocols
    }

    this.init()
  }

  init () {
    const { protocols } = this
    this.setup(protocols)
  }

  setup (protocols = {}) {
    if (is.dev() || is.mas()) {
      return
    }

    Object.keys(protocols).forEach((protocol) => {
      const enabled = protocols[protocol]
      if (enabled) {
        if (!app.isDefaultProtocolClient(protocol)) {
          app.setAsDefaultProtocolClient(protocol)
        }
      } else {
        app.removeAsDefaultProtocolClient(protocol)
      }
    })
  }

  handle (url) {
    logger.info(`[Motrix] protocol url: ${url}`)

    if (
      url.toLowerCase().startsWith('ftp:') ||
      url.toLowerCase().startsWith('http:') ||
      url.toLowerCase().startsWith('https:') ||
      url.toLowerCase().startsWith('magnet:') ||
      url.toLowerCase().startsWith('thunder:')
    ) {
      return this.handleResourceProtocol(url)
    }

    if (
      url.toLowerCase().startsWith('mo:') ||
      url.toLowerCase().startsWith('motrix:')
    ) {
      return this.handleMoProtocol(url)
    }
  }

  handleResourceProtocol (url) {
    if (!url) {
      return
    }

    global.application.sendCommandToAll('application:new-task', {
      type: ADD_TASK_TYPE.URI,
      uri: url
    })
  }

  handleMoProtocol (url) {
    const parsed = new URL(url)
    const { host, search, pathname } = parsed
    logger.info('[Motrix] protocol parsed:', parsed, host)

    const command = protocolMap[host]
    if (!command) {
      return
    }

    const query = search.startsWith('?') ? search.replace('?', '') : search
    const args = parse(query)

    // 处理新增的深度链接命令
    switch (host) {
      case 'download':
        args.type = ADD_TASK_TYPE.URI
        args.uri = args.url || pathname
        // 支持更多下载参数
        if (args.out) args.name = args.out // 支持文件名
        if (args.dir) args.path = args.dir // 支持下载路径
        if (args.ua) args.userAgent = args.ua // 支持自定义UA
        if (args.header) { // 支持自定义请求头
          try {
            args.headers = typeof args.header === 'string' 
              ? JSON.parse(args.header) 
              : args.header
          } catch (err) {
            logger.warn('[Motrix] parse headers error:', err)
          }
        }
        if (args.cookie) args.cookies = args.cookie // 支持Cookie
        if (args.referer) args.referer = args.referer // 支持Referer
        if (args.proxy) args.proxy = args.proxy // 支持代理
        if (args.split) args.split = parseInt(args.split) // 支持分片数
        break
      case 'magnet':
      case 'torrent':
        args.type = ADD_TASK_TYPE.TORRENT
        args.uri = args.url || pathname
        // 支持BT下载参数
        if (args.out) args.name = args.out
        if (args.dir) args.path = args.dir
        if (args.selectfile) { // 选择下载文件
          try {
            args.selectedFiles = typeof args.selectfile === 'string'
              ? args.selectfile.split(',').map(Number)
              : args.selectfile
          } catch (err) {
            logger.warn('[Motrix] parse selected files error:', err)
          }
        }
        break
      case 'pause':
      case 'resume':
      case 'remove':
        args.gid = args.gid || pathname.replace('/', '')
        // 删除任务时支持是否删除文件
        if (host === 'remove' && args.withfile) {
          args.deleteFile = args.withfile === 'true'
        }
        break
      case 'search':
        args.keyword = args.keyword || pathname.replace('/', '')
        break
    }

    global.application.sendCommandToAll(command, args)
  }
}
