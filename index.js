"use strict";
var Accessory, Service, Characteristic, UUIDGen;
var LandroidCloud = require('iobroker.worx/lib/api');
var LandroidDataset = require('./LandroidDataset');

function LandroidPlatform(log, config, api) {
  this.config = config;
  this.log = log;
  this.debug = config.debug || false;
  this.mowdata = config.mowdata || false;
  this.cloud = config.cloud || "worx";
  this.accessories = [];
  this.cloudMowers = [];

  if(!config.email || !config.pwd){
    this.log("WARNING: No account configured, please set email and password of your Worx account in config.json!");
    return;
  }

  const self = this;
  this.api = api;

  // Listen to event "didFinishLaunching", this means homebridge already finished loading cached accessories.
  // Platform Plugin should only register new accessory that doesn't exist in homebridge after this event.
  // Or start discover new accessories.
  this.api.on('didFinishLaunching', function () {
    self.log('DidFinishLaunching');
    if(self.config.reload){
      self.log('**** WARNING: Landroid plugin is in reload mode, mowers will be recreated each boot ****');
      self.accessories.forEach(accessory => {
        self.log('Removing Landroid ' + accessory.accessory.displayName + ' from HomeKit');
        self.api.unregisterPlatformAccessories('homebridge-landroid', 'Landroid', [accessory.accessory]);
      });
      self.accessories = [];
    }
    self.landroidAdapter = {"log": new LandroidLogger(log), "config":{"server":self.cloud}};
    self.landroidCloud = new LandroidCloud(config.email, config.pwd, self.landroidAdapter);
    self.landroidCloud.on("mqtt", self.landroidUpdate.bind(self));
    self.landroidCloud.on("found", self.landroidFound.bind(self));
    self.landroidCloud.on("error", error => {
      log(error);
      // stop clearing old devices
      if(self.removeTimeout) clearTimeout(self.removeTimeout);
    } );
    self.landroidCloud.on("connect", connect => {
      log("Connected to WORX cloud.");
      // remove old mowers 60 sec after connecting to cloud should be alright..
      self.removeTimeout = setTimeout(self.clearOldMowers.bind(self), 60000);
    } );
    //self.landroidCloud.on("offline", offline => {console.log(offline)} );
    //self.landroidCloud.on("online", online => {console.log(online)} );
    // add link to cloud to restored accessories
    self.accessories.forEach(accessory=>{
      accessory.landroidCloud = self.landroidCloud;
    });
  });
}

LandroidPlatform.prototype.clearOldMowers = function() {
  const self = this;
  this.accessories.forEach((accessory, idx, obj) => {
    if(!self.cloudMowers.includes(accessory.serial)){
      self.api.unregisterPlatformAccessories('homebridge-landroid', 'Landroid', [accessory.accessory]);
      obj.splice(idx, 1);
    }
  });
}

// Function invoked when homebridge tries to restore cached accessory.
LandroidPlatform.prototype.configureAccessory = function(accessory) {
  if (!this.config) { // happens if plugin is disabled and still active accessories
    return;
  }
  this.log('Restoring Landroid ' + accessory.displayName + ' from HomeKit');
  accessory.reachable = false;
  this.accessories.push(new LandroidAccessory(this, null, null, accessory));
}

// Handler will be invoked when user try to config your plugin.
// Callback can be cached and invoke when necessary.
LandroidPlatform.prototype.configurationRequestHandler = function(context, request, callback) {
  callback(null);
}

