var Service, Characteristic;
var LandroidCloud = require('iobroker.landroid-s/lib/mqttCloud');
var LandroidDataset = require("./LandroidDataset");

function LandroidPlatform(log, config) {
    this.config = config;
    this.log = log;
}
LandroidPlatform.prototype.accessories = function(callback) {
    var self = this;
    this.accessories = [];
    this.config.landroids.forEach(function(mower) {
        self.accessories.push(new LandroidAccessory(mower, self.log));
    });
    callback(this.accessories);
}

function LandroidAccessory(config, log) {
    this.log = log;
    this.config = config;
    this.name = config.name;
    this.config.enable = true;
    this.firstUpdate = false;

    this.landroidAdapter = {"log": new LandroidLogger(log),
                            "config": config,
                            "setState": function(id,val,ack){}};

    this.dataset = new LandroidDataset();
    this.dataset.batteryLevel = 0;
    this.dataset.batteryCharging = false;
    this.dataset.statusCode = 0;
    this.dataset.errorCode = 0;

    this.service = new Service.Switch(this.name);
    this.service.getCharacteristic(Characteristic.On).on('get', this.getOn.bind(this));
    this.service.getCharacteristic(Characteristic.On).on('set', this.setOn.bind(this));

    this.batteryService = new Service.BatteryService();
    this.batteryService.getCharacteristic(Characteristic.BatteryLevel).on('get', this.getBatteryLevel.bind(this));
    this.batteryService.getCharacteristic(Characteristic.StatusLowBattery).on('get', this.getStatusLowBattery.bind(this));
    this.batteryService.getCharacteristic(Characteristic.ChargingState).on('get', this.getChargingState.bind(this));

    this.contactService = new Service.ContactSensor(this.name+" Issue");
    this.contactService.getCharacteristic(Characteristic.ContactSensorState).on('get', this.getContactSensorState.bind(this));

    this.landroidCloud = new LandroidCloud(this.landroidAdapter);
    this.landroidCloud.init(this.landroidUpdate.bind(this));
}

LandroidAccessory.prototype.getServices = function() {
    var services = [];

    this.infoService = new Service.AccessoryInformation();
    this.infoService.setCharacteristic(Characteristic.Name, this.name)
    .setCharacteristic(Characteristic.Manufacturer, 'Worx')
    .setCharacteristic(Characteristic.Model, 'Landroid')
    .setCharacteristic(Characteristic.SerialNumber, 'xxx')
    .setCharacteristic(Characteristic.FirmwareRevision, process.env.version)
    .setCharacteristic(Characteristic.HardwareRevision, '1.0.0');

    services.push(this.infoService);
    services.push(this.service);
    services.push(this.batteryService);
    services.push(this.contactService);
    return services;
}
LandroidAccessory.prototype.landroidUpdate = function(data) {
  if(data != null && data != undefined){
    let oldDataset = this.dataset;
    this.dataset = new LandroidDataset(data);
    if(this.dataset.batteryLevel != oldDataset.batteryLevel){
      this.log(this.name + " battery level changed to " + this.dataset.batteryLevel);
      this.batteryService.getCharacteristic(Characteristic.BatteryLevel).updateValue(this.dataset.batteryLevel);
    }
    if(this.dataset.batteryCharging != oldDataset.batteryCharging){
      this.log(this.name + " charging status changed to " + this.dataset.batteryCharging);
      this.batteryService.getCharacteristic(Characteristic.ChargingState).updateValue(this.dataset.batteryCharging?Characteristic.ChargingState.CHARGING:Characteristic.ChargingState.NOT_CHARGING);
    }
    if(this.dataset.statusCode != oldDataset.statusCode){
      this.log(this.name + " status changed to " + this.dataset.statusCode + " (" + this.dataset.statusDescription + ")");
      if(isOn(this.dataset.statusCode)){
        this.service.getCharacteristic(Characteristic.On).updateValue(true);
      }else{
        this.service.getCharacteristic(Characteristic.On).updateValue(false);
      }
    }
    if(this.dataset.errorCode != oldDataset.errorCode){
      this.log(this.name + " error code changed to " + this.dataset.errorCode + " (" + this.dataset.errorDescription + ")");
      this.contactService.getCharacteristic(Characteristic.ContactSensorState).updateValue(this.dataset.errorCode != 0?Characteristic.ContactSensorState.CONTACT_NOT_DETECTED:Characteristic.ContactSensorState.CONTACT_DETECTED);
    }
  }
  if(!this.firstUpdate){
    this.firstUpdate = true;
  }
}
LandroidAccessory.prototype.getContactSensorState = function(callback) {
  callback(null,  this.dataset.errorCode != 0?Characteristic.ContactSensorState.CONTACT_NOT_DETECTED:Characteristic.ContactSensorState.CONTACT_DETECTED);
}
LandroidAccessory.prototype.getBatteryLevel = function(callback) {
  callback(null, this.dataset.batteryLevel);
}
LandroidAccessory.prototype.getChargingState = function(callback) {
  callback(null, this.dataset.batteryCharging?Characteristic.ChargingState.CHARGING:Characteristic.ChargingState.NOT_CHARGING);
}
LandroidAccessory.prototype.getStatusLowBattery = function(callback) {
  callback(null, this.dataset.errorCode == 12?Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW:Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
}
LandroidAccessory.prototype.getOn = function(callback) {
  if(isOn(this.dataset.statusCode)){
    callback(null, true);
  }else{
    callback(null, false);
  }
}
LandroidAccessory.prototype.setOn = function(state, callback) {
  if(state){
    this.sendMessage(1);
  }else{
    this.sendMessage(3);
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

function isOn(c){
  if(c == 2 || c == 3 || c == 4 || c == 6 || c == 7 || c == 32 || c == 33){
    return true;
  }else{
    return false;
  }
}

function isError(c){
  //no error and rain delay is "not an error"
  if(c == 0 || c == 5){
    return false;
  }else{
    return true;
  }
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
  this.info = this.logMsg;
  this.warn = this.logMsg;
  this.error = this.logMsg;
  this.fatal = this.logMsg;
}

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerPlatform("homebridge-landroid", "Landroid", LandroidPlatform);
}
