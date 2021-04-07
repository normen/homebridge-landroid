"use strict";
const moment = require("moment");

function LandroidDataset(readings){
  if(readings != null && readings != undefined)
    this.parse(readings);
}

LandroidDataset.prototype.parse = function(readings) {
    if (readings["cfg"]) {
        this.language = readings["cfg"]["lg"];
        this.dateTime = moment(readings["cfg"]["dt"] + " " + readings["cfg"]["tm"], "DD/MM/YYYY HH:mm:ss");
        this.rainDelay = parseInt(readings["cfg"]["rd"], 10);
        this.serialNumber = readings["cfg"]["sn"];
        if (readings["cfg"]["sc"]) {
            this.active = (readings["cfg"]["sc"]["m"] ? true : false);
            this.timeExtension = Number(readings["cfg"]["sc"]["p"]).valueOf();
            if (readings["cfg"]["sc"]["d"]) {
                this.schedule = [];
                let entries = readings["cfg"]["sc"]["d"];
                entries.forEach(entry => {
                    /*let timePeriod = new TimePeriod();
                    let start = String(entry[0]).split(":");
                    timePeriod.startHour = parseInt(start[0], 10);
                    timePeriod.startMinute = parseInt(start[1], 10);
                    timePeriod.durationMinutes = parseInt(entry[1], 10);
                    timePeriod.cutEdge = (entry[2] ? true : false);
                    this.schedule.push(timePeriod);*/
                });
            }
        }
    }
    if (readings["dat"]) {
        if (readings["dat"]["st"]) {
            this.totalTime = Number(readings["dat"]["st"]["wt"]).valueOf();
            this.totalDistance = Number(readings["dat"]["st"]["d"]).valueOf();
            this.totalBladeTime = Number(readings["dat"]["st"]["b"]).valueOf();
        }
        if (readings["dat"]["bt"]) {
            this.batteryChargeCycle = Number(readings["dat"]["bt"]["nr"]).valueOf();
            this.batteryCharging = (readings["dat"]["bt"]["c"] ? true : false);
            this.batteryVoltage = Number(readings["dat"]["bt"]["v"]).valueOf();
            this.batteryTemperature = Number(readings["dat"]["bt"]["t"]).valueOf();
            this.batteryLevel = Number(readings["dat"]["bt"]["p"]).valueOf();
        }
        this.macAddress = readings["dat"]["mac"];
        this.firmware = readings["dat"]["fw"];
        this.wifiQuality = Number(readings["dat"]["rsi"]).valueOf();
        this.statusCode = Number(readings["dat"]["ls"]).valueOf();
        this.statusDescription = LandroidDataset.STATUS_CODES[this.statusCode];
        this.errorCode = Number(readings["dat"]["le"]).valueOf();
        this.errorDescription = LandroidDataset.ERROR_CODES[this.errorCode];
    }
}

LandroidDataset.STATUS_CODES = {
    0: 'IDLE',
    1: 'Home',
    2: 'Start sequence',
    3: 'Leaving home',
    4: 'Follow wire',
    5: 'Searching home',
    6: 'Searching wire',
    7: 'Mowing',
    8: 'Lifted',
    9: 'Trapped',
    10: 'Blade blocked',
    11: 'Debug',
    12: 'Remote control',
    30: 'Going home',
    31: 'Zone training',
    32: 'Border Cut',
    33: 'Searching zone',
    34: 'Pause'
};

LandroidDataset.ERROR_CODES = {
    0: 'No error',
    1: 'Trapped',
    2: 'Lifted',
    3: 'Wire missing',
    4: 'Outside wire',
    5: 'Raining',
    6: 'Close door to mow',
    7: 'Close door to go home',
    8: 'Blade motor blocked',
    9: 'Wheel motor blocked',
    10: 'Trapped timeout',
    11: 'Upside down',
    12: 'Battery low',
    13: 'Reverse wire',
    14: 'Charge error',
    15: 'Timeout finding home',
    16: 'Mower locked',
    17: 'Battery temperature out of range',
};

module.exports = LandroidDataset;
