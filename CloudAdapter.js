/* adapter for iobroker plugin code */
function Adapter(options) { }

Adapter.prototype.on = function(o,v) { }
Adapter.prototype.setState = function(o,v) { }
Adapter.prototype.getObjectAsync = async function(o) { return {} }
Adapter.prototype.getStateAsync = async function(o) { return {} }
Adapter.prototype.extendObjectAsync = async function(o,v) { }
Adapter.prototype.setForeignObjectAsync = async function(o,v) { }
Adapter.prototype.delForeignObjectAsync = async function(o) { }
Adapter.prototype.subscribeStates = function(o) { }

module.exports = Adapter;
