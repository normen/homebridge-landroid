# Changelog
This is the change log for the plugin, all relevant changes will be listed here.

For documentation please see the [README](https://github.com/normen/homebridge-landroid/blob/master/README.md)

## 0.12.2
- Update worx endpoint and upstream library

## 0.11.9
- PartyMode switch now properly reflects PartyMode state

## 0.11.8
- Attempt to fix party mode status

## 0.11.7
- Another attempt at fixing error state

## 0.11.6
- Fix reading of error state
- Update from upstream

## 0.11.5
- Better handle multiple mowers (upstream)

## 0.11.4
- Improve adapter to avoid unexpected timer issues

## 0.11.3
- More logging, try to avoid issues with two mowers (upstream)

## 0.11.2
- Fix party mode status

## 0.11.1
- Persist cloud data

## 0.11.0
- Save session data

## 0.10.12
- Fix in value setting (upstream)

## 0.10.11
- Fix in cloud object storage

## 0.10.10
- Add request counter (upstream)

## 0.10.9
- Better compatibility to connector code (store cloud data)

## 0.10.8
- Change client id / username from iobroker to homebridge

## 0.10.7
- Fix removing old mowers

## 0.10.6
- Small fixes in login sequence
- More debug output
- Bump node dependency

## 0.10.5
- Small value reading fixes from upstream (iobroker.worx)

## 0.10.4
- Fix setTimeout error

## 0.10.3
- Fix missing value names in log output

## 0.10.2
- Fix status display

## 0.10.1
- Fix battery display

## 0.10.0
- New cloud connector

## 0.9.9
- Fix cloud login (no data yet)

## 0.9.8
- Update worx library to fix 404 Error

## 0.9.7
- Update worx library

## 0.9.6
- Added optional home sensor

## 0.9.5
- fix for (untested) support for "Party Mode"

## 0.9.4
- cleanup logging (thanks andy-dinger!)
- add (untested) support for "Party Mode"

## 0.9.3
- add cloud parameter to config panel

## 0.9.2
- fix https error
- possibly allow using kress and landxcape models

## 0.9.1
- downgrade/fix version of iobroker.worx library to 1.0.2

## 0.9.0    
- added mowing data option (thanks andy-dinger!)
- small cleanups and UI improvements
- add development infos
## 0.8.1

- fix name of rain sensor

## 0.8.0
- automatic removal of old mowers

## 0.7.3
- add optional leak sensor for rain detection

## 0.7.2
- fix reachable

## 0.7.1
- fix naming

## 0.7.0
- add mower auto-discovery

## 0.6.6
- always show cloud reported mower names by default

## 0.6.5
- add debug mode with additional log output

## 0.6.3
- fix import crash
- README cleanups

## 0.6.2
- fix sending messages
- clean up configuration panel

## 0.6.1
- use iobroker.worx library (Fixes #10)
- use global worx account (Fixes #11)

## 0.6.0
- use global email/pwd (per-mower settings will still work)

## 0.5.3
- support config-ui-x settings panel

## 0.5.2
- update iobroker.Landroid-s library (Fixes Issue #2)

## 0.5.1
- fix contact sensor state issue

## 0.5.0
- update README
- cleanups

## 0.4.3
- fix on/off state update
- searching home == off

## 0.4.2
- add logging for incoming status changes

## 0.4.1
- fix crash when login data is invalid

## 0.4.0
- fix sending commands
- move error status to contact sensor for now

## 0.2.0
- add update callbacks to HomeKit on changes
- fix battery service
- add charging state

