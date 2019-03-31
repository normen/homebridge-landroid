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
    self.firstUpdate = false;

    self.landroidAdapter = {"log": new LandroidLogger(log),
                            "config": config,
                            "setState": function(id,val,ack){}};

    self.dataset = new LandroidDataset();
    self.dataset.batteryLevel = 0;
    self.dataset.batteryCharging = false;
    self.dataset.statusCode = 0;
    self.dataset.errorCode = 0;

    self.service = new Service.Switch(self.name);

    self.service.getCharacteristic(Characteristic.On).on('get', self.getOn.bind(self));
    self.service.getCharacteristic(Characteristic.On).on('set', self.setOn.bind(self));


    self.batteryService = new Service.BatteryService();
    self.batteryService.getCharacteristic(Characteristic.BatteryLevel).on('get', self.getBatteryLevel.bind(self));
    self.batteryService.getCharacteristic(Characteristic.StatusLowBattery).on('get', this.getStatusLowBattery.bind(self));
    self.batteryService.getCharacteristic(Characteristic.ChargingState).on('get', this.getChargingState.bind(self));

    self.contactService = new Service.ContactSensor(self.name+" Issue");
    self.contactService.getCharacteristic(Characteristic.ContactSensorState).on('get', self.getContactSensorState.bind(self));

    self.landroidCloud = new LandroidCloud(self.landroidAdapter);
    self.landroidCloud.init(self.landroidUpdate.bind(self));
}

LandroidAccessory.prototype.getServices = function() {
    var self = this;
    var services = [];

    self.infoService = new Service.AccessoryInformation();
    self.infoService.setCharacteristic(Characteristic.Name, self.name)
    .setCharacteristic(Characteristic.Manufacturer, 'Worx')
    .setCharacteristic(Characteristic.Model, 'Landroid')
    .setCharacteristic(Characteristic.SerialNumber, 'xxx')
    .setCharacteristic(Characteristic.FirmwareRevision, process.env.version)
    .setCharacteristic(Characteristic.HardwareRevision, '1.0.0');

    services.push(self.infoService);
    services.push(self.service);
    services.push(self.batteryService);
    services.push(self.contactService);
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
      if(isOn(oldDataset.statusCode)){
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
  callback(null,  this.dataset.errorCode != 0?Characteristic.StatusFault.CONTACT_NOT_DETECTED:Characteristic.StatusFault.CONTACT_DETECTED);
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
  if(c == 2 || c == 3 || c == 4 || c == 5 || c == 6 || c == 7 || c == 32 || c == 33){
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