LandroidPlatform.prototype.landroidFound = function(mower, data) {
  if(this.debug && mower && mower.raw) {
    this.log("[DEBUG] MOWER: " + JSON.stringify(mower.raw));
  }else if(mower && mower.raw){
    this.log("Found Landroid in Worx Cloud with name: " + mower.raw.name);
  }
  if(this.mowdata && mower && mower.raw) {
    this.log("Mowing data logging enabled for Landroid " + mower.raw.name);
  }
  this.cloudMowers.push(mower.raw.serial_number);
  for(var i = 0; i<this.accessories.length; i++){
    const accessory = this.accessories[i];
    if(accessory.serial == mower.raw.serial_number){
      //already have this one
      accessory.accessory.reachable = true;
      this.landroidUpdate(mower, data);
      return;
    }
  }
  // don't have this one, add it
  const newMower = new LandroidAccessory(this, mower.raw.name, mower.raw.serial_number);
  this.accessories.push(newMower);
  this.log("Adding Landroid " + mower.raw.name + " to HomeKit");
  this.api.registerPlatformAccessories('homebridge-landroid', 'Landroid', [newMower.accessory]);
  this.landroidUpdate(mower,data);
}

LandroidPlatform.prototype.landroidUpdate = function(mower, data) {
    if(this.debug && data) {
      this.log("[DEBUG] DATA: " + JSON.stringify(data));
    }
    this.accessories.forEach(accessory=>{
        accessory.landroidUpdate(mower, data, this.mowdata);
    });
}

//TODO: add other constructor
function LandroidAccessory(platform, name, serial, accessory) {
    this.landroidCloud = platform.landroidCloud;
    this.log = platform.log;
    this.config = platform.config;

    if (accessory) {
      this.accessory = accessory;
    } else {
      // new accessory object
      var uuid = UUIDGen.generate(serial);
      //this.log('Creating new accessory for ' + name + ' (' + serial + ')');
      this.accessory = new Accessory("Landroid " + name, uuid);
      this.accessory.context.name = name;
      this.accessory.context.serial = serial;

      this.accessory.addService(new Service.Switch("Landroid " + name));
      this.accessory.addService(new Service.BatteryService());
      this.accessory.addService(new Service.ContactSensor("Landroid " + name + " Problem"));
      if(this.config.rainsensor) this.accessory.addService(new Service.LeakSensor("Landroid " + name + " Rain"));
    }

    this.name = this.accessory.context.name;
    this.serial = this.accessory.context.serial;

    this.dataset = {};
    this.dataset.batteryLevel = 0;
    this.dataset.batteryCharging = false;
    this.dataset.statusCode = 0;
    this.dataset.errorCode = 0;

    this.accessory.getService(Service.Switch).getCharacteristic(Characteristic.On).on('get', this.getOn.bind(this));
    this.accessory.getService(Service.Switch).getCharacteristic(Characteristic.On).on('set', this.setOn.bind(this));

    this.accessory.getService(Service.BatteryService).getCharacteristic(Characteristic.BatteryLevel).on('get', this.getBatteryLevel.bind(this));
    this.accessory.getService(Service.BatteryService).getCharacteristic(Characteristic.StatusLowBattery).on('get', this.getStatusLowBattery.bind(this));
    this.accessory.getService(Service.BatteryService).getCharacteristic(Characteristic.ChargingState).on('get', this.getChargingState.bind(this));

    this.accessory.getService(Service.ContactSensor).getCharacteristic(Characteristic.ContactSensorState).on('get', this.getContactSensorState.bind(this));

    this.accessory.getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Name, this.name)
      .setCharacteristic(Characteristic.Manufacturer, 'Worx')
      .setCharacteristic(Characteristic.Model, 'Landroid')
      .setCharacteristic(Characteristic.SerialNumber, this.serial);

    if(this.config.rainsensor && this.accessory.getService(Service.LeakSensor)) this.accessory.getService(Service.LeakSensor).on('get', this.getLeak.bind(this));
}

