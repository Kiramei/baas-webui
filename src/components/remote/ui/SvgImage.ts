import KeyboardSVG from '../../public/images/skin-light/ic_keyboard_678_48dp.svg';
import MoreSVG from '../../public/images/skin-light/ic_more_horiz_678_48dp.svg';
import CameraSVG from '../../public/images/skin-light/ic_photo_camera_678_48dp.svg';
import PowerSVG from '../../public/images/skin-light/ic_power_settings_new_678_48px.svg';
import VolumeDownSVG from '../../public/images/skin-light/ic_volume_down_678_48px.svg';
import VolumeUpSVG from '../../public/images/skin-light/ic_volume_up_678_48px.svg';
import BackSVG from '../../public/images/skin-light/System_Back_678.svg';
import HomeSVG from '../../public/images/skin-light/System_Home_678.svg';
import OverviewSVG from '../../public/images/skin-light/System_Overview_678.svg';
import CancelSVG from '../../public/images/buttons/cancel.svg';
import OfflineSVG from '../../public/images/buttons/offline.svg';
import RefreshSVG from '../../public/images/buttons/refresh.svg';
import SettingsSVG from '../../public/images/buttons/settings.svg';
import MenuSVG from '../../public/images/buttons/menu.svg';
import ArrowBackSVG from '../../public/images/buttons/arrow_back.svg';
import ToggleOnSVG from '../../public/images/buttons/toggle_on.svg';
import ToggleOffSVG from '../../public/images/buttons/toggle_off.svg';

export enum Icon {
    BACK,
    HOME,
    OVERVIEW,
    POWER,
    VOLUME_UP,
    VOLUME_DOWN,
    MORE,
    CAMERA,
    KEYBOARD,
    CANCEL,
    OFFLINE,
    REFRESH,
    SETTINGS,
    MENU,
    ARROW_BACK,
    TOGGLE_ON,
    TOGGLE_OFF,
}

export default class SvgImage {
    static Icon = Icon;
    private static getSvgString(type: Icon): string {
        switch (type) {
            case Icon.KEYBOARD:
                return <string>(<unknown>KeyboardSVG);
            case Icon.MORE:
                return <string>(<unknown>MoreSVG);
            case Icon.CAMERA:
                return <string>(<unknown>CameraSVG);
            case Icon.POWER:
                return <string>(<unknown>PowerSVG);
            case Icon.VOLUME_DOWN:
                return <string>(<unknown>VolumeDownSVG);
            case Icon.VOLUME_UP:
                return <string>(<unknown>VolumeUpSVG);
            case Icon.BACK:
                return <string>(<unknown>BackSVG);
            case Icon.HOME:
                return <string>(<unknown>HomeSVG);
            case Icon.OVERVIEW:
                return <string>(<unknown>OverviewSVG);
            case Icon.CANCEL:
                return <string>(<unknown>CancelSVG);
            case Icon.OFFLINE:
                return <string>(<unknown>OfflineSVG);
            case Icon.REFRESH:
                return <string>(<unknown>RefreshSVG);
            case Icon.SETTINGS:
                return <string>(<unknown>SettingsSVG);
            case Icon.MENU:
                return <string>(<unknown>MenuSVG);
            case Icon.ARROW_BACK:
                return <string>(<unknown>ArrowBackSVG);
            case Icon.TOGGLE_ON:
                return <string>(<unknown>ToggleOnSVG);
            case Icon.TOGGLE_OFF:
                return <string>(<unknown>ToggleOffSVG);
            default:
                return '';
        }
    }
    public static create(type: Icon): Element {
        const dummy = document.createElement('div');
        dummy.innerHTML = this.getSvgString(type);
        const svg = dummy.children[0];
        const titles = svg.getElementsByTagName('title');
        for (let i = 0, l = titles.length; i < l; i++) {
            svg.removeChild(titles[i]);
        }
        return svg;
    }
}
