/* adapter for iobroker plugin code */
const fs = require("fs");
const path_ad = require("path");
function Adapter(options) {
  this.objects = {};
  this.states = {};
  this.foreigns = {};
}

Adapter.prototype.loadLandroidObjectData = function(path) {
  this.instanceFile = path_ad.join(path, "session.json"); // TODO: not needed after move to object store
  this.object_file = path_ad.join(path,"objects.json");
  this.state_file = path_ad.join(path,"states.json");
  this.foreign_file = path_ad.join(path,"foreigns.json");
  if (fs.existsSync(this.object_file)) {
    this.objects = JSON.parse(fs.readFileSync(this.object_file, "utf8"));
  }
  if (fs.existsSync(this.state_file)) {
    this.states = JSON.parse(fs.readFileSync(this.state_file, "utf8"));
  }
  if (fs.existsSync(this.foreign_file)) {
    this.foreigns = JSON.parse(fs.readFileSync(this.foreign_file, "utf8"));
  }
  return this.states;
}

Adapter.prototype.saveLandroidObjectData = function() {
  // TODO: make sure to save on unexpected shutdown
  clearTimeout(this.saveTimeout);
  this.saveTimeout = setTimeout(this.saveLOD.bind(this), 3000);
}

Adapter.prototype.saveLOD = function() {
  fs.writeFileSync(this.object_file, JSON.stringify(this.objects));
  fs.writeFileSync(this.state_file, JSON.stringify(this.states));
  fs.writeFileSync(this.foreign_file, JSON.stringify(this.foreigns));
}

Adapter.prototype.on = function(o,v) { }
Adapter.prototype.extendObjectAsync = async function(o,v) { }
Adapter.prototype.setObjectNotExistsAsync = async function(o, v) { this.setObjectNotExists(o,v); };
Adapter.prototype.getObject = function(o) { if(this.objects[o]) {return this.objects[o];} else {return null;} }
Adapter.prototype.getObjectAsync = async function(o) { this.getObject(o);}
Adapter.prototype.setStateAsync = async function(o, v) { this.setState(o,v); };
Adapter.prototype.getState = function(o) { if(this.states[o]) {return this.states[o];} else {return null;} }
Adapter.prototype.getStateAsync = async function(o) { this.getState(o); }
Adapter.prototype.setForeignObject = function(o,v) { this.foreigns[o] = v; this.saveLandroidObjectData(); }
Adapter.prototype.delForeignObject = function(o) { delete this.foreigns[o]; }
Adapter.prototype.setForeignObjectAsync = async function(o,v) { this.setForeignObject(o,v); }
Adapter.prototype.delForeignObjectAsync = async function(o) { this.delForeignObject(o); }
Adapter.prototype.subscribeStates = function(o) { }
Adapter.prototype.setInterval = function(funct,delay){ return setInterval(funct.bind(this), delay); }
Adapter.prototype.setTimeout = function(funct,delay){ return setTimeout(funct.bind(this), delay); }
Adapter.prototype.clearInterval = function(obj){ clearInterval(obj); }
Adapter.prototype.clearTimeout = function(obj){ clearTimeout(obj); }

module.exports = Adapter;
