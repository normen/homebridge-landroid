# homebridge-landroid [![NPM Version](https://img.shields.io/npm/v/homebridge-landroid.svg)](https://www.npmjs.com/package/homebridge-landroid) [![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
Homebridge plugin to control Worx Landroid lawn mowers through the Worx Cloud, supports most Landroid mowers.

## Features
 - Automatically fetches all mowers from Worx Cloud
 - Start mower
 - Return mower to home
 - Mowing status (on / off)
 - Battery Status
 - Error status

## Installation
1. Install homebridge using: npm install -g homebridge
2. Install this plugin using: npm install -g homebridge-landroid
3. Set up homebridges config.json with your Worx account data

#### Example config
```
{
  "bridge": {
    "name": "Homebridge",
    "username": "CC:22:3D:E3:CE:30",
    "port": 51826,
    "pin": "031-45-154"
  },
  "platforms": [
    {
      "platform": "Landroid",
      "email": "my@email.com",
      "pwd": "my_password"
    }
  ]
}
```

#### Options
 - `email` eMail for your Worx account
 - `pwd` Password for your Worx account
 - `rainsensor` Adds an additional "Leak" sensor for rain detection
 - `reload` Clears all mowers in HomeKit and reloads them from the cloud, default `false`
 - `cloud` Sets the cloud to use, `worx`, `kress` or `landxcape`, default `worx`
 - `debug` Enable additional debug log output, default `false`
 - `mowdata` Enable additional mowing data log output, default `false`

## Usage
 The mower will appear as a switch and a contact sensor in HomeKit.

#### On/Off Switch
The switch shows the current status and allows to control the mower. If the switch is off the mower is either on the home base or on its way to the home base. If it's on the mower is currently mowing. Turn the switch on to start the mowing cycle, turn it off to send the mower back home.

#### Contact Sensor
The contact sensor is used to display issues with the mower (trapped, outside wire etc.), when the contact sensor is "open" there is some issue that prevents the mower from continuing. Fix the issue to control the mower again.

#### Battery Status
You can see the battery status in the settings of either the switch or contact sensor in the Home app and you can ask Siri about the battery status of your lawn mower.

## Development
If you want new features or improve the plugin, you're very welcome to do so. The projects `devDependencies` include homebridge and the `npm run test` command has been adapted so that you can run a test instance of homebridge during development. 
#### Setup
- clone github repo
- `npm install` in the project folder
- create `.homebridge` folder in project root
- add `config.json` with appropriate content to `.homebridge` folder
- run `npm run test` to start the homebridge instance for testing

