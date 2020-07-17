import { Injectable } from '@angular/core';
import { filter, withLatestFrom } from 'rxjs/operators';
import { BackEndState } from '../state/backend.state';
import { RobotWiredState } from '../state/robot.wired.state';
import { SerialDevice } from '../domain/serial.device';

@Injectable({
    providedIn: 'root',
})

export class RobotWiredEffects {

    constructor(
        private robotWiredState: RobotWiredState,
        private backEndState: BackEndState
    ) {
        // React to messages from the Electron backend
        this.backEndState.backEndMessages$
            .pipe(filter(message => !!message))
            .subscribe(message => {
                switch (message.event) {
                    case 'INSTALLATION_VERIFIED':
                        this.robotWiredState.setIsInstallationVerified(true);
                        break;
                    case 'NO_DEVICES_FOUND':
                        this.robotWiredState.setSerialDevicesToTry([]);
                        this.robotWiredState.setVerifiedSerialDevice(null);
                        break;
                    case 'DEVICES_FOUND':
                        this.robotWiredState.setSerialDevicesToTry(message.payload);
                        break;
                    // When the update is successful, remember the device as verified
                    case 'UPDATE_COMPLETE':
                        this.robotWiredState.setVerifiedSerialDevice(message.payload as SerialDevice);
                        break;
                    default:
                        break;
                }
            });

        // When uploading to a device fails, remove it from the devices to try
        // If it was the verified device, reset the verified device
        this.backEndState.backEndMessages$
            .pipe(withLatestFrom(this.robotWiredState.serialDevicesToTry$, this.robotWiredState.verifiedSerialDevice$))
            .pipe(filter(([message, ,]) => !!message && message.event == 'UPDATE_FAILED'))
            .subscribe(([message, devicesToTry, verifiedDevice]) => {
                if(verifiedDevice && message.payload.address == verifiedDevice.address){
                    this.robotWiredState.setVerifiedSerialDevice(null);
                    return;
                }
                const devicesLeftToTry = devicesToTry.filter(device => device.address != message.payload.address);
                robotWiredState.setSerialDevicesToTry(devicesLeftToTry);
            });

        // Set the IsRobotInstalling flag right back to false
        this.robotWiredState.isRobotDriverInstalling$
            .pipe(filter(isInstalling => !!isInstalling))
            .subscribe(() => {
                this.robotWiredState.setIsRobotDriverInstalling(false);
            });

    }
}
