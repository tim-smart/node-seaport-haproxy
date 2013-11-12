var Emitter = require('events').EventEmitter
var ejs     = require('ejs')
var mfs     = require('fs')

/**
 * SeaportHaproxySyncService
 *
 * Syncs seaport with haproxy by auto-managing backends.
 *
 * @contructor
 * @extends       events.EventEmitter
 * @param Seaport seaport
 * @param Haproxy haproxy
 * @param Object  config
 */
function SeaportHaproxySyncService (seaport, haproxy, config) {
  var sh           = this

  this.seaport     = seaport
  this.haproxy     = haproxy

  this.maxconn     = config.maxconn || 65536
  this.template    = ejs.compile(
    mfs.readFileSync(config.template).toString()
  )
  this.destination = haproxy.cfg

  // Internal variables
  this._reloading  = false

  this.seaport.on('register', function (service) {
    sh.emit('seaport:register', service)
    sh.emit('seaport:change', service)
  })
  this.seaport.on('free', function (service) {
    sh.emit('seaport:free', service)
    sh.emit('seaport:change', service)
  })
  this.seaport.on('stale', function (service) {
    sh.emit('seaport:stale', service)
    sh.emit('seaport:change', service)
  })

  sh.on('seaport:change', this.onSeaportChange)

  this.seaport.once('synced', function () {
    sh.emit('seaport:change')
  })
}

// exports
exports.SeaportHaproxySyncService = SeaportHaproxySyncService
exports.createService = function createService (seaport, haproxy, config) {
  return (new SeaportHaproxySyncService(seaport, haproxy, config))
}

// @extends events.EventEmitter
var p                               = SeaportHaproxySyncService.prototype
SeaportHaproxySyncService.__proto__ = Emitter
p.__proto__                         = Emitter.prototype

/**
 * onSeaportChange
 *
 * The seaport registry has changes. Re-generate and re-load the configuration
 * for haproxy.
 */
p.onSeaportChange = function onSeaportChange () {
  var sh = this

  if (this._reloading) return
  this._reloading = true

  var services = this.seaport.query(null)

  var hosts   = Object.create(null)
  var roles   = Object.create(null)
  var service = null

  for (var i = 0, il = services.length; i < il; i++) {
    service = services[i]
    hosts[service.host + ':' + service.port] = true
    roles[service.role] || (roles[service.role] = [])
    roles[service.role].push(service)
  }

  var cfg = sh.template(
    { maxconn : Math.floor(sh.maxconn / Object.keys(hosts).length)
    , roles   : roles
    }
  )

  mfs.writeFile(sh.destination, cfg, doneConfig)

  function doneConfig (err) {
    if (err) return sh.emit('error', err)
    sh.reloadHaproxy(reloaded)
  }

  function reloaded (err) {
    if (err) return sh.emit('error', err)
    sh.emit('haproxy:reload')
    sh._reloading = false
  }
}

/**
 * reloadHaproxy
 *
 * Ensure haproxy is started, otherwise reload
 */
p.reloadHaproxy = function reloadHaproxy (done) {
  var sh = this

  sh.haproxy.running(runningCheck)

  function runningCheck (err, running) {
    if (err) return done(err)
    else if (!running) return sh.haproxy.start(started)

    started(null, true)
  }

  function started (err, reload) {
    if (err) return done(err)
    else if (reload) return sh.haproxy.reload(reloaded)
    done()
  }

  function reloaded (err) {
    if (err) return done(err)
    done()
  }
}
