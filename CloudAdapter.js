/* adapter for iobroker plugin code */
function Adapter(options) {
  this.objects = {};
  this.states = {};
  this.foreigns = {};
}

Adapter.prototype.on = function(o,v) { }
Adapter.prototype.setState = function(o,v) { this.states[o] = v; }
Adapter.prototype.getObjectAsync = async function(o) { if(this.objects[o]) {return this.objects[o];} else {return null;} }
Adapter.prototype.getStateAsync = async function(o) { if(this.states[o]) {return this.states[o];} else {return null;} }
Adapter.prototype.extendObjectAsync = async function(o,v) { }
Adapter.prototype.setForeignObjectAsync = async function(o,v) { this.foreigns[o] = v; }
Adapter.prototype.delForeignObjectAsync = async function(o) { delete this.foreigns[o]; }
Adapter.prototype.subscribeStates = function(o) { }
Adapter.prototype.setInterval = function(funct,delay){
  setInterval(funct.bind(this), delay);
}
Adapter.prototype.setTimeout = function(funct,delay){
  setTimeout(funct.bind(this), delay);
}

module.exports = Adapter;