LandroidAccessory.prototype.landroidUpdate = function(mower, data, mowdata) {
  var totalTime, totalBladeTime, totalDistance;

  if(mower.raw.serial_number !== this.serial) return;

  if(data != null && data != undefined){
    let oldDataset = this.dataset;
    this.dataset = new LandroidDataset(data);
    // this.log("landroidUpdate ran with RSSI " + this.dataset.wifiQuality + ", battery temperature " + this.dataset.batteryTemperature);
    if(mowdata){
      if(oldDataset.totalTime != null && oldDataset.totalTime != undefined){
        if(this.dataset.totalTime != oldDataset.totalTime){
          totalTime = Number(this.dataset.totalTime) - Number(oldDataset.totalTime);
          this.log("Landroid " + this.name + " new minutes worked: " + String(totalTime));
        }
        if(this.dataset.totalBladeTime != oldDataset.totalBladeTime){
          totalBladeTime = Number(this.dataset.totalBladeTime) - Number(oldDataset.totalBladeTime);
          this.log("Landroid " + this.name + " new minutes mowed: " + String(totalBladeTime));
        }
        if(this.dataset.totalDistance != oldDataset.totalDistance){
          totalDistance = Number(this.dataset.totalDistance) - Number(oldDataset.totalDistance);
          this.log("Landroid " + this.name + " new distance moved: " + String(totalDistance) + "m");
        }
      }else{
        totalTime = Number(this.dataset.totalTime) / 60;
        totalTime = totalTime.toFixed(2);
        this.log("Landroid " + this.name + " hours worked so far: " + String(totalTime));
        totalBladeTime = Number(this.dataset.totalBladeTime) / 60;
        totalBladeTime = totalBladeTime.toFixed(2);
        this.log("Landroid " + this.name + " hours mowed so far: " + String(totalBladeTime));
        totalDistance = Number(this.dataset.totalDistance) / 1000;
        this.log("Landroid " + this.name + " distance moved so far: " + String(totalDistance) + "km");
      }
    }
    if(this.dataset.batteryLevel != oldDataset.batteryLevel){
      this.log("Landroid " + this.name + " battery level changed to " + this.dataset.batteryLevel);
      this.accessory.getService(Service.BatteryService).getCharacteristic(Characteristic.BatteryLevel).updateValue(this.dataset.batteryLevel);
    }
    if(this.dataset.batteryCharging != oldDataset.batteryCharging){
      this.log("Landroid " + this.name + " charging status changed to " + this.dataset.batteryCharging);
      this.accessory.getService(Service.BatteryService).getCharacteristic(Characteristic.ChargingState).updateValue(this.dataset.batteryCharging?Characteristic.ChargingState.CHARGING:Characteristic.ChargingState.NOT_CHARGING);
    }
    if(this.dataset.statusCode != oldDataset.statusCode){
      this.log("Landroid " + this.name + " status changed to " + this.dataset.statusCode + " (" + this.dataset.statusDescription + ")");
      if(isOn(this.dataset.statusCode)){
        this.accessory.getService(Service.Switch).getCharacteristic(Characteristic.On).updateValue(true);
      }else{
        this.accessory.getService(Service.Switch).getCharacteristic(Characteristic.On).updateValue(false);
      }
    }
    if(this.dataset.errorCode != oldDataset.errorCode){
      this.log("Landroid " + this.name + " error code changed to " + this.dataset.errorCode + " (" + this.dataset.errorDescription + ")");
      this.accessory.getService(Service.ContactSensor).getCharacteristic(Characteristic.ContactSensorState).updateValue(isError(this.dataset.errorCode)?Characteristic.ContactSensorState.CONTACT_NOT_DETECTED:Characteristic.ContactSensorState.CONTACT_DETECTED);
      if(this.config.rainsensor && this.accessory.getService(Service.LeakSensor)) this.accessory.getService(Service.LeakSensor).getCharacteristic(Characteristic.LeakDetected).updateValue(this.dataset.errorCode == 5);
    }
  }
}
LandroidAccessory.prototype.getContactSensorState = function(callback) {
  callback(null,  isError(this.dataset.errorCode)?Characteristic.ContactSensorState.CONTACT_NOT_DETECTED:Characteristic.ContactSensorState.CONTACT_DETECTED);
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
    this.log("Sending to Landroid " + this.name + ": [" + outMsg + "] ("+this.serial+")");
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
  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;
  homebridge.registerPlatform("homebridge-landroid", "Landroid", LandroidPlatform, true);
}
