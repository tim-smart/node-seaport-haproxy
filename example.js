var proxy   = require('./')
var mpath   = require('path')

var seaport = require('seaport')
var Haproxy = require('haproxy')

var ports   = seaport.connect('127.0.0.1', 9090)
var haproxy = new Haproxy(
  '/var/run/haproxy.socket'
, { config : mpath.resolve('haproxy.cfg')
  }
)

var service = proxy.createService(
  ports
, haproxy
, { template : mpath.resolve('haproxy.cfg.ejs')
  }
)

service.on('error', function (err) {
  console.error('[error]', err)
  process.emit('SIGINT')
})

service.on('haproxy:reload', function () {
  console.error('[reload]')
})

process.on('SIGINT', function () {
  haproxy.stop(function () {
    process.exit()
  })
})
