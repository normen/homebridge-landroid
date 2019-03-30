var Service, Characteristic;
var LandroidCloud = require('iobroker.landroid-s/lib/mqttCloud')
var LandroidDataset = require("./LandroidDataset");

function LandroidPlatform(log, config) {
    var self = this;
    self.config = config;
    self.log = log;
}
LandroidPlatform.prototype.accessories = function(callback) {
    var self = this;
    self.accessories = [];
    self.config.landroids.forEach(function(mower) {
        self.accessories.push(new LandroidAccessory(mower, self.log));
    });
    callback(self.accessories);
}

function LandroidAccessory(config, log) {
    let self = this;
    self.log = log;
    self.config = config;
    self.name = config.name;
    self.config.enable = true;

    self.landroidAdapter = {"log": new LandroidLogger(log),
                            "config": config};

    self.dataset = new LandroidDataset();
    self.dataset.batteryLevel = 0;
    self.dataset.statusCode = 0;
    self.dataset.errorCode = 0;

    self.service = new Service.Switch(self.name);

    self.service.getCharacteristic(Characteristic.On).on('get', self.getOn.bind(self));
    self.service.getCharacteristic(Characteristic.On).on('set', self.setOn.bind(self));

    self.service.getCharacteristic(Characteristic.BatteryLevel).on('get', self.getBatteryLevel.bind(self));
    self.service.getCharacteristic(Characteristic.StatusLowBattery).on('get', this.getStatusLowBattery.bind(self));
    self.service.getCharacteristic(Characteristic.StatusFault).on('get', this.getStatusFault.bind(self));

    self.landroidCloud = new LandroidCloud(self.landroidAdapter);
    self.landroidCloud.init(self.landroidUpdate.bind(self));
}
LandroidAccessory.prototype.getServices = function() {
    var self = this;
    var services = [];

    var service = new Service.AccessoryInformation();
    service.setCharacteristic(Characteristic.Name, self.name)
    .setCharacteristic(Characteristic.Manufacturer, 'Worx')
    .setCharacteristic(Characteristic.Model, 'Landroid')
    .setCharacteristic(Characteristic.SerialNumber, 'xxx')
    .setCharacteristic(Characteristic.FirmwareRevision, process.env.version)
    .setCharacteristic(Characteristic.HardwareRevision, '1.0.0');
    services.push(service);

    services.push(self.service);
    return services;
}
LandroidAccessory.prototype.landroidUpdate = function(data) {
  if(data != null && data != undefined){
    var newDataset = new LandroidDataset(data);
    //TODO: compare, update
    this.dataset = newDataset;
    //this.log(this.dataset);
  }
}
LandroidAccessory.prototype.getStatusLowBattery = function(callback) {
  callback(null, 0);
}
LandroidAccessory.prototype.getStatusFault = function(callback) {
  callback(null, this.dataset.errorCode);
}
LandroidAccessory.prototype.getBatteryLevel = function(callback) {
  callback(null, this.dataset.batteryLevel);
}
LandroidAccessory.prototype.getOn = function(callback) {
  let c = this.dataset.statusCode
  if(c == 2 || c == 3 || c == 4 || c == 5 || c == 6 || c == 7 || c == 30 || c == 32 || c == 33){
    callback(null, 1);
  }else{
    callback(null, 0);
  }
}
LandroidAccessory.prototype.setOn = function(state, callback) {
  if(state){
    self.sendMessage(1);
  }else{
    self.sendMessage(3);
  }
  callback(null);
}
LandroidAccessory.prototype.sendMessage = function(cmd, params) {
    let message = {};
    if (cmd) {
        message["cmd"] = cmd;
    }
    if (params) {
        message = Object.assign(message, params);
    }
    let outMsg = JSON.stringify(message);
    this.log("Sending to landroid cloud: " + outMsg);
    this.landroidCloud.sendMessage(outMsg);
}

function LandroidLogger(log){
  let that = this;
  this.log = log;
  this.logMsg = function(msg){
    that.log(msg);
  }
  this.noLogMsg = function(msg){
  }
  this.trace = this.noLogMsg;
  this.debug = this.noLogMsg;
  this.info = this.noLogMsg;
  this.warn = this.logMsg;
  this.error = this.logMsg;
  this.fatal = this.logMsg;
}

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerPlatform("homebridge-landroid", "Landroid", LandroidPlatform);
}
