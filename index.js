var Service, Characteristic;
var LandroidCloud = require('iobroker.worx/lib/api');
var LandroidDataset = require('./LandroidDataset');

function LandroidPlatform(log, config) {
    this.config = config;
    this.log = log;
    this.debug = config.debug || false;
    if(!config.email || !config.pwd){
      this.log("WARNING: No account configured, please set email and password of your Worx account in config.json!");
      // Fallback: get config from first landroid (old config file)
      if(config.landroids && config.landroids[0]){
        if(config.landroids[0].email){
          this.log("WARNING: Per-Landroid email/pass is not supported anymore.");
          this.log("WARNING: Please update your config.json to use a global email and password in the Landroid platform.");
          this.log("WARNING: The login data of the first Landroid will be used for the global login for now.");
          config.email = config.landroids[0].email;
          config.pwd = config.landroids[0].pwd;
        }else{
          return;
        }
      }else{
        return;
      }
    }

    this.landroidAdapter = {"log": new LandroidLogger(log)};
    this.landroidCloud = new LandroidCloud(config.email, config.pwd, this.landroidAdapter);
    this.landroidCloud.on("mqtt", this.landroidUpdate.bind(this));
    this.landroidCloud.on("found", this.landroidFound.bind(this));
    this.landroidCloud.on("error", error => {log(error)} );
    //this.landroidCloud.on("online", online => {console.log(online)} );
    //this.landroidCloud.on("offline", offline => {console.log(offline)} );
    this.landroidCloud.on("connect", connect => {log("Connected to WORX cloud.")} );
}
LandroidPlatform.prototype.accessories = function(callback) {
    var self = this;
    this.accessories = [];
    this.config.landroids.forEach(mowerConfig=>{
        self.accessories.push(new LandroidAccessory(self.log, self.landroidCloud, mowerConfig));
    });
    callback(this.accessories);
}
LandroidPlatform.prototype.landroidFound = function(mower, data) {
  if(this.debug && mower && mower.raw) {
    this.log("[DEBUG] MOWER: " + JSON.stringify(mower.raw));
  }
  this.landroidUpdate(mower,data);
}

LandroidPlatform.prototype.landroidUpdate = function(mower, data) {
    if(this.debug && data) {
      this.log("[DEBUG] DATA: " + JSON.stringify(data));
    }
    this.accessories.forEach(accessory=>{
        accessory.landroidUpdate(mower, data);
    });
}

function LandroidAccessory(log, cloud, config) {
    this.landroidCloud = cloud;
    this.log = log;
    this.config = config;
    this.name = config.name;
    this.config.enable = true;
    this.firstUpdate = false;
    this.serial = null;

    // Fallback for old config file
    if(this.config.dev_sel !== undefined){
      this.config.dev_name = ""+(this.config.dev_sel+1);
      this.log("WARNING: dev_sel parameter not supported anymore, use dev_name (usually dev_sel + 1)");
      this.log("WARNING: Automatically creating name \"" + this.config.dev_name + "\" for mower");
    }
    this.config.dev_name = this.config.dev_name || "1";

    this.dataset = {};
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

    /*this.leakService = new Service.LeakSensor(this.name);
    this.leakService.getCharacteristic(Characteristic.LeakDetected).value = false;
    this.leakService.getCharacteristic(Characteristic.LeakDetected).on('get', this.getLeak.bind(this));*/
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
    //services.push(this.leakService);
    return services;
}
LandroidAccessory.prototype.landroidUpdate = function(mower, data) {
  if(this.serial === null){
    if(mower.raw.name == this.config.dev_name){
      this.serial = mower.serial;
      this.log("Mower "+this.name+" configured. ("+this.config.dev_name+")");
    } else{
      return false;
    }
  } else if(mower.serial !== this.serial) return;

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
      this.contactService.getCharacteristic(Characteristic.ContactSensorState).updateValue(isError(this.dataset.errorCode)?Characteristic.ContactSensorState.CONTACT_NOT_DETECTED:Characteristic.ContactSensorState.CONTACT_DETECTED);
      //this.leakService.getCharacteristic(Characteristic.LeakDetected).updateValue(this.dataset.errorCode == 5);
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
LandroidAccessory.prototype.getLeak = function(callback) {
  if(this.dataset.statusCode == 5){
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
  if(!this.serial){
    this.log("Error: Mower has not been configured yet.");
  }
  let message = {};
    if (cmd) {
        message["cmd"] = cmd;
    }
    if (params) {
        message = Object.assign(message, params);
    }
    let outMsg = JSON.stringify(message);
    this.log("Sending to landroid cloud: [" + outMsg + "] (#"+this.serial+")");
    this.landroidCloud.sendMessage(outMsg, this.serial);
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
