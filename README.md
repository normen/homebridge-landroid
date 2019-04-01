# homebridge-landroid [![NPM Version](https://img.shields.io/npm/v/homebridge-landroid.svg)](https://www.npmjs.com/package/homebridge-landroid) [![Donate](https://img.shields.io/badge/donate-paypal-yellowgreen.svg)](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=QKRPFAVB6WRW2&source=url)
Homebridge plugin to control Worx Landroid lawn mowers through the Worx Cloud

## Features
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
      "landroids": [
        {
          "name": "My Landroid",
          "email": "my@email.com",
          "pwd": "my_password",
          "dev_sel": 0
        }
      ]
    }
  ]
}
```

#### Options
 - `name` Name for your Landroid to appear in HomeKit
 - `email` eMail for your Worx account
 - `pwd` password for your Worx account
 - `dev_sel` device number if you have more than one Landroid, default `0`

## Usage
 The mower will appear as a switch and a contact sensor in HomeKit.

#### On/Off Switch
The switch shows the current status and allows to control the mower. If the switch is off the mower is either on the home base or on its way to the home base. If it's on the mower is currently mowing. Turn the switch on to start the mowing cycle, turn it off to send the mower back home.

#### Contact Sensor
The contact sensor is used to dipsplay issues with the mower (trapped, outside wire etc.), when the contact sensor is "open" there is some issue that prevents the mower from continuing. Fix the issue to control the mower again.

#### Battery Status
You can see the battery status in the settings of either the switch or contact sensor in the Home app and you can ask Siri about the battery status of your lawn mower.
